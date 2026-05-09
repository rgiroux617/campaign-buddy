// app.js
// The application entry point. Wires all modules together.
//
// Responsibilities:
//   - Load data (mapData.js)
//   - Build the hex grid (hexSvgGrid.js)
//   - Attach the camera (camera.js)
//   - Render entity icons/labels (entityLayer.js)
//   - Handle hex clicks → open card (cardOverlay.js)
//   - Manage zoom-based fade (FADE thresholds)
//
// What this file deliberately does NOT do:
//   - Render any SVG elements itself  (that's hexSvgGrid + entityLayer)
//   - Know how cards look            (that's cardOverlay)
//   - Fetch or parse JSON            (that's mapData)
//   - Animate the camera             (that's camera + future storyPlayer)

import { makeHexMath, buildHexSvgGrid } from "./hexSvgGrid.js";
import { createViewBoxCamera }          from "./camera.js";
import { loadMapData }                  from "./mapData.js";
import { renderEntityLayer }            from "./entityLayer.js";
import { createCardOverlay }            from "./cardOverlay.js";
import { renderPathLayer }              from "./pathLayer.js";
import { renderLineLayer }              from "./lineLayer.js";
import { createLineDrawTool }           from "./lineDrawTool.js";
import { createShipPathDrawTool }       from "./shipPathDrawTool.js";
import { createLandPathDrawTool }       from "./landPathDrawTool.js";
import { createLandMovement }           from "./landMovement.js";
// import { createAdOverlay }              from "./adOverlay.js";  // disabled
import { renderFogLayer }               from "./fogLayer.js";
import { renderShipLayer }              from "./shipLayer.js";
import { createShipPanel }              from "./shipPanel.js";
import { createCameraJourney }          from "./cameraJourney.js";
// import { introJourney }                 from "./journeys.js";
import { createShipMovement }           from "./shipMovement.js";
import { createHelmetLayer }            from "./helmetLayer.js";
import { createWaterLayer }             from "./waterLayer.js";
import { introJourney, zoomJourney }    from "./journeys.js";
import { createSessionPlayer }          from "./sessionPlayer.js";
import { createAudioPlayer }            from "./audio/audioPlayer.js";

// ─── Grid constants ───────────────────────────────────────────────────────────
const COLS = 52;
const ROWS = 33;
const SIZE = 22;
const PAD  = 20;

// ─── Zoom-fade thresholds ─────────────────────────────────────────────────────
// All opacity transitions use viewBox width (v.w) as the zoom signal.
//   showBelow = fully visible when zoomed IN past this width
//   hideAbove = fully hidden  when zoomed OUT past this width
const FADE = {
  grid:   { showBelow: 1200, hideAbove: 1800 },
  labels: { showBelow:  600, hideAbove: 1000 },
  lines:  { showBelow:  600, hideAbove: 1000 },
  icons:  { showBelow:  600, hideAbove: 1000 },
};

// ── Shadow constants ──────────────────────────────────────────────────────────
// Shadow shifts direction and grows as camera zooms in and map rotates.
// zoomFull = viewBox width at which shadow is fully visible
// zoomNone = viewBox width at which shadow fades to nothing
const SHADOW = {
  zoomFull: 50,   // fully visible when zoomed in past this
  zoomNone: 900,   // invisible when zoomed out past this
  maxLength: 26,     // maximum shadow offset in map units
  blur: 20,     // shadow blur radius in map units
  color: "rgba(94, 93, 93, 0.25)",
};
const SHIP_SHADOW_SCALE = 0.1;

const GRID_STYLE = { strokeOpacity: 0.15 };

// ─── Per-color fill-opacity overrides ────────────────────────────────────────
// Any hex whose stored color matches a key here uses that opacity instead of
// the default 0.95. Keys must be lowercase hex strings exactly as they appear
// in campaign_default.json.
const HEX_COLOR_OPACITY = {
  "#3c6270": 0.0,  // sea / water blue
};

// ─── Entry point ─────────────────────────────────────────────────────────────
  (async () => {

    // 1. Load all data in parallel
    const { hexData, entities, pathData, linesData, shipPathData, landData, sessions } = await loadMapData();

    // 2. Set up hex math (geometry only, no DOM yet)
    const { center, points, computeBounds } = makeHexMath({ COLS, ROWS, SIZE, PAD });
    window.center = center;
    window.pathData = pathData;
    window.logShipPath = () => {
      const seaHexes = pathData
        .filter(e => e.type === "sea")
        .map(e => {
          const [c, r] = e.hex.split(",").map(Number);
          const { x, y } = center(c, r);
          return `  { "x": ${x.toFixed(2)}, "y": ${y.toFixed(2)} }`;
        });
      console.log("[\n" + seaHexes.join(",\n") + "\n]");
    };

    // 3. Get the SVG element and attach the camera
    const svg    = document.getElementById("grid");
    const camera = createViewBoxCamera(svg);
    window.camera = camera;

    // 4. Build the hex grid into a <g id="hexLayer"> group
    const hexLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    hexLayer.setAttribute("id", "hexLayer");
    svg.appendChild(hexLayer);

    const { w, h, polyByKey } = buildHexSvgGrid({
      svg: hexLayer,
      COLS, ROWS,
      center, points, computeBounds,
      setVisual: (poly, c, r) => _setVisual(poly, c, r, hexData),
      onClickHex: (c, r, poly) => _onClickHex(c, r, poly),
      makeIconText: false,
    });


    // 5b. Render fog of war (above path, below entity icons)
    // const fogLayer = renderFogLayer(svg, hexData, center, points, {
    //   initialState: "explored",
    //   preset: "white",
    //   mapW: w,
    //   mapH: h,
    // });

    // window.fog = fogLayer;

    const allPolygons = Array.from(hexLayer.querySelectorAll("polygon"));

    // Size the SVG to the computed grid bounds
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);

    // Water background — SVG <image> placed as the very first child of the SVG,
    // behind all hex polygons. Because it lives in SVG coordinate space it is
    // automatically the exact same size as the hex grid and zooms / pans in
    // perfect lockstep with no external sizing math needed.
    const SVG_NS = "http://www.w3.org/2000/svg";
    const waterImgEl = document.createElementNS(SVG_NS, "image");
    waterImgEl.setAttribute("href", "WaterBackground.jpeg");
    waterImgEl.setAttribute("x", 0);
    waterImgEl.setAttribute("y", 0);
    waterImgEl.setAttribute("width", w);
    waterImgEl.setAttribute("height", h);
    waterImgEl.setAttribute("preserveAspectRatio", "xMidYMid slice");
    waterImgEl.setAttribute("pointer-events", "none");
    svg.insertBefore(waterImgEl, hexLayer);

    // Water animation layer — disabled while we stabilise sizing.
    // Re-enable once the SVG image approach is confirmed working.
    // const waterLayer = createWaterLayer({ ... });
    const waterLayer = { toggle() {}, isEnabled() { return false; }, enable() {}, disable() {} };
    window.waterLayer = waterLayer;

    // 5. Render rivers, roads, and misc lines (below path and entities)
    const lineLayer = renderLineLayer(svg, linesData);

    // 5a. Set up the draw tool — wired to toolbar buttons in index.html
    const drawStatusEl = document.getElementById("draw-status");
    const drawTool = createLineDrawTool({
      svg,
      linesData,
      statusEl: drawStatusEl,
      onSaved: (newLine) => lineLayer.addLine(newLine),
    });
    window.drawTool = drawTool; // expose for console use if needed

    // Wire river/road/misc buttons: clicking the active type a second time cancels.
    // Water and ship buttons are handled separately below — skip them here.
    document.querySelectorAll(".draw-btn:not([data-type='water']):not([data-type='ship']):not([data-type='land'])").forEach(btn => {
      btn.addEventListener("click", () => {
        const type = btn.dataset.type;
        if (drawTool.isActive()) {
          drawTool.deactivate();
          document.querySelectorAll(".draw-btn").forEach(b => b.classList.remove("active"));
          drawStatusEl.textContent = "";
        } else {
          drawTool.activate(type);
          document.querySelectorAll(".draw-btn").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
        }
      });
    });

    // 5a-ii. Ship path draw tool
    const shipPathDrawTool = createShipPathDrawTool({
      svg,
      shipPathData,
      statusEl: drawStatusEl,
      onSaved: () => {
        // Rebuild shipMove so the new segment is live without a page reload
        window.shipMove = createShipMovement(shipLayer, shipPathData, helmetLayer, landMovement);
      },
    });
    window.shipPathDrawTool = shipPathDrawTool; // expose for console use if needed

    // Wire the Ship Path button — clicking while active cancels
    const shipPathBtn = document.querySelector(".draw-btn[data-type='ship']");
    if (shipPathBtn) {
      shipPathBtn.addEventListener("click", () => {
        if (shipPathDrawTool.isActive()) {
          shipPathDrawTool.deactivate();
          document.querySelectorAll(".draw-btn").forEach(b => b.classList.remove("active"));
          drawStatusEl.textContent = "";
        } else {
          shipPathDrawTool.activate();
          document.querySelectorAll(".draw-btn").forEach(b => b.classList.remove("active"));
          shipPathBtn.classList.add("active");
        }
      });
    }

    // 5a-iii. Land path draw tool
    const landPathDrawTool = createLandPathDrawTool({
      svg,
      shipPathData,
      landData,
      statusEl: drawStatusEl,
      onSaved: () => {
        // Rebuild landMovement so the new path is live without a page reload
        landMovement.rebuild();
      },
    });
    window.landPathDrawTool = landPathDrawTool;

    // Wire the Land Path button — clicking while active cancels
    const landPathBtn = document.querySelector(".draw-btn[data-type='land']");
    if (landPathBtn) {
      landPathBtn.addEventListener("click", () => {
        if (landPathDrawTool.isActive()) {
          landPathDrawTool.deactivate();
          document.querySelectorAll(".draw-btn").forEach(b => b.classList.remove("active"));
          drawStatusEl.textContent = "";
        } else {
          landPathDrawTool.activate();
          // activate() prompts for entityId — if cancelled it stays inactive
          if (landPathDrawTool.isActive()) {
            document.querySelectorAll(".draw-btn").forEach(b => b.classList.remove("active"));
            landPathBtn.classList.add("active");
          }
        }
      });
    }

    // Water FX toggle button — independent of the draw tool
    const waterBtn = document.querySelector(".draw-btn[data-type='water']");
    if (waterBtn) {
      // Start with the button showing the current state (enabled by default)
      waterBtn.classList.add("active");
      waterBtn.addEventListener("click", () => {
        waterLayer.toggle();
        waterBtn.classList.toggle("active", waterLayer.isEnabled());
      });
    }

    // 5b. Render travel path (below entities in z-order)
    const pathLayer = renderPathLayer(svg, pathData, center, entities);

    // Exclude the ship — rendered separately by shipLayer with zoom-swap behaviour
    const nonShipEntities = entities.filter(e => e.id !== "implication");
    await renderEntityLayer(svg, nonShipEntities, center);

    // Render ship with zoom-aware asset swapping.
    // Hex position comes from entities.json — move the ship there, it follows.
    const shipEntity = entities.find(e => e.id === "implication");
    const shipHex    = shipEntity.hex;
    const [sc, sr]   = shipHex.split(",").map(Number);
    const shipPos    = center(sc, sr);
    const shipLayer  = await renderShipLayer(svg, shipHex, center);
    shipLayer.startAnimation();
    window.ship = shipLayer;

    // Helmet layer — renders the land-traversal marker.
    // Created after shipLayer so we can insert it just below the ship in z-order,
    // ensuring the ship renders on top during brief shore overlaps.
    const helmetLayer = await createHelmetLayer(svg);
    svg.insertBefore(helmetLayer.group, shipLayer.group);
    window.helmet = helmetLayer;

    // Ship detail panel — click on ship hex opens panel instead of regular card
    const shipPanel = createShipPanel(document.body, {
      camera,
      shipLayer,
      shipX: shipPos.x,
      shipY: shipPos.y,
      hexSize: SIZE,
      svg,
    });
    window.shipPanel = shipPanel;


    // Build a fast lookup: hex key → entity (for click handling)
    // Normalize hex keys by parsing to Number so "21,05" and "21,5" both become "21,5"
    const entityByHex = new Map(entities.map(e => {
      const [c, r] = e.hex.split(",").map(Number);
      return [`${c},${r}`, e];
    }));

    // 6. Set up the card overlay
    // adOverlay disabled — stub keeps cardOverlay working without ad popups
    const adOverlay = { open: () => {}, close: () => {} };
    const card = createCardOverlay(document.body, adOverlay);

    // Expose app objects for console testing and journey callbacks
    window.card = card;
    window.journey = createCameraJourney(camera, center, svg);
    window.introJourney = introJourney;
    const landMovement = createLandMovement(helmetLayer, landData);
    window.landMove  = landMovement;
    window.shipMove  = createShipMovement(shipLayer, shipPathData, helmetLayer, landMovement);
    window.zoomJourney = zoomJourney;

    // ── Session player ────────────────────────────────────────────────────────
    const sessionPlayer = createSessionPlayer(window.shipMove, camera, svg, shipPathData);
    window.sessionPlayer = sessionPlayer;

    // ── Tab toggle ────────────────────────────────────────────────────────────
    document.querySelectorAll('.toolbar-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const panelId = tab.dataset.panel + '-panel';
        document.querySelectorAll('.toolbar-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.toolbar-panel').forEach(p => { p.hidden = true; });
        tab.classList.add('active');
        document.getElementById(panelId).hidden = false;
      });
    });

    // ── Session recap buttons ────────────────────────────────────────────────
    const sessionList    = document.getElementById('session-list');
    const sessionStopBtn = document.getElementById('session-stop-btn');
    const viewPanel      = document.getElementById('view-panel');
    let _activeSessionBtn = null;

    function _setSessionPlaying(playing) {
      if (playing) {
        viewPanel.classList.add('session-playing');
        camera.lockZoom();
        shipLayer.stopAnimation();   // free RAF budget for path movement
      } else {
        viewPanel.classList.remove('session-playing');
        camera.unlockZoom();
        shipLayer.startAnimation();  // restore idle animations after session
      }
    }
    const _audioPlayer = createAudioPlayer();

    // Pre-fetch all session audio files now, while the app is loading and the
    // user hasn't clicked anything yet.  No gesture is needed for fetch() —
    // only AudioContext.resume() needs to be inside a gesture, and that still
    // happens in the button handler below.  By the time the user clicks a
    // session button the raw MP3 data is already in memory, so play() only
    // needs to resume the context + decode + start — fast enough to beat the
    // 800 ms audio-lead window in sessionPlayer.
    _audioPlayer.preload(
      (sessions ?? []).filter(s => s.audio).map(s => `./audio/${s.audio}`)
    );

    function _clearSession() {
      sessionPlayer.stop();
      _audioPlayer.stop();
      if (_activeSessionBtn) {
        _activeSessionBtn.classList.remove('active');
        _activeSessionBtn = null;
      }
      sessionStopBtn.hidden = true;
      _setSessionPlaying(false);
    }

    for (const session of (sessions ?? [])) {
      const btn = document.createElement('button');
      btn.className   = 'session-recap-btn';
      btn.textContent = '▶  ' + session.name;
      btn.addEventListener('click', async () => {
        // Stop any currently running session first
        _clearSession();
        _activeSessionBtn = btn;
        btn.classList.add('active');
        sessionStopBtn.hidden = false;
        _setSessionPlaying(true);

        // Start audio immediately (iOS requires play() inside a direct user gesture)
        if (session.audio) {
          _audioPlayer.play(`./audio/${session.audio}`).catch(() => { });
        }

        await sessionPlayer.playSession(session);
        // Session finished naturally — clean up UI
        btn.classList.remove('active');
        if (_activeSessionBtn === btn) {
          _activeSessionBtn = null;
          sessionStopBtn.hidden = true;
          _setSessionPlaying(false);
        }
      });
      sessionList.appendChild(btn);
    }

    sessionStopBtn.addEventListener('click', _clearSession);

    // ── Layer toggles ────────────────────────────────────────────────────────
    // Each entry needs a label and a toggle() function.
    // lineLayer and pathLayer already expose show/hide/toggle.
    const layerToggles = document.getElementById('layer-toggles');
    const _layerDefs = [
      { label: 'Roads & Rivers', toggle: () => lineLayer.toggle() },
      { label: 'Travel Path',    toggle: () => pathLayer.toggle() },
    ];
    for (const def of _layerDefs) {
      const btn = document.createElement('button');
      btn.className   = 'layer-toggle-btn';
      btn.textContent = def.label;
      btn.addEventListener('click', () => {
        btn.classList.toggle('off');
        def.toggle();
      });
      layerToggles.appendChild(btn);
    }

    // 7. Camera onChange → update fade opacities

    // 7. Camera onChange → update fade opacities
    camera.onChange((v) => {
      // Hex grid strokes
      const strokeOpacity =
        GRID_STYLE.strokeOpacity * _fadeValue(v.w, FADE.grid.showBelow, FADE.grid.hideAbove);
      allPolygons.forEach(poly =>
        poly.setAttribute("stroke-opacity", strokeOpacity)
      );

      // Entity labels, lines, and icons
      const labelOpacity = 1 - _fadeValue(v.w, FADE.labels.showBelow, FADE.labels.hideAbove);
      const lineOpacity  = 1 - _fadeValue(v.w, FADE.lines.showBelow,  FADE.lines.hideAbove);
      const iconOpacity  =     _fadeValue(v.w, FADE.icons.showBelow,  FADE.icons.hideAbove);

      entities.forEach(entity => {
        entity._label?.setAttribute("opacity", labelOpacity);
        entity._line?.setAttribute("opacity",  lineOpacity);
        entity._icon?.setAttribute("opacity",  iconOpacity);
      });

      // Fog zoom fade — fades out as viewer zooms in beneath the clouds
      // fogLayer.setZoomOpacity(v.w);

      shipLayer.setZoomLevel(v.w);

      // ── Cast shadow — perspective-flattened, zoom and rotation responsive ──
      const shadowStrength = Math.max(0, Math.min(1,
        (SHADOW.zoomNone - v.w) / (SHADOW.zoomNone - SHADOW.zoomFull)
      ));

      if (shadowStrength > 0 && iconOpacity > 0) {
        const SHADOW_BIAS_DEG = -45;
        const rotRad = ((journey.getRotation() + SHADOW_BIAS_DEG) * Math.PI) / 180;
        const length = SHADOW.maxLength * shadowStrength;
        const offsetX = length * Math.sin(rotRad);
        const offsetY = length * Math.cos(rotRad);

        // Flatten shadow vertically as zoom increases — simulates low sun angle
        // 1.0 = full height (zoomed out), 0.15 = very flat (fully zoomed in)
        const flattenY = 1.0 - shadowStrength * 0.45;

        entities.forEach(entity => {
          if (!entity._shadow) return;
          const { _mapX: ex, _mapY: ey, _iconScale: sc,
            _vbOffX: vbx, _vbOffY: vby } = entity;

          // Fixed sun direction — bias alone controls shadow angle, no travel influence.
          const skewDeg = SHADOW_BIAS_DEG.toFixed(2);

          const ax = entity._shadowAnchorX.toFixed(2);
          const ay = entity._shadowAnchorY.toFixed(2);

          // bottomOffY shifts icon content so its bottom center sits at the origin.
          // vbOffY centers on the content bbox midpoint, so subtracting half the
          // bbox height moves us down to the bottom edge.
          const bboxHalfH = (entity._vbH / 2).toFixed(2);
          const bottomOffY = (entity._vbOffY - bboxHalfH).toFixed(2);

          entity._shadow.setAttribute("transform",
            `translate(${ax}, ${ay}) ` +
            `scale(${sc.toFixed(4)}, ${(sc * flattenY).toFixed(4)}) ` +
            `skewX(${skewDeg}) ` +
            `translate(${vbx.toFixed(2)}, ${bottomOffY})`
          );
          entity._shadow.setAttribute("opacity",
            (iconOpacity * shadowStrength * 0.3).toFixed(3)
          );
        });

        // Ship shadow — keep existing approach at reduced scale
        const shipScale = SHIP_SHADOW_SCALE;
        const shipFilter = `drop-shadow(${(offsetX * shipScale).toFixed(2)}px ${(offsetY * shipScale).toFixed(2)}px ${(SHADOW.blur * shadowStrength * shipScale).toFixed(2)}px ${SHADOW.color})`;
        shipLayer.setShadow(shipFilter);

      } else {
        entities.forEach(entity => {
          if (entity._shadow) entity._shadow.setAttribute("opacity", "0");
        });
        shipLayer.setShadow('');
      }
    });


    // ── Grid border + outside overlay ────────────────────────────────────────
    // All elements are in SVG map coordinates so they zoom and pan with the grid.
    //
    // Layer order (bottom to top):
    //   1. Outside overlay  — translucent white fill masked to the area outside
    //      the grid rect; covers water background when zoomed out to see edges.
    //   2. Blurred glow     — soft white stroke just inside the grid boundary.
    //   3. Crisp ring       — sharp white stroke on top of the glow.
    //
    // Tuning:
    //   BORDER_WIDTH    — crisp ring thickness (map units)
    //   GLOW_WIDTH      — blurred glow stroke thickness (map units)
    //   GLOW_BLUR       — feGaussianBlur stdDeviation (map units)
    //   OUTSIDE_OPACITY — opacity of the outside fill (0-1)
    {
      const SVG_NS          = "http://www.w3.org/2000/svg";
      const BORDER_WIDTH    = 5;
      const GLOW_WIDTH      = 12;
      const GLOW_BLUR       = 10;
      const INSET           = 2;    // aligns overlay edge with border stroke center
      const OUTSIDE_OPACITY = 0.45;
      const FAR             = 9999; // overlay extends this far beyond grid in map units

      // ── Shared <defs> ────────────────────────────────────────────────────────
      const defs = document.createElementNS(SVG_NS, "defs");

      // Blur filter for the glow ring
      const filter = document.createElementNS(SVG_NS, "filter");
      filter.setAttribute("id",     "border-blur");
      filter.setAttribute("x",      "-10%");
      filter.setAttribute("y",      "-10%");
      filter.setAttribute("width",  "120%");
      filter.setAttribute("height", "120%");
      const blurEl = document.createElementNS(SVG_NS, "feGaussianBlur");
      blurEl.setAttribute("stdDeviation", GLOW_BLUR);
      filter.appendChild(blurEl);
      defs.appendChild(filter);

      // Mask: white everywhere (show overlay) with a black hole cut out for the grid
      // White pixels in a mask = visible, black = transparent.
      const mask = document.createElementNS(SVG_NS, "mask");
      mask.setAttribute("id", "outside-mask");
      const maskBg = document.createElementNS(SVG_NS, "rect");
      maskBg.setAttribute("x",      -FAR);
      maskBg.setAttribute("y",      -FAR);
      maskBg.setAttribute("width",  w + FAR * 2);
      maskBg.setAttribute("height", h + FAR * 2);
      maskBg.setAttribute("fill",   "white");
      mask.appendChild(maskBg);
      const maskHole = document.createElementNS(SVG_NS, "rect");
      maskHole.setAttribute("x",      INSET);
      maskHole.setAttribute("y",      INSET);
      maskHole.setAttribute("width",  w - INSET * 2);
      maskHole.setAttribute("height", h - INSET * 2);
      maskHole.setAttribute("fill",   "black");
      mask.appendChild(maskHole);
      defs.appendChild(mask);

      svg.appendChild(defs);

      // ── Outside overlay ──────────────────────────────────────────────────────
      const outsideOverlay = document.createElementNS(SVG_NS, "rect");
      outsideOverlay.setAttribute("x",              -FAR);
      outsideOverlay.setAttribute("y",              -FAR);
      outsideOverlay.setAttribute("width",          w + FAR * 2);
      outsideOverlay.setAttribute("height",         h + FAR * 2);
      outsideOverlay.setAttribute("fill",           "white");
      outsideOverlay.setAttribute("opacity",        OUTSIDE_OPACITY);
      outsideOverlay.setAttribute("mask",           "url(#outside-mask)");
      outsideOverlay.setAttribute("pointer-events", "none");
      svg.appendChild(outsideOverlay);

      // ── Blurred glow (below the crisp ring) ──────────────────────────────────
      const borderGlow = document.createElementNS(SVG_NS, "rect");
      borderGlow.setAttribute("x",              INSET);
      borderGlow.setAttribute("y",              INSET);
      borderGlow.setAttribute("width",          w - INSET * 2);
      borderGlow.setAttribute("height",         h - INSET * 2);
      borderGlow.setAttribute("fill",           "none");
      borderGlow.setAttribute("stroke",         "white");
      borderGlow.setAttribute("stroke-width",   GLOW_WIDTH);
      borderGlow.setAttribute("filter",         "url(#border-blur)");
      borderGlow.setAttribute("opacity",        "0.22");
      borderGlow.setAttribute("pointer-events", "none");
      svg.appendChild(borderGlow);

      // ── Crisp ring (topmost) ──────────────────────────────────────────────────
      const borderCrisp = document.createElementNS(SVG_NS, "rect");
      borderCrisp.setAttribute("x",              INSET);
      borderCrisp.setAttribute("y",              INSET);
      borderCrisp.setAttribute("width",          w - INSET * 2);
      borderCrisp.setAttribute("height",         h - INSET * 2);
      borderCrisp.setAttribute("fill",           "none");
      borderCrisp.setAttribute("stroke",         "white");
      borderCrisp.setAttribute("stroke-width",   BORDER_WIDTH);
      borderCrisp.setAttribute("opacity",        "0.40");
      borderCrisp.setAttribute("pointer-events", "none");
      svg.appendChild(borderCrisp);
    }

    // ── Click handler ───────────────────────────────────────────────────────
    // Builds a cardData object from whatever we know about this hex and opens
    // the card overlay. Priority: entity data > raw hex note > nothing.
    function _onClickHex(c, r, poly) {
      // Draw tools intercept clicks on the SVG — don't open cards while drawing
      if (drawTool.isActive() || shipPathDrawTool.isActive() || landPathDrawTool.isActive()) return;

      const hexKey = `${c},${r}`;
      const hex    = hexData[hexKey];
      const entity = entityByHex.get(hexKey);

      // Ship hex opens the ship panel instead of the regular card
      if (entity?.id === "implication") {
        const shipEntity = entities.find(e => e.id === "implication");
        shipPanel.open(shipEntity?.card ?? {});
        return;
      }

      // Only open a card if there is an entity to show
      if (!entity) return;

      const cardData = {
        title: entity?.name ?? `Hex ${hexKey}`,
        subtitle: entity?.card?.subtitle ?? null,
        icon: entity?.icon ?? null,
        body: entity?.card?.body ?? null,
        quote: entity?.card?.quote ?? null,
        npcs: entity?.card?.npcs ?? null,
        tags: entity?.card?.tags ?? null,
        adId: entity?.card?.adId ?? null,
      };

      card.open(cardData, hexKey);
    }

  })(); // end async IIFE

// ─── Pure helpers (no side effects) ──────────────────────────────────────────

// Sets the visual appearance of a single hex polygon based on stored data.
// Called by buildHexSvgGrid for initial render, and by onLeaveHex for hover reset.
function _setVisual(poly, c, r, hexData) {
  const h = hexData[`${c},${r}`];

  if (h?.c) {
    poly.setAttribute("fill", h.c);
    const opacity = HEX_COLOR_OPACITY[h.c.toLowerCase()] ?? 0.95;
    poly.setAttribute("fill-opacity", opacity);
  } else {
    poly.setAttribute("fill", "#ffffff");
    poly.setAttribute("fill-opacity", "0.03");
  }

  poly.setAttribute("stroke", "white");
  poly.setAttribute("stroke-opacity", GRID_STYLE.strokeOpacity);
  poly.setAttribute("stroke-width", "1");
  poly.style.cursor = "inherit";
  poly.style.pointerEvents = "all";

  // Emoji icon text node (attached by buildHexSvgGrid when makeIconText: true)
  if (poly._hexIcon) {
    const icon = h?.icon ?? "";
    poly._hexIcon.textContent = icon;
    poly._hexIcon.style.display = icon ? "block" : "none";
  }
}

// Returns a 0→1 value as viewBox width moves from showBelow up to hideAbove.
function _fadeValue(vw, showBelow, hideAbove) {
  if (vw <= showBelow) return 1;
  if (vw >= hideAbove) return 0;
  return 1 - (vw - showBelow) / (hideAbove - showBelow);
}


