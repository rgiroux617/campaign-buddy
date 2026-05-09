// fogLayer.js
// Single responsibility: render fog of war over undiscovered hexes.
//
// Architecture: two layers sharing one mask.
//   Background layer — full map, flat colour, essentially free to render.
//   Detail layer     — bounding box around explored hexes only, full
//                      two-field turbulence + center-thickening treatment.
//                      Smaller compute region = smooth animation.
//
// Three states:
//   'off'      — fog hidden, full map visible
//   'explored' — fog over undiscovered hexes only (default)
//   'full'     — fog covers everything (for storyteller reveal)
//
// Zoom fade: fog disappears as viewer zooms in, as if going under clouds.
//
// Layer interface:
//   { id, label, group, show, hide, toggle, setState,
//     revealHex, setZoomOpacity, setPreset, setTurbulence, setBlur }
//
// Console tuning (after window.fog = fogLayer in app.js):
//   fog.setState("off" | "explored" | "full")
//   fog.setPreset("blue-grey" | "dark-grey" | "white" | "warm-cream")
//   fog.setTurbulence({ baseFrequency, numOctaves, seed, sharpness, offset })
//   fog.setBlur(10)   — feather radius on explored hex edges

const NS = "http://www.w3.org/2000/svg";

// ── Tuning constants ──────────────────────────────────────────────────────────
const FOG = {
  // Detail layer drift — feOffset moves the noise, not the rect or mask
  driftDurationSec: 25,
  driftX:           300,
  driftY:           150,

  // Primary turbulence field
  baseFrequency:    "0.018 0.012",
  baseFrequencyB:   "0.014 0.020",  // second field — different ratio for interference
  numOctaves:       1,              // keep low for performance; 2 adds detail at cost
  seed:             3,

  // feColorMatrix sharpness — higher = harder cloud edges, more negative offset = more gaps
  cloudSharpness:   12,
  cloudOffset:      -4,

  // Center-thickening — blur×multiply boosts cloud centers without JS
  thickenBlurRadius: 18,
  thickenStrength:   0.7,   // 0 = none, 1 = fully multiplied

  // Mask edge feathering — blurs the black cutout polygons so edges are soft
  maskBlurStdDev:   10,

  // filterRes — caps internal render resolution; biggest performance lever
  filterRes:        "256",

  // Zoom fade thresholds (viewBox width)
  fadeFullyVisible: 500,
  fadeFullyHidden:  250,
  baseOpacity:      0.88,

  // Padding beyond explored bbox for the detail layer (map units)
  exploredPadding:  120,
};

// ── Colour presets ────────────────────────────────────────────────────────────
// r, g, b are 0–1 floats used in feColorMatrix and converted to CSS for the
// flat background rect so both layers match visually.
export const FOG_PRESETS = {
  "blue-grey":  { r: 0.39, g: 0.51, b: 0.63 },
  "dark-grey":  { r: 0.16, g: 0.18, b: 0.22 },
  "white":      { r: 0.90, g: 0.92, b: 0.95 },
  "warm-cream": { r: 0.86, g: 0.80, b: 0.69 },
};

// ── Main render ───────────────────────────────────────────────────────────────
export function renderFogLayer(svg, hexData, centerFn, pointsFn, {
  initialState = "explored",
  preset       = "blue-grey",
  mapW,
  mapH,
} = {}) {

  let color    = FOG_PRESETS[preset] ?? FOG_PRESETS["blue-grey"];
  const filterId      = "fog-filter";
  const maskBlurId    = "fog-mask-blur";
  const maskId        = "fog-mask";

  // ── Ensure <defs> ─────────────────────────────────────────────────────────
  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = document.createElementNS(NS, "defs");
    svg.insertBefore(defs, svg.firstChild);
  }

  // ── Bounding box of explored hexes ────────────────────────────────────────
  // The expensive turbulence filter only covers this region + padding,
  // dramatically reducing the pixel area it must compute.
  let bboxMinX = Infinity, bboxMinY = Infinity;
  let bboxMaxX = -Infinity, bboxMaxY = -Infinity;

  for (const [key, hex] of Object.entries(hexData)) {
    if (!hex?.c) continue;
    const [c, r] = key.split(",").map(Number);
    const { x, y } = centerFn(c, r);
    if (x < bboxMinX) bboxMinX = x;
    if (y < bboxMinY) bboxMinY = y;
    if (x > bboxMaxX) bboxMaxX = x;
    if (y > bboxMaxY) bboxMaxY = y;
  }

  const pad   = FOG.exploredPadding;
  const detailX = bboxMinX - pad;
  const detailY = bboxMinY - pad;
  const detailW = (bboxMaxX - bboxMinX) + pad * 2;
  const detailH = (bboxMaxY - bboxMinY) + pad * 2;

  // ── Mask blur filter ──────────────────────────────────────────────────────
  // Applied inside the mask to feather explored hex edges.
  const maskBlurFilter = document.createElementNS(NS, "filter");
  maskBlurFilter.setAttribute("id", maskBlurId);
  maskBlurFilter.setAttribute("color-interpolation-filters", "sRGB");
  const maskBlurEl = document.createElementNS(NS, "feGaussianBlur");
  maskBlurEl.setAttribute("stdDeviation", FOG.maskBlurStdDev);
  maskBlurFilter.appendChild(maskBlurEl);
  defs.appendChild(maskBlurFilter);

  // ── Turbulence filter ─────────────────────────────────────────────────────
  // Two independent noise fields drift at different speeds and angles.
  // Their feComposite interference creates cloud shape-morphing.
  // A blur×multiply pass boosts cloud centers to give them apparent thickness.
  const filter = document.createElementNS(NS, "filter");
  filter.setAttribute("id",      filterId);
  filter.setAttribute("x",       "0%");
  filter.setAttribute("y",       "0%");
  filter.setAttribute("width",   "100%");
  filter.setAttribute("height",  "100%");
  filter.setAttribute("filterRes", FOG.filterRes);
  filter.setAttribute("color-interpolation-filters", "sRGB");

  // Field A — primary drift
  const turbA = document.createElementNS(NS, "feTurbulence");
  turbA.setAttribute("type",          "fractalNoise");
  turbA.setAttribute("baseFrequency", FOG.baseFrequency);
  turbA.setAttribute("numOctaves",    FOG.numOctaves);
  turbA.setAttribute("seed",          FOG.seed);
  turbA.setAttribute("result",        "noiseA");

  const offsetA = document.createElementNS(NS, "feOffset");
  offsetA.setAttribute("in",     "noiseA");
  offsetA.setAttribute("result", "driftA");
  const animAx = _makeAnimate("dx", "0", `${FOG.driftX}`, FOG.driftDurationSec);
  const animAy = _makeAnimate("dy", "0", `${FOG.driftY}`, FOG.driftDurationSec);
  offsetA.appendChild(animAx);
  offsetA.appendChild(animAy);

  // Field B — secondary drift, different speed and direction
  const turbB = document.createElementNS(NS, "feTurbulence");
  turbB.setAttribute("type",          "fractalNoise");
  turbB.setAttribute("baseFrequency", FOG.baseFrequencyB);
  turbB.setAttribute("numOctaves",    FOG.numOctaves);
  turbB.setAttribute("seed",          FOG.seed + 5);
  turbB.setAttribute("result",        "noiseB");

  const offsetB = document.createElementNS(NS, "feOffset");
  offsetB.setAttribute("in",     "noiseB");
  offsetB.setAttribute("result", "driftB");
  const animBx = _makeAnimate("dx", "0", `${FOG.driftX * 0.6}`,  FOG.driftDurationSec * 1.4);
  const animBy = _makeAnimate("dy", "0", `${FOG.driftY * -0.8}`, FOG.driftDurationSec * 1.4);
  offsetB.appendChild(animBx);
  offsetB.appendChild(animBy);

  // Merge A + B — additive blend preserves coverage, multiplicative term creates morphing
  const merge = document.createElementNS(NS, "feComposite");
  merge.setAttribute("in",       "driftA");
  merge.setAttribute("in2",      "driftB");
  merge.setAttribute("operator", "arithmetic");
  merge.setAttribute("k1",       "0.5");
  merge.setAttribute("k2",       "0.5");
  merge.setAttribute("k3",       "0.5");
  merge.setAttribute("k4",       "0");
  merge.setAttribute("result",   "combined");

  // Thickening — blur samples neighborhood density, multiply boosts centers
  const thickenBlur = document.createElementNS(NS, "feGaussianBlur");
  thickenBlur.setAttribute("in",            "combined");
  thickenBlur.setAttribute("stdDeviation",  FOG.thickenBlurRadius);
  thickenBlur.setAttribute("result",        "neighborhood");

  const thickenMerge = document.createElementNS(NS, "feComposite");
  thickenMerge.setAttribute("in",       "combined");
  thickenMerge.setAttribute("in2",      "neighborhood");
  thickenMerge.setAttribute("operator", "arithmetic");
  thickenMerge.setAttribute("k1",       `${FOG.thickenStrength}`);
  thickenMerge.setAttribute("k2",       `${1 - FOG.thickenStrength}`);
  thickenMerge.setAttribute("k3",       "0");
  thickenMerge.setAttribute("k4",       "0");
  thickenMerge.setAttribute("result",   "thickened");

  // Colour + threshold
  const colorMatrix = document.createElementNS(NS, "feColorMatrix");
  colorMatrix.setAttribute("type", "matrix");
  colorMatrix.setAttribute("in",   "thickened");
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

  // ── Mask ──────────────────────────────────────────────────────────────────
  // White background = fog everywhere. Black (blurred) polygons = holes.
  const mask = document.createElementNS(NS, "mask");
  mask.setAttribute("id",        maskId);
  mask.setAttribute("maskUnits", "userSpaceOnUse");
  mask.setAttribute("x",         0);
  mask.setAttribute("y",         0);
  mask.setAttribute("width",     mapW);
  mask.setAttribute("height",    mapH);

  const maskBg = document.createElementNS(NS, "rect");
  maskBg.setAttribute("x",      0);
  maskBg.setAttribute("y",      0);
  maskBg.setAttribute("width",  mapW);
  maskBg.setAttribute("height", mapH);
  maskBg.setAttribute("fill",   "white");
  mask.appendChild(maskBg);

  // Hole polygons wrapped in a blurred group for soft edges
  const maskHoleGroup = document.createElementNS(NS, "g");
  maskHoleGroup.setAttribute("filter", `url(#${maskBlurId})`);
  mask.appendChild(maskHoleGroup);

  const discoveredPolygons = [];

  for (const [key, hex] of Object.entries(hexData)) {
    if (!hex?.c) continue;
    const [c, r] = key.split(",").map(Number);
    const { x, y } = centerFn(c, r);
    const poly = document.createElementNS(NS, "polygon");
    poly.setAttribute("points", pointsFn(x, y));
    poly.setAttribute("fill",   "black");
    maskHoleGroup.appendChild(poly);
    discoveredPolygons.push(poly);
  }

  defs.appendChild(mask);

  // ── Group ─────────────────────────────────────────────────────────────────
  const group = document.createElementNS(NS, "g");
  group.setAttribute("id",             "fogLayer");
  group.setAttribute("pointer-events", "none");
  group.style.willChange = "opacity";

  // ── Background rect — full map, flat colour, no filter ───────────────────
  // Covers the whole map at the preset colour. The detail layer sits on top.
  // Both use the same mask so holes are consistent.
  const bgRect = document.createElementNS(NS, "rect");
  bgRect.setAttribute("x",      0);
  bgRect.setAttribute("y",      0);
  bgRect.setAttribute("width",  mapW);
  bgRect.setAttribute("height", mapH);
  bgRect.setAttribute("fill",   _presetToCss(color));
  bgRect.setAttribute("mask",   `url(#${maskId})`);
  group.appendChild(bgRect);

  // ── Detail rect — explored bbox only, full turbulence treatment ──────────
  // Smaller pixel area = filter computes much faster.
  const detailRect = document.createElementNS(NS, "rect");
  detailRect.setAttribute("x",      detailX);
  detailRect.setAttribute("y",      detailY);
  detailRect.setAttribute("width",  detailW);
  detailRect.setAttribute("height", detailH);
  detailRect.setAttribute("fill",   "white");
  detailRect.setAttribute("filter", `url(#${filterId})`);
  detailRect.setAttribute("mask",   `url(#${maskId})`);
  group.appendChild(detailRect);

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

    const fill = state === "full" ? "white" : "black";
    discoveredPolygons.forEach(p => p.setAttribute("fill", fill));
  }

  // Punch a new hole — used by storyteller incremental reveal
  function revealHex(hexKey) {
    const [c, r] = hexKey.split(",").map(Number);
    const { x, y } = centerFn(c, r);
    const poly = document.createElementNS(NS, "polygon");
    poly.setAttribute("points", pointsFn(x, y));
    poly.setAttribute("fill",   "black");
    maskHoleGroup.appendChild(poly);
  }

  // Zoom fade — called from camera.onChange in app.js
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

  // Swap colour preset — updates both the filter and the flat background rect
  function setPreset(presetName) {
    color = FOG_PRESETS[presetName] ?? FOG_PRESETS["blue-grey"];
    _applyColorMatrix(colorMatrix, color, FOG.cloudSharpness, FOG.cloudOffset);
    bgRect.setAttribute("fill", _presetToCss(color));
  }

  // Tweak turbulence live — e.g. fog.setTurbulence({ baseFrequency: "0.008" })
  function setTurbulence({ baseFrequency, numOctaves, seed, sharpness, offset } = {}) {
    if (baseFrequency !== undefined) {
      turbA.setAttribute("baseFrequency", baseFrequency);
    }
    if (numOctaves !== undefined) {
      turbA.setAttribute("numOctaves", numOctaves);
      turbB.setAttribute("numOctaves", numOctaves);
    }
    if (seed !== undefined) {
      turbA.setAttribute("seed", seed);
      turbB.setAttribute("seed", seed + 5);
    }
    if (sharpness !== undefined || offset !== undefined) {
      _applyColorMatrix(
        colorMatrix, color,
        sharpness ?? FOG.cloudSharpness,
        offset    ?? FOG.cloudOffset
      );
    }
  }

  // Adjust mask edge feathering — e.g. fog.setBlur(6) subtle, fog.setBlur(20) dramatic
  function setBlur(stdDeviation) {
    maskBlurEl.setAttribute("stdDeviation", stdDeviation);
  }

  function show()   { setState(_state === "off" ? "explored" : _state); }
  function hide()   { setState("off"); }
  function toggle() { _state === "off" ? show() : hide(); }

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

// ── Private helpers ───────────────────────────────────────────────────────────

function _applyColorMatrix(el, color, sharpness, offset) {
  el.setAttribute("values", [
    `0 0 0 0 ${color.r}`,
    `0 0 0 0 ${color.g}`,
    `0 0 0 0 ${color.b}`,
    `0 0 0 ${sharpness} ${offset}`,
  ].join("  "));
}

// Converts a preset {r,g,b} (0–1 floats) to a CSS rgba() string.
// Used for the flat background rect so it matches the turbulence colour.
function _presetToCss(color) {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  return `rgba(${r},${g},${b},1)`;
}

// Creates an <animate> element for feOffset drift.
function _makeAnimate(attr, from, to, durSec) {
  const el = document.createElementNS(NS, "animate");
  el.setAttribute("attributeName", attr);
  el.setAttribute("from",          from);
  el.setAttribute("to",            to);
  el.setAttribute("dur",           `${durSec}s`);
  el.setAttribute("repeatCount",   "indefinite");
  return el;
}
