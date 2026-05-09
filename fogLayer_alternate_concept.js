// fogLayer.js
// Single responsibility: render fog of war over undiscovered hexes.
//
// Uses an SVG <mask> to cut holes at discovered hex positions,
// feTurbulence filter for cloud-like appearance, and an
// <animateTransform> for slow GPU-driven drift. Zero JavaScript
// during animation — no frame budget impact.
//
// Three states:
//   'off'      — fog hidden, full map visible
//   'explored' — fog over undiscovered hexes only (default)
//   'full'     — fog covers everything (for storyteller reveal)
//
// Zoom fade: fog disappears as viewer zooms in, as if going under clouds.
//
// Layer interface: { id, label, show, hide, toggle, setState,
//                    revealHex, setZoomOpacity, setPreset, setTurbulence }

const NS = "http://www.w3.org/2000/svg";

// ── Tuning constants ───────────────────────────────────────────────────────────
// Everything tweakable lives here. No magic numbers elsewhere in the file.

const FOG = {
  // Drift animation — how far and how fast the fog moves
  driftDurationSec: 25,   // seconds per cycle (higher = slower)
  driftX:           300,  // pixel offset in X direction
  driftY:           150,  // pixel offset in Y direction

  // feTurbulence knobs — these are the main levers for cloud appearance
  baseFrequency:    "0.018 0.012",  // lower = bigger, softer clouds
  baseFrequencyB: "0.014 0.020",  // second layer — different ratio for interference
  numOctaves:       2,              // higher = more detail (costs more GPU)
  seed:             3,              // change for a different cloud layout

  // Cloud alpha sharpness — controls how defined the cloud edges are
  // alpha_out = (cloudSharpness * noise_alpha) + cloudOffset
  // Higher sharpness = harder edges. More negative offset = more gaps.
  cloudSharpness:   8,
  cloudOffset:      -4,
  maskBlurStdDev: 14,   // feathering radius on explored hex edges (px in map space)
  thickenBlurRadius: 18,    // how wide a neighborhood to sample (larger = puffier centers)
  thickenStrength: 0.7,   // 0 = no thickening, 1 = fully multiplied (very dramatic)

  // Zoom fade — fog disappears when zoomed in (as if going beneath the clouds)
  // viewBox width: larger = zoomed out, smaller = zoomed in
  fadeFullyVisible: 500,   // fog at full opacity above this viewBox width
  fadeFullyHidden:  250,   // fog fully gone below this viewBox width

  // Base opacity when fully visible
  baseOpacity: 0.78,

  // Overscan — fog rect is larger than map so drift doesn't reveal edges
  overscanFactor: 0.25,   // 25% extra on each side
};

// ── Color presets ──────────────────────────────────────────────────────────────
// r, g, b are 0–1 floats fed into feColorMatrix.
// These set the fog colour; alpha is always driven by the turbulence noise.
export const FOG_PRESETS = {
  "white": { r: 0.90, g: 0.92, b: 0.95 },
  "blue-grey":  { r: 0.39, g: 0.51, b: 0.63 },
  "dark-grey":  { r: 0.16, g: 0.18, b: 0.22 },
  "warm-cream": { r: 0.86, g: 0.80, b: 0.69 },
};

// ── Main render ────────────────────────────────────────────────────────────────
export function renderFogLayer(svg, hexData, centerFn, pointsFn, {
  initialState = "explored",
  preset       = "white",
  mapW,
  mapH,
} = {}) {

  const color    = FOG_PRESETS[preset] ?? FOG_PRESETS["white"];
  const filterId = "fog-filter";
  const maskId   = "fog-mask";

  const overX = mapW * FOG.overscanFactor;
  const overY = mapH * FOG.overscanFactor;

  // ── Ensure <defs> in SVG ─────────────────────────────────────────────────
  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = document.createElementNS(NS, "defs");
    svg.insertBefore(defs, svg.firstChild);
  }

  // ── Turbulence filter ────────────────────────────────────────────────────
  // feTurbulence generates fractal noise.
  // feColorMatrix converts it to a cloud-shaped alpha with a solid preset colour.
  // The last row of the matrix is: 0 0 0 sharpness offset
  // which maps noise alpha → cloud alpha with a threshold effect.
  const filter = document.createElementNS(NS, "filter");
  filter.setAttribute("id", filterId);
  filter.setAttribute("x", "-10%");
  filter.setAttribute("y", "-10%");
  filter.setAttribute("width",  "120%");
  filter.setAttribute("height", "120%");
  filter.setAttribute("color-interpolation-filters", "sRGB");
  filter.setAttribute("filterRes", "64");

  // ── Layer A: primary cloud field, drifts slowly east ─────────────────────
  const turbA = document.createElementNS(NS, "feTurbulence");
  turbA.setAttribute("type", "fractalNoise");
  turbA.setAttribute("baseFrequency", FOG.baseFrequency);
  turbA.setAttribute("numOctaves", FOG.numOctaves);
  turbA.setAttribute("seed", FOG.seed);
  turbA.setAttribute("result", "noiseA");

  const offsetA = document.createElementNS(NS, "feOffset");
  offsetA.setAttribute("in", "noiseA");
  offsetA.setAttribute("result", "driftA");

  const animAx = document.createElementNS(NS, "animate");
  animAx.setAttribute("attributeName", "dx");
  animAx.setAttribute("from", "0");
  animAx.setAttribute("to", `${FOG.driftX}`);
  animAx.setAttribute("dur", `${FOG.driftDurationSec}s`);
  animAx.setAttribute("repeatCount", "indefinite");

  const animAy = document.createElementNS(NS, "animate");
  animAy.setAttribute("attributeName", "dy");
  animAy.setAttribute("from", "0");
  animAy.setAttribute("to", `${FOG.driftY}`);
  animAy.setAttribute("dur", `${FOG.driftDurationSec}s`);
  animAy.setAttribute("repeatCount", "indefinite");

  offsetA.appendChild(animAx);
  offsetA.appendChild(animAy);

  // ── Layer B: secondary cloud field, drifts at different speed + angle ────
  // Different seed, slightly different frequency, and a different duration —
  // the interference between A and B makes individual clouds appear to morph.
  const turbB = document.createElementNS(NS, "feTurbulence");
  turbB.setAttribute("type", "fractalNoise");
  turbB.setAttribute("baseFrequency", FOG.baseFrequencyB);
  turbB.setAttribute("numOctaves", FOG.numOctaves);
  turbB.setAttribute("seed", FOG.seed + 5);
  turbB.setAttribute("result", "noiseB");

  const offsetB = document.createElementNS(NS, "feOffset");
  offsetB.setAttribute("in", "noiseB");
  offsetB.setAttribute("result", "driftB");

  const animBx = document.createElementNS(NS, "animate");
  animBx.setAttribute("attributeName", "dx");
  animBx.setAttribute("from", "0");
  animBx.setAttribute("to", `${FOG.driftX * 0.6}`);
  animBx.setAttribute("dur", `${FOG.driftDurationSec * 1.4}s`);
  animBx.setAttribute("repeatCount", "indefinite");

  const animBy = document.createElementNS(NS, "animate");
  animBy.setAttribute("attributeName", "dy");
  animBy.setAttribute("from", "0");
  animBy.setAttribute("to", `${FOG.driftY * -0.8}`);  // drifts slightly upward
  animBy.setAttribute("dur", `${FOG.driftDurationSec * 1.4}s`);
  animBy.setAttribute("repeatCount", "indefinite");

  offsetB.appendChild(animBx);
  offsetB.appendChild(animBy);

  // ── Merge A + B ───────────────────────────────────────────────────────────
  const merge = document.createElementNS(NS, "feComposite");
  merge.setAttribute("in", "driftA");
  merge.setAttribute("in2", "driftB");
  merge.setAttribute("operator", "arithmetic");
  merge.setAttribute("k1", "0.5");
  merge.setAttribute("k2", "0.5");
  merge.setAttribute("k3", "0.5");
  merge.setAttribute("k4", "0");
  merge.setAttribute("result", "combined");

  // ── Center-thickening pass ────────────────────────────────────────────────
  // Blur the combined field to get a "neighborhood density" sample.
  // Multiplying original × blurred boosts centers (dense in both) and
  // suppresses edges (diluted by blur). No JS, no per-pixel calculation.
  const thickenBlur = document.createElementNS(NS, "feGaussianBlur");
  thickenBlur.setAttribute("in", "combined");
  thickenBlur.setAttribute("stdDeviation", FOG.thickenBlurRadius);
  thickenBlur.setAttribute("result", "neighborhood");

  const thickenMerge = document.createElementNS(NS, "feComposite");
  thickenMerge.setAttribute("in", "combined");
  thickenMerge.setAttribute("in2", "neighborhood");
  thickenMerge.setAttribute("operator", "arithmetic");
  thickenMerge.setAttribute("k1", `${FOG.thickenStrength}`);
  thickenMerge.setAttribute("k2", `${1 - FOG.thickenStrength}`);
  thickenMerge.setAttribute("k3", "0");
  thickenMerge.setAttribute("k4", "0");
  thickenMerge.setAttribute("result", "thickened");

  // ── Colour + threshold ────────────────────────────────────────────────────
  const colorMatrix = document.createElementNS(NS, "feColorMatrix");
  colorMatrix.setAttribute("type", "matrix");
  colorMatrix.setAttribute("in", "thickened");
  _applyColorMatrix(colorMatrix, color, FOG.cloudSharpness, FOG.cloudOffset);

  filter.appendChild(turbA);
  filter.appendChild(offsetA);
  filter.appendChild(turbB);
  filter.appendChild(offsetB);
  filter.appendChild(merge);
  filter.appendChild(thickenBlur);
  filter.appendChild(thickenMerge);
  filter.appendChild(colorMatrix);
  defs.appendChild(filter);

  // Blur filter applied inside the mask to feather explored hex edges
  const maskBlurFilter = document.createElementNS(NS, "filter");
  maskBlurFilter.setAttribute("id", "fog-mask-blur");
  maskBlurFilter.setAttribute("color-interpolation-filters", "sRGB");
  const maskBlur = document.createElementNS(NS, "feGaussianBlur");
  maskBlur.setAttribute("stdDeviation", FOG.maskBlurStdDev);
  maskBlurFilter.appendChild(maskBlur);
  defs.appendChild(maskBlurFilter);

  // ── Mask ─────────────────────────────────────────────────────────────────
  // maskUnits="userSpaceOnUse" means coordinates match the SVG map space.
  // White = fog visible. Black polygons = holes punched at discovered hexes.
  const mask = document.createElementNS(NS, "mask");
  mask.setAttribute("id",         maskId);
  mask.setAttribute("maskUnits",  "userSpaceOnUse");
  mask.setAttribute("x",          -overX);
  mask.setAttribute("y",          -overY);
  mask.setAttribute("width",      mapW + overX * 2);
  mask.setAttribute("height",     mapH + overY * 2);

  // White background = fog everywhere by default
  const maskBg = document.createElementNS(NS, "rect");
  maskBg.setAttribute("x",      -overX);
  maskBg.setAttribute("y",      -overY);
  maskBg.setAttribute("width",  mapW + overX * 2);
  maskBg.setAttribute("height", mapH + overY * 2);
  maskBg.setAttribute("fill",   "white");
  mask.appendChild(maskBg);

  // One black polygon per discovered hex — each punches a hole in the fog.
  // Wrapped in a blurred <g> so edges feather rather than cut sharply.
  // Stored so setState() can toggle them between black (hole) and white (filled).
  const discoveredPolygons = [];
  const maskHoleGroup = document.createElementNS(NS, "g");
  maskHoleGroup.setAttribute("filter", "url(#fog-mask-blur)");
  mask.appendChild(maskHoleGroup);

  for (const [key, hex] of Object.entries(hexData)) {
    if (!hex?.c) continue; // no colour = undiscovered = leave fogged

    const [c, r] = key.split(",").map(Number);
    const { x, y } = centerFn(c, r);

    const poly = document.createElementNS(NS, "polygon");
    poly.setAttribute("points", pointsFn(x, y));
    poly.setAttribute("fill", "black");
    maskHoleGroup.appendChild(poly);
    discoveredPolygons.push(poly);
  }

  defs.appendChild(mask);

  // ── Fog rectangle + drift animation ──────────────────────────────────────
  // The rect is oversized so drifting never exposes the map edge.
  // The turbulence filter replaces the fill colour with cloud-shaped noise.
  // <animateTransform> runs on the GPU — no JS cost per frame.
  const group = document.createElementNS(NS, "g");
  group.setAttribute("id", "fogLayer");
  group.setAttribute("pointer-events", "none");
  group.style.willChange = "opacity";

  const fogRect = document.createElementNS(NS, "rect");
  fogRect.setAttribute("x",      -overX);
  fogRect.setAttribute("y",      -overY);
  fogRect.setAttribute("width",  mapW + overX * 2);
  fogRect.setAttribute("height", mapH + overY * 2);
  fogRect.setAttribute("fill",   "white"); // colour comes entirely from filter
  fogRect.setAttribute("filter", `url(#${filterId})`);
  fogRect.setAttribute("mask",   `url(#${maskId})`);

  group.appendChild(fogRect);
  svg.appendChild(group);

  // ── State management ──────────────────────────────────────────────────────
  let _state   = null;
  let _opacity = FOG.baseOpacity;

  function setState(state) {
    _state = state;

    if (state === "off") {
      group.setAttribute("display", "none");
      return;
    }

    group.removeAttribute("display");
    group.setAttribute("opacity", _opacity);

    if (state === "full") {
      // All mask polygons filled white — no holes, fog covers everything
      discoveredPolygons.forEach(p => p.setAttribute("fill", "white"));
    } else {
      // explored: black = holes at discovered hexes
      discoveredPolygons.forEach(p => p.setAttribute("fill", "black"));
    }
  }

  // Add a hole for a single hex — used by storyteller mode for incremental reveal
  function revealHex(hexKey) {
    const [c, r] = hexKey.split(",").map(Number);
    const { x, y } = centerFn(c, r);
    const poly = document.createElementNS(NS, "polygon");
    poly.setAttribute("points", pointsFn(x, y));
    poly.setAttribute("fill",   "black");
    mask.appendChild(poly);
  }

  // Called from camera.onChange in app.js — fades fog out as viewer zooms in
  function setZoomOpacity(viewBoxWidth) {
    if (_state === "off") return;
    if (viewBoxWidth >= FOG.fadeFullyVisible) {
      _opacity = FOG.baseOpacity;
    } else if (viewBoxWidth <= FOG.fadeFullyHidden) {
      _opacity = 0;
    } else {
      const t = (viewBoxWidth - FOG.fadeFullyHidden) /
                (FOG.fadeFullyVisible - FOG.fadeFullyHidden);
      _opacity = t * FOG.baseOpacity;
    }
    group.setAttribute("opacity", _opacity);
  }

  // Swap colour preset live — no reload needed
  function setPreset(presetName) {
    const c = FOG_PRESETS[presetName] ?? FOG_PRESETS["white"];
    _applyColorMatrix(colorMatrix, c, FOG.cloudSharpness, FOG.cloudOffset);
  }

  // Tweak turbulence parameters live for experimentation
  // e.g. fogLayer.setTurbulence({ baseFrequency: "0.008", numOctaves: 6 })
  function setTurbulence({ baseFrequency, numOctaves, seed, sharpness, offset } = {}) {
    if (baseFrequency !== undefined)
      turbulenceEl.setAttribute("baseFrequency", baseFrequency);
    if (numOctaves !== undefined)
      turbulenceEl.setAttribute("numOctaves", numOctaves);
    if (seed !== undefined)
      turbulenceEl.setAttribute("seed", seed);
    if (sharpness !== undefined || offset !== undefined) {
      const c = FOG_PRESETS[preset] ?? FOG_PRESETS["white"];
      _applyColorMatrix(
        colorMatrix, c,
        sharpness ?? FOG.cloudSharpness,
        offset    ?? FOG.cloudOffset
      );
    }
  }

  // Adjust mask edge feathering live — e.g. fog.setBlur(6) for subtle, fog.setBlur(20) for dramatic
  function setBlur(stdDeviation) {
    maskBlur.setAttribute("stdDeviation", stdDeviation);
  }

  // Convenience show/hide/toggle for layer panel
  function show()   { setState(_state === "off" ? "explored" : _state); }
  function hide()   { setState("off"); }
  function toggle() { _state === "off" ? show() : hide(); }

  // Apply initial state
  setState(initialState);

  return {
    id:            "fog",
    label:         "Fog of War",
    group,
    show,
    hide,
    toggle,
    setState,
    revealHex,
    setZoomOpacity,
    setPreset,
    setTurbulence,
    setBlur,
  };
}

// ── Private helpers ────────────────────────────────────────────────────────────
function _applyColorMatrix(el, color, sharpness, offset) {
  el.setAttribute("values", [
    `0 0 0 0 ${color.r}`,
    `0 0 0 0 ${color.g}`,
    `0 0 0 0 ${color.b}`,
    `0 0 0 ${sharpness} ${offset}`,
  ].join("  "));
}