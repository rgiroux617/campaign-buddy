// waterLayer.js
// Animated water background for Campaign Buddy.
//
// Renders on a <canvas> positioned behind the SVG map.
// When enabled, it draws WaterBackground.jpeg with three overlaid effects.
// When disabled, the canvas is cleared and the CSS background-image on the
// container element shows through as a static fallback.
//
// Effects (all constants are at the top of this file):
//   UV Scroll    -- gently oscillates the image to simulate water breathing
//   Wave Shimmer -- animated radial-gradient cells giving a light-glint look
//   Ripple Rings -- periodic expanding translucent rings across the surface
//   Shore Foam   -- pulsing glow rings drawn around land-hex boundaries
//
// Usage in app.js:
//   const water = createWaterLayer({ containerEl, imagePath, hexData,
//                                    centerFn, hexSize, svg, mapW, mapH });
//   water.toggle();        // called by the Water button
//   water.setZoom(v);      // called from camera.onChange -- v has .w .x .y .h

// ---- UV Scroll ---------------------------------------------------------------
// The background image drifts by up to `amount` pixels along a gentle sine wave.
// drift:false disables the drift in map-locked mode so the texture stays
// perfectly anchored to the SVG grid. Can be re-enabled for testing.
const UV = {
  speed:  0.3,   // oscillation frequency (cycles per second)
  amount: 9,     // maximum pixel offset in each axis (only used when drift:true)
  drift:  false, // set true to re-enable drift in map-locked mode
};

// ---- Wave Shimmer ------------------------------------------------------------
// A grid of radial gradients whose brightness oscillates independently,
// layered on top of the image via screen compositing.
const SHIMMER = {
  intensity: 0.24,   // peak opacity of each cell (negative half = darkening)
  cellSize:  105,    // screen-pixel spacing between shimmer cell centres
  speed:     0.7,    // phase animation speed multiplier
};

// ---- Ripple Rings ------------------------------------------------------------
// Expanding translucent rings that spawn at random positions and fade as they grow.
const RIPPLE = {
  spawnRate: 1.5,    // seconds between spawn events (occasional double spawns too)
  maxRadius: 80,     // maximum ring radius in screen pixels at full expansion
};

// ---- Shore Foam --------------------------------------------------------------
// A soft pulsing glow ring drawn around each land hex that borders water.
// Only shore hexes (those with at least one water or empty neighbour) are drawn,
// which keeps the effect at the coastline and avoids redundant interior draws.
const FOAM = {
  baseAlpha: 0.0,   // minimum foam opacity
  pulseAlpha: 0.0,  // additional opacity added at pulse peak
};

// ---- Background Scale --------------------------------------------------------
// When enabled, the water image (canvas + CSS fallback) is map-locked: it
// samples exactly the portion of the texture that corresponds to the current
// viewBox, so it zooms and pans in lockstep with the SVG grid.
// Set enabled:false to revert to the original screen-fixed behaviour.
const SCALE = {
  enabled: true,
  padding: 20,    // extra SVG units sampled beyond the viewBox edge on each side
                  // (matches the grid's PAD value in app.js, giving a small bleed)
};

// ---- Hex water colour --------------------------------------------------------
// Hexes with this fill colour are treated as water and receive no foam.
const WATER_HEX_COLOR = "#3c6270";

// =============================================================================

export function createWaterLayer({ containerEl, imagePath, hexData, centerFn, hexSize, svg, mapW, mapH }) {

  // ---- Canvas element --------------------------------------------------------
  // position:absolute, sized to match the SVG's rendered content area exactly.
  //
  // The SVG uses the default preserveAspectRatio="xMidYMid meet", which
  // letterboxes the grid inside the viewport when the screen aspect ratio
  // doesn't match the map's aspect ratio. The canvas must match that
  // letterboxed area — not the full viewport — so the water texture aligns
  // pixel-perfectly with the hex grid at every zoom level.
  //
  // z-index:0 keeps it below #wrap (z-index:1 in index.html).
  const canvas = document.createElement("canvas");
  canvas.style.cssText = [
    "position:absolute",
    "pointer-events:none",
    "z-index:0",
  ].join(";");
  // Insert as the first child so it is below everything in normal DOM order too
  containerEl.insertBefore(canvas, containerEl.firstChild);

  const ctx = canvas.getContext("2d");

  // Compute the pixel rect where the SVG grid actually renders on screen.
  //
  // PRIMARY: svg.getScreenCTM() gives the exact browser-computed transform from
  // SVG user-coordinates to CSS viewport pixels. It correctly accounts for the
  // viewBox + preserveAspectRatio (xMidYMid meet) letterboxing, whatever the
  // screen size.  We transform the two corners of the viewBox (0,0)→(mapW,mapH)
  // to get the canvas rect in containerEl-relative coordinates.
  //
  // FALLBACK: if getScreenCTM is unavailable, compute manually using
  // window.innerWidth/innerHeight (NOT svg.clientWidth — SVG elements in many
  // browsers return their viewBox dimensions for clientWidth, not the CSS size).
  function _contentRect() {
    const ctm = svg.getScreenCTM && svg.getScreenCTM();
    if (ctm) {
      const mk = (x, y) => {
        const p = svg.createSVGPoint();
        p.x = x; p.y = y;
        return p.matrixTransform(ctm);
      };
      const tl  = mk(0, 0);
      const br  = mk(mapW, mapH);
      const box = containerEl.getBoundingClientRect();
      return {
        left:   Math.round(tl.x - box.left),
        top:    Math.round(tl.y - box.top),
        width:  Math.round(br.x - tl.x),
        height: Math.round(br.y - tl.y),
      };
    }
    // Fallback: manual xMidYMid-meet calculation.
    const vpW   = window.innerWidth;
    const vpH   = window.innerHeight;
    const scale = Math.min(vpW / mapW, vpH / mapH);
    return {
      left:   Math.round((vpW - scale * mapW) / 2),
      top:    Math.round((vpH - scale * mapH) / 2),
      width:  Math.round(scale * mapW),
      height: Math.round(scale * mapH),
    };
  }

  function _resize() {
    const r = _contentRect();
    canvas.style.left   = r.left   + "px";
    canvas.style.top    = r.top    + "px";
    canvas.style.width  = r.width  + "px";
    canvas.style.height = r.height + "px";
    canvas.width  = r.width;
    canvas.height = r.height;
  }

  // Defer the first resize to after the browser has completed the initial
  // layout. getScreenCTM() can return null or an identity matrix if called
  // synchronously before the first paint.
  requestAnimationFrame(_resize);
  window.addEventListener("resize", () => requestAnimationFrame(_resize));

  // ---- Water image -----------------------------------------------------------
  let waterImg = null;
  const _img   = new Image();
  _img.onload  = () => { waterImg = _img; };
  _img.src     = imagePath;

  // ---- Shore hex precomputation ----------------------------------------------
  // We precompute SVG-unit centres for all land hexes that border water/empty,
  // so the foam loop is cheap at runtime.
  //
  // Neighbour check uses all 8 surrounding cells rather than the exact 6-hex
  // offset formula (which depends on the grid's odd/even-row convention).
  // The 2 extra cells are never real hex neighbours so they're always in hexData
  // or missing -- either way they count as "water/edge" only when appropriate.
  const shoreHexes = [];
  for (const [key, h] of Object.entries(hexData)) {
    if (!h.c || h.c.toLowerCase() === WATER_HEX_COLOR) continue; // skip water/empty

    const [c, r] = key.split(",").map(Number);
    const isShore = [
      [c - 1, r],     [c + 1, r],
      [c,     r - 1], [c,     r + 1],
      [c - 1, r - 1], [c + 1, r - 1],
      [c - 1, r + 1], [c + 1, r + 1],
    ].some(([nc, nr]) => {
      const nb = hexData[`${nc},${nr}`];
      return !nb || !nb.c || nb.c.toLowerCase() === WATER_HEX_COLOR;
    });

    if (isShore) {
      const pos = centerFn(c, r);
      shoreHexes.push({ svgX: pos.x, svgY: pos.y });
    }
  }

  // ---- Coordinate helper -----------------------------------------------------
  // Converts an SVG map coordinate to a canvas screen pixel.
  // Reads the live viewBox each call so it stays correct as the camera moves.
  function _toScreen(svgX, svgY) {
    const vb = svg.viewBox.baseVal;
    return {
      x: (svgX - vb.x) / vb.width  * canvas.width,
      y: (svgY - vb.y) / vb.height * canvas.height,
    };
  }

  // ---- Map-locked image draw --------------------------------------------------
  // When SCALE.enabled, instead of scaling the canvas context (which clips at
  // the canvas boundary), we compute which portion of the texture corresponds
  // to the current viewBox and draw only that crop, stretched to fill the canvas.
  //
  // The viewBox is expressed in SVG map units (0..mapW, 0..mapH).
  // The texture is treated as covering that same coordinate space uniformly,
  // so the source rect in image pixels is just the viewBox's fraction of mapW/mapH
  // multiplied by the image's pixel dimensions.
  //
  // UV scroll is applied as a fraction of the source rect size so the drift
  // stays visually constant regardless of zoom level.
  function _drawWaterImage(t) {
    if (!waterImg) return;

    const W  = canvas.width;
    const H  = canvas.height;
    const iw = waterImg.naturalWidth  || waterImg.width;
    const ih = waterImg.naturalHeight || waterImg.height;

    if (!SCALE.enabled || !mapW || !mapH) {
      // Original screen-fixed behaviour (SCALE.enabled:false)
      if (UV.drift) {
        const ox  = Math.sin(t * UV.speed)       * UV.amount;
        const oy  = Math.cos(t * UV.speed * 0.7) * UV.amount;
        const pad = Math.ceil(UV.amount) + 2;
        ctx.drawImage(waterImg, -pad + ox, -pad + oy, W + pad * 2, H + pad * 2);
      } else {
        ctx.drawImage(waterImg, 0, 0, W, H);
      }
      return;
    }

    const vb = svg.viewBox.baseVal;

    // Expand the sample region by SCALE.padding SVG units on each side.
    // This gives a small bleed so the texture isn't hard-edged at the map boundary
    // and matches the PAD baked into mapW/mapH.
    const pad = SCALE.padding;
    const rx  = vb.x - pad;
    const ry  = vb.y - pad;
    const rw  = vb.width  + pad * 2;
    const rh  = vb.height + pad * 2;

    // Convert padded SVG region to image-pixel source rect,
    // clamped so we never sample outside the image.
    const rawSx = (rx / mapW) * iw;
    const rawSy = (ry / mapH) * ih;
    const rawSw = (rw / mapW) * iw;
    const rawSh = (rh / mapH) * ih;

    // Clamp to image bounds
    const sx = Math.max(0, rawSx);
    const sy = Math.max(0, rawSy);
    const ex = Math.min(iw, rawSx + rawSw);
    const ey = Math.min(ih, rawSy + rawSh);
    const sw = ex - sx;
    const sh = ey - sy;

    if (sw <= 0 || sh <= 0) return;

    // Optional UV drift -- disabled by default so the texture stays map-locked.
    // When enabled, drift is proportional to the source slice so it looks the
    // same number of screen pixels at any zoom level.
    let ox = 0, oy = 0;
    if (UV.drift) {
      const driftFrac = UV.amount / Math.min(W, H);
      ox = Math.sin(t * UV.speed)       * sw * driftFrac;
      oy = Math.cos(t * UV.speed * 0.7) * sh * driftFrac;
    }

    ctx.drawImage(
      waterImg,
      sx + ox, sy + oy, sw, sh,  // source: map-locked crop (+ optional drift)
      0, 0, W, H                  // destination: fill the whole canvas
    );
  }

  // ---- Shimmer offscreen buffer ----------------------------------------------
  // Drawn to a separate canvas then composited, which is faster than
  // creating many gradients directly on the main context.
  const shimBuf = document.createElement("canvas");
  const shimCtx = shimBuf.getContext("2d");

  function _drawShimmer(t) {
    if (shimBuf.width !== canvas.width || shimBuf.height !== canvas.height) {
      shimBuf.width  = canvas.width;
      shimBuf.height = canvas.height;
    }
    const { cellSize: sc, speed: sp, intensity: inten } = SHIMMER;
    shimCtx.clearRect(0, 0, shimBuf.width, shimBuf.height);

    const cols = Math.ceil(shimBuf.width  / sc) + 2;
    const rows = Math.ceil(shimBuf.height / sc) + 2;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        // Two-frequency product gives irregular, non-grid shimmer
        const phase =
          Math.sin(t * sp + col * 0.71 + row * 1.13) *
          Math.cos(t * sp * 0.57 + col * 1.31 - row * 0.49);
        const a = phase * inten;
        if (Math.abs(a) < 0.004) continue;

        const cx  = col * sc;
        const cy  = row * sc;
        const grd = shimCtx.createRadialGradient(cx, cy, 0, cx, cy, sc * 0.75);
        if (a > 0) {
          grd.addColorStop(0, "rgba(255,255,255," + a.toFixed(3) + ")");
        } else {
          grd.addColorStop(0, "rgba(0,20,50,"     + (-a).toFixed(3) + ")");
        }
        grd.addColorStop(1, "rgba(0,0,0,0)");
        shimCtx.fillStyle = grd;
        shimCtx.fillRect(cx - sc, cy - sc, sc * 2, sc * 2);
      }
    }

    ctx.drawImage(shimBuf, 0, 0);
  }

  // ---- Shore foam ------------------------------------------------------------
  function _drawFoam(t) {
    const vb    = svg.viewBox.baseVal;
    // Foam ring radius scales with zoom so it always hugs the hex edge
    const foamR = hexSize * (canvas.width / vb.width);

    shoreHexes.forEach(h => {
      const { x: bx, y: by } = _toScreen(h.svgX, h.svgY);

      // Cheap off-screen cull
      if (bx < -(foamR * 3) || bx > canvas.width  + foamR * 3) return;
      if (by < -(foamR * 3) || by > canvas.height + foamR * 3) return;

      // Each hex uses its SVG position as a unique phase seed
      const pulse   = (Math.sin(t * 1.9 + h.svgX * 0.013 + h.svgY * 0.008) + 1) * 0.5;
      const foamOff = foamR * 0.10 + pulse * foamR * 0.16;
      const foamAlp = FOAM.baseAlpha + pulse * FOAM.pulseAlpha;
      const outerR  = foamR + foamOff;

      const grd = ctx.createRadialGradient(bx, by, foamR * 0.7, bx, by, outerR);
      grd.addColorStop(0,    "rgba(255,255,255,0)");
      grd.addColorStop(0.35, "rgba(255,255,255," + foamAlp.toFixed(3) + ")");
      grd.addColorStop(1,    "rgba(255,255,255,0)");

      // Slight vertical squash to suggest perspective
      ctx.save();
      ctx.scale(1, 0.72);
      ctx.beginPath();
      ctx.arc(bx, by / 0.72, outerR, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.restore();
    });
  }

  // ---- Ripple pool -----------------------------------------------------------
  const ripples    = [];
  let   lastRipple = 0;

  function _spawnRipple(t) {
    ripples.push({
      x:    10 + Math.random() * (canvas.width  - 20),
      y:    10 + Math.random() * (canvas.height - 20),
      born: t,
    });
  }

  function _drawRipples(t) {
    const dur = RIPPLE.spawnRate * 2.0;

    if (t - lastRipple > RIPPLE.spawnRate) {
      _spawnRipple(t);
      if (Math.random() < 0.35) _spawnRipple(t); // occasional double
      lastRipple = t;
    }

    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp  = ripples[i];
      const age = t - rp.born;
      if (age > dur) { ripples.splice(i, 1); continue; }

      const frac  = age / dur;
      const rad   = frac * RIPPLE.maxRadius;
      const alpha = (1 - frac) * 0.5;

      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rad, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255," + alpha.toFixed(3) + ")";
      ctx.lineWidth   = 1.5 - frac;
      ctx.stroke();

      // Trailing inner ring fades behind the leading edge
      if (frac > 0.18) {
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, (frac - 0.15) * RIPPLE.maxRadius, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255," + (alpha * 0.4).toFixed(3) + ")";
        ctx.lineWidth   = 0.8;
        ctx.stroke();
      }
    }
  }

  // ---- Animation state -------------------------------------------------------
  let _enabled = true;
  let _rafId   = null;
  let _prevT   = 0;

  // ---- Main frame ------------------------------------------------------------
  function _frame(now) {
    _rafId = requestAnimationFrame(_frame);

    if (!_enabled) {
      // Draw the static map-locked image so the canvas handles the background
      // at all zoom levels — no dependency on CSS background-size.
      _drawWaterImage(0);
      return;
    }

    const t  = now / 1000;
    const dt = Math.min(t - _prevT, 0.05); // cap so tab-blur doesn't explode
    _prevT   = t;

    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    // Water image -- map-locked crop when SCALE.enabled, screen-fill otherwise
    _drawWaterImage(t);

    if (waterImg) {
      // Shimmer -- composited on top of the image
      _drawShimmer(t);

      // Shore foam -- glow rings around coastline hexes
      if (shoreHexes.length > 0) _drawFoam(t);
    }

    // Ripple rings -- drawn last so they appear on the water surface
    _drawRipples(t);
  }

  // Start immediately
  requestAnimationFrame(_frame);

  // ---- Public API ------------------------------------------------------------
  function enable()    { _enabled = true;  }
  function disable()   { _enabled = false; }
  function toggle()    { _enabled ? disable() : enable(); }
  function isEnabled() { return _enabled; }

  function destroy() {
    if (_rafId) cancelAnimationFrame(_rafId);
    window.removeEventListener("resize", _resize);
    canvas.remove();
  }

  return { enable, disable, toggle, isEnabled, destroy };
}
