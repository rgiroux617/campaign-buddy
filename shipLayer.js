// shipLayer.js
// Single responsibility: render The Implication (ship) on the map.
//
// Two zoom levels driven by camera viewBox width:
//   Zoomed out  → zoom_1 SVG (simple silhouette)
//   Zoomed in   → zoom_2 SVG (full detail, animated)
//
// Animation (CSS keyframes, GPU-driven, zero JS per frame):
//   Phase 1 — oar rotation + body translation (current)
//   Phase 2 — water/splash effects (future)
//
// All tuning values live in SHIP, ANIM, BODY_ANIM, and PIVOTS constants.
//
// Returns layer object:
//   { id, label, show, hide, toggle, setZoomLevel,
//     startAnimation, stopAnimation }

import { loadSvg } from "./entityLayer.js";

const NS = "http://www.w3.org/2000/svg";

// ── Display constants ─────────────────────────────────────────────────────────
const SHIP = {
  zoom1Asset:   "images/implication_zoom_1.svg",
  zoom2Asset:   "images/implication_zoom_2.svg",
  swapAtWidth:  500,   // viewBox width threshold — smaller = more zoomed in
  zoom1Size:    35,    // rendered size in map units at overview zoom
  zoom2Size:    32,    // rendered size in map units at detail zoom (230/200 * 40)
};

// ── Oar animation constants ───────────────────────────────────────────────────
const ANIM = {
  durationSec:  2.8,   // full stroke cycle in seconds
  sweepDeg:     28,    // oar rotation arc in degrees
  driveEnd:     60,    // % of cycle at which finish position is reached
                       // drive = 0→driveEnd (slower), recovery = driveEnd→100 (faster)
};

// ── Body translation constants (SVG user units, 200×200 space) ────────────────
// Positive y = toward stern (bottom of SVG) = direction of the drive stroke.
// All parts reach maximum translation at the same driveEnd% as the oars.
const BODY_ANIM = {
  innerArm: 3,    // most travel — closest to oar action
  outerArm:  1,    // slightly less — stabilising role
  torso:     1.4, 
  torsoRotateDeg: 8,   // whole body swings back
  head:      1.5,    // subtle lag
  face:      1.5,    // matches head
};

// ── Blade tint constants ──────────────────────────────────────────────────────
// Blades become visible during the drive phase (blade in water).
// Tune BLADE.color to match the water background — pull from WaterBackground.jpeg.
// Tune BLADE.opacity for how strongly the water color reads on the blade.
// fadeInEnd / fadeOutStart mirror driveEnd so tint tracks the stroke precisely.
const BLADE = {
  color:        "#3ab5c8",  // starting point — cyan-teal to match water
  opacity:      0.72,       // max opacity at peak of drive stroke
  fadeInEnd:    20,          // % into cycle when tint reaches full opacity
  fadeOutStart: 37,         // % into cycle when tint begins fading (just before driveEnd)
};

// ── Ripple constants ──────────────────────────────────────────────────────────
// A clipping band sweeps upward through each ripple group during recovery.
// fadeInEnd controls band width and speed — smaller = narrower, faster band.
// wiggle controls how much each line oscillates horizontally.
const RIPPLE = {
  rippleStart: 12,     // % before driveEnd when ripple begins (try 5–15)
  fadeInEnd:   8,     // % of cycle — controls band width/speed (try 5–15)
  wiggle:      0.4,   // SVG units of horizontal wiggle per line
  feather:     40,    // % of element height for soft bottom edge (try 25–60)
};

// ── Wake constants ────────────────────────────────────────────────────────────
// ── Wake constants ────────────────────────────────────────────────────────────
// Three pre-drawn groups (wake-a, wake-b, wake-c) animate independently.
// Staggered delays keep something always visible — no JS cloning needed.
// Each group has its own sweep duration, peak opacity, and drift distance
// so they never perfectly re-sync, giving organic continuous variation.
const WAKE = {
  a: { sweepSec: 9,  opacity: 0.85, drift: 88 },
  b: { sweepSec: 6,  opacity: 0.70, drift: 82 },
  c: { sweepSec: 7.5,  opacity: 0.80, drift: 85 },
  wiggle: 0.2,  // SVG units of horizontal wiggle, shared across all groups
};
// Source: oar_pivot_locations.xlsx
// CSS transform-origin with px values references SVG user units
// because transform-box defaults to view-box for SVG elements.
const PIVOTS = {
  "oar-L-1": { x: 100.63, y: 170.69 },
  "oar-L-2": { x:  98.46, y: 158.91 },
  "oar-L-3": { x:  96.96, y: 146.65 },
  "oar-L-4": { x:  96.19, y: 125.39 },
  "oar-L-5": { x:  97.26, y: 111.63 },
  "oar-L-6": { x:  99.53, y:  99.73 },
  "oar-R-1": { x: 130.21, y: 170.93 },
  "oar-R-2": { x: 132.29, y: 159.76 },
  "oar-R-3": { x: 133.89, y: 147.24 },
  "oar-R-4": { x: 134.80, y: 124.45 },
  "oar-R-5": { x: 133.77, y: 112.92 },
  "oar-R-6": { x: 131.30, y:  99.76 },
};

// Left oars sweep one way, right the other.
// Flip both values if direction looks wrong after testing.
const OAR_DIRECTION = {
  L:  1,
  R: -1,
};

// ── Main render ───────────────────────────────────────────────────────────────
export async function renderShipLayer(svg, hex, centerFn) {

  const [c, r] = hex.split(",").map(Number);
  const { x, y } = centerFn(c, r);

  const group = document.createElementNS(NS, "g");
  group.setAttribute("id",             "shipLayer");
  group.setAttribute("pointer-events", "all");
  svg.appendChild(group);

  const [svgZ1, svgZ2] = await Promise.all([
    loadSvg(SHIP.zoom1Asset),
    loadSvg(SHIP.zoom2Asset),
  ]);

  const groupZ1 = _buildShipGroup(svgZ1, x, y, SHIP.zoom1Size);
  const groupZ2 = _buildShipGroup(svgZ2, x, y, SHIP.zoom2Size);

  // Ripples must render below oars — SVG z-order follows DOM order.
  const oarsEl    = groupZ2.querySelector("#oars");
  const ripplesEl = groupZ2.querySelector("#ripples");
  if (oarsEl && ripplesEl) groupZ2.insertBefore(ripplesEl, oarsEl);

  // Wake sits below everything — move it before inner_hull if needed.
  const wakeEl      = groupZ2.querySelector("#boat_wake");
  const innerHullEl = groupZ2.querySelector("#inner_hull");
  if (wakeEl && innerHullEl) groupZ2.insertBefore(wakeEl, innerHullEl);

  // Wake groups start at opacity 0 via their keyframe (0% { opacity: 0 }).
  // No inline style needed — inline styles would override the animation.

  // Apply blade tint color and set initial hidden state via clip-path.
  groupZ2.querySelectorAll("[id$='-blade']").forEach(el => {
    el.style.fill     = BLADE.color;
    el.style.opacity  = BLADE.opacity;
    const isLeft      = el.id.includes("-L-");
    el.style.clipPath = isLeft ? "inset(0 100% 0 0)" : "inset(0 0 0 100%)";
  });

  // Ripple groups start hidden via clip-path.
  groupZ2.querySelectorAll("[id$='-ripple']").forEach(el => {
    el.style.clipPath  = "inset(100% 0 0% 0)";
    el.style.maskImage = `linear-gradient(to top, transparent 0%, black ${RIPPLE.feather}%)`;
  });

  // Inject rotation wrapper LAST — after all DOM reordering is complete.
  // All children including boat_wake go inside so they rotate together.
  const rotateWrapper = document.createElementNS(NS, "g");
  rotateWrapper.setAttribute("class", "ship-rotate-wrapper");
  Array.from(groupZ2.childNodes).forEach(child => rotateWrapper.appendChild(child));
  groupZ2.appendChild(rotateWrapper);

  groupZ2.setAttribute("display", "none");
  group.appendChild(groupZ1);
  group.appendChild(groupZ2);

  _injectAnimationCSS();

  // ── Zoom level management ─────────────────────────────────────────────────
  let _currentLevel = 1;
  let _visible      = true;

  // ── Position and heading — driven by shipMovement.js ─────────────────────
  // Store scale and viewBox info so setPosition can reconstruct transforms.
  const _vb1 = svgZ1.viewBox.baseVal;
  const _vb2 = svgZ2.viewBox.baseVal;
  const _sc1 = SHIP.zoom1Size / Math.max(_vb1.width, _vb1.height);
  const _sc2 = SHIP.zoom2Size / Math.max(_vb2.width, _vb2.height);
  let _shipX = x;
  let _shipY = y;
  let _headingDeg = 0;

  function _updateTransforms() {
    groupZ1.setAttribute("transform",
      `translate(${_shipX}, ${_shipY}) scale(${_sc1}) translate(${-_vb1.width / 2}, ${-_vb1.height / 2})`);
    groupZ2.setAttribute("transform",
      `translate(${_shipX}, ${_shipY}) scale(${_sc2}) translate(${-_vb2.width / 2}, ${-_vb2.height / 2})`);
    // Rotate the whole ship around its current center for travel heading.
    // This is independent of rotateWrapper's panel tilt.
    group.setAttribute("transform",
      `rotate(${_headingDeg}, ${_shipX}, ${_shipY})`);
  }

  function setPosition(nx, ny) {
    _shipX = nx;
    _shipY = ny;
    _updateTransforms();
  }

  function setHeading(deg) {
    _headingDeg = deg;
    _updateTransforms();
  }

  function setPose(x, y, deg) {
    _shipX = x;
    _shipY = y;
    _headingDeg = deg;
    _updateTransforms();
  }

  function setShadow(filter) {
    // Apply shadow only to above-water elements
    // Excludes: oars, ripples, boat_wake — at or below waterline
    const SHADOW_IDS = [
      'hull_edge', 'Lower_Sail',
      'Rigging', 'mast_and_supports', 'sail',
    ];
    SHADOW_IDS.forEach(id => {
      const el = groupZ2.querySelector(`#${id}`);
      if (el) el.style.filter = filter;
    });
    // Also apply to zoom1 group as a whole — it's a simple silhouette
    groupZ1.style.filter = filter;
  }

  function setZoomLevel(viewBoxWidth) {
    if (!_visible) return;
    const wantsLevel = viewBoxWidth <= SHIP.swapAtWidth ? 2 : 1;
    if (wantsLevel === _currentLevel) return;
    _currentLevel = wantsLevel;
    if (wantsLevel === 2) {
      groupZ1.setAttribute("display", "none");
      groupZ2.removeAttribute("display");
    } else {
      groupZ2.setAttribute("display", "none");
      groupZ1.removeAttribute("display");
    }
  }

  // ── Animation control ─────────────────────────────────────────────────────
  function startAnimation() {
    // Oars
    Object.keys(PIVOTS).forEach(oarId => {
      const el = groupZ2.querySelector(`#${oarId}`);
      if (el) el.classList.add("oar-animated");
    });

    // Blade tints — fade in during drive phase, fade out during recovery
    groupZ2.querySelectorAll("[id$='-blade']").forEach(el => {
      el.classList.add("blade-animated");
    });

    // Ripples — appear at blade exit, drift and fade through recovery
    groupZ2.querySelectorAll("[id$='-ripple']").forEach(el => {
      el.classList.add("ripple-animated");
    });

    // Stern wake — three independent groups with staggered delays
    ["wake-a", "wake-b", "wake-c"].forEach(id => {
      const el = groupZ2.querySelector(`#${id}`);
      if (el) el.classList.add("wake-animated", `wake-${id}`);
      });
    requestAnimationFrame(() => startWake());

    // Body parts — suffix matching covers all rowers regardless of side/number
    ["inner", "outer"].forEach(part => {
      groupZ2.querySelectorAll(`[id^="rower-"][id$="-${part}"]`).forEach(el => {
        el.classList.add("body-animated");
      });
    });
    ["torso", "head", "face"].forEach(part => {
      groupZ2.querySelectorAll(`[id$="-${part}"]`).forEach(el => {
        el.classList.add("body-animated");
      });
    });
  }

  function stopBodyAnimations() {
    groupZ2.querySelectorAll(".body-animated").forEach(el => {
      el.classList.remove("body-animated");
      el.style.transform = "";
    });
  }

  function startBodyAnimations() {
    ["inner", "outer"].forEach(part => {
      groupZ2.querySelectorAll(`[id^="rower-"][id$="-${part}"]`).forEach(el => {
        el.classList.add("body-animated");
      });
    });
    ["torso", "head", "face"].forEach(part => {
      groupZ2.querySelectorAll(`[id$="-${part}"]`).forEach(el => {
        el.classList.add("body-animated");
      });
    });
  }

  function stopAnimation() {
    groupZ2.querySelectorAll(".oar-animated").forEach(el => {
      el.classList.remove("oar-animated");
    });
    groupZ2.querySelectorAll(".blade-animated").forEach(el => {
      el.classList.remove("blade-animated");
      const isLeft      = el.id.includes("-L-");
      el.style.clipPath = isLeft ? "inset(0 100% 0 0)" : "inset(0 0 0 100%)";
    });
    groupZ2.querySelectorAll(".wake-animated").forEach(el => {
      el.classList.remove("wake-animated", "wake-wake-a", "wake-wake-b", "wake-wake-c");
      el.style.transform = "";
    });
    groupZ2.querySelectorAll(".ripple-animated").forEach(el => {
      el.classList.remove("ripple-animated");
      el.style.clipPath = "inset(100% 0 0% 0)";
    });
    groupZ2.querySelectorAll(".body-animated").forEach(el => {
      el.classList.remove("body-animated");
    });
  }

  // ── Rotation control ──────────────────────────────────────────────────────
  // Uses explicit SVG coordinates for the origin rather than fill-box + 50% 50%.
  // fill-box percentage origins shift as animated children change the bounding
  // box each frame — explicit px coords are stable regardless of child animation.
  // 100px, 115px = center of the 200×230 artboard.
  function setRotation(deg, ms = 600) {
    rotateWrapper.style.transition      = ms > 0 ? `transform ${ms}ms ease-in-out` : "none";
    rotateWrapper.style.transformBox    = "view-box";
    rotateWrapper.style.transformOrigin = "115px 115px";
    rotateWrapper.style.transform       = `rotate(${deg}deg)`;
  }

  // ── Wake control ───────────────────────────────────────────────────────────
  // Pause/resume wake independently — useful when panel is open and the
  // looping translateY drift would be distracting or fight with rotation.
  function stopWake() {
    const el = groupZ2.querySelector("#boat_wake");
    if (el) el.classList.add("wake-paused");
  }

  function startWake() {
    const el = groupZ2.querySelector("#boat_wake");
    if (el) el.classList.remove("wake-paused");
  }

  // ── Layer interface ───────────────────────────────────────────────────────
  function show()   { _visible = true;  group.removeAttribute("display"); }
  function hide()   { _visible = false; group.setAttribute("display", "none"); }
  function toggle() { _visible ? hide() : show(); }

  return {
    id:            "ship",
    label:         "The Implication",
    group,
    groupZ2,
    show,
    hide,
    toggle,
    setZoomLevel,
    setPosition,
    setHeading,
    setPose,
    setShadow,
    setRotation,
    stopWake,
    startWake,
    stopBodyAnimations,
    startBodyAnimations,
    startAnimation,
    stopAnimation,
  };
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _buildShipGroup(svgEl, x, y, size) {
  const vb    = svgEl.viewBox.baseVal;
  const scale = size / Math.max(vb.width, vb.height);

  const g = document.createElementNS(NS, "g");
  g.setAttribute(
    "transform",
    `translate(${x}, ${y}) scale(${scale}) translate(${-vb.width / 2}, ${-vb.height / 2})`
  );

  Array.from(svgEl.childNodes).forEach(child => {
    const clone = child.cloneNode(true);
    if (clone.nodeName === "defs") {
      clone.querySelectorAll("style").forEach(s => s.remove());
    }
    g.appendChild(clone);
  });

  return g;
}

// Injects one <style> block covering both oar and body animations.
// Idempotent — safe to call multiple times, only injects once.
function _injectAnimationCSS() {
  if (document.getElementById("ship-anim-styles")) return;

  const { durationSec, sweepDeg, driveEnd } = ANIM;
  const { opacity: bladeOpacity, fadeInEnd, fadeOutStart } = BLADE;
  const { fadeInEnd: rippleFadeIn, wiggle, feather, rippleStart } = RIPPLE;
  const leftAngle  = sweepDeg * OAR_DIRECTION.L;
  const rightAngle = sweepDeg * OAR_DIRECTION.R;

  // Per-oar transform-origin and animation assignment
  const oarRules = Object.entries(PIVOTS).map(([id, { x, y }]) => {
    const side = id.split("-")[1];
    const kf   = side === "L" ? "oar-sweep-left" : "oar-sweep-right";
    return `#${id}.oar-animated {
  transform-origin: ${x}px ${y}px;
  animation: ${kf} ${durationSec}s ease-in-out infinite;
}`;
  }).join("\n");

  const css = `
/* ── Oar rotation ──────────────────────────────────────────────────────────── */

@keyframes oar-sweep-left {
  0%           { transform: rotate(0deg); }
  ${driveEnd}% { transform: rotate(${leftAngle}deg); }
  100%         { transform: rotate(0deg); }
}

@keyframes oar-sweep-right {
  0%           { transform: rotate(0deg); }
  ${driveEnd}% { transform: rotate(${rightAngle}deg); }
  100%         { transform: rotate(0deg); }
}

${oarRules}

/* ── Body translation ──────────────────────────────────────────────────────── */
/* Positive y = toward stern = drive stroke direction.                         */
/* Suffix selectors cover all rowers on both sides automatically.              */

@keyframes body-inner-arm {
  0%           { transform: translateY(0px); }
  ${driveEnd}% { transform: translateY(${BODY_ANIM.innerArm}px); }
  100%         { transform: translateY(0px); }
}

@keyframes body-outer-arm {
  0%           { transform: translateY(0px); }
  ${driveEnd}% { transform: translateY(${BODY_ANIM.outerArm}px); }
  100%         { transform: translateY(0px); }
}

@keyframes body-torso-left {
  0%           { transform: translateY(0px) rotate(0deg); }
  ${driveEnd}% { transform: translateY(${BODY_ANIM.torso}px) rotate(${BODY_ANIM.torsoRotateDeg}deg); }
  100%         { transform: translateY(0px) rotate(0deg); }
}

@keyframes body-torso-right {
  0%           { transform: translateY(0px) rotate(0deg); }
  ${driveEnd}% { transform: translateY(${BODY_ANIM.torso}px) rotate(${-BODY_ANIM.torsoRotateDeg}deg); }
  100%         { transform: translateY(0px) rotate(0deg); }
}

@keyframes body-head {
  0%           { transform: translateY(0px); }
  ${driveEnd}% { transform: translateY(${BODY_ANIM.head}px); }
  100%         { transform: translateY(0px); }
}

@keyframes body-face {
  0%           { transform: translateY(0px); }
  ${driveEnd}% { transform: translateY(${BODY_ANIM.face}px); }
  100%         { transform: translateY(0px); }
}

[id^="rower-"][id$="-inner"].body-animated {
  animation: body-inner-arm ${durationSec}s ease-in-out infinite;
}
[id^="rower-"][id$="-outer"].body-animated {
  animation: body-outer-arm ${durationSec}s ease-in-out infinite;
}
[id^="rower-L-"][id$="-torso"].body-animated {
  transform-box: fill-box;
  transform-origin: 50% 100%;
  animation: body-torso-left ${durationSec}s ease-in-out infinite;
}
[id^="rower-R-"][id$="-torso"].body-animated {
  transform-box: fill-box;
  transform-origin: 50% 100%;
  animation: body-torso-right ${durationSec}s ease-in-out infinite;
}
[id$="-head"].body-animated {
  animation: body-head ${durationSec}s ease-in-out infinite;
}
[id$="-face"].body-animated {
  animation: body-face ${durationSec}s ease-in-out infinite;
}

/* ── Blade tint (water immersion wipe) ─────────────────────────────────────── */
/* Entry: clip sweeps from tip inward (revealing tip first).                    */
/* Exit:  clip sweeps from hull outward (tip disappears last).                  */
/* R oars: tip is on the right — left-inset collapses on entry, right grows on exit. */
/* L oars: tip is on the left — right-inset collapses on entry, left grows on exit. */

@keyframes blade-tint-right {
  0%                { clip-path: inset(0 0% 0 100%); }
  ${fadeInEnd}%     { clip-path: inset(0 0% 0 0%); }
  ${fadeOutStart}%  { clip-path: inset(0 0% 0 0%); }
  ${driveEnd}%      { clip-path: inset(0 0% 0 100%); }
  100%              { clip-path: inset(0 0% 0 100%); }
}

@keyframes blade-tint-left {
  0%                { clip-path: inset(0 100% 0 0%); }
  ${fadeInEnd}%     { clip-path: inset(0 0% 0 0%); }
  ${fadeOutStart}%  { clip-path: inset(0 0% 0 0%); }
  ${driveEnd}%      { clip-path: inset(0 100% 0 0%); }
  100%              { clip-path: inset(0 100% 0 0%); }
}

[id$="-blade"].blade-animated[id*="-R-"] {
  opacity: ${bladeOpacity};
  animation: blade-tint-right ${durationSec}s ease-in-out infinite;
}
[id$="-blade"].blade-animated[id*="-L-"] {
  opacity: ${bladeOpacity};
  animation: blade-tint-left ${durationSec}s ease-in-out infinite;
}

/* ── Ripple / wake (blade exit disturbance) ─────────────────────────────────── */
/* A clipping band sweeps upward through each ripple group, entering from the   */
/* base (near oar tip) and exiting at the top — implying energy moving upward.  */
/* Individual paths wiggle at different rates for organic variation.             */

@keyframes ripple-show {
  0%                                 { clip-path: inset(100% 0 0% 0); }
  ${driveEnd - rippleStart}%                       { clip-path: inset(100% 0 0% 0); }
  ${driveEnd + (100-driveEnd)*0.15}% { clip-path: inset(65% 0 0% 0); }
  ${driveEnd + (100-driveEnd)*0.40}% { clip-path: inset(15% 0 15% 0); }
  ${driveEnd + (100-driveEnd)*0.70}% { clip-path: inset(0% 0 65% 0); }
  ${driveEnd + (100-driveEnd)*0.90}% { clip-path: inset(0% 0 100% 0); }
  99%                                { clip-path: inset(0% 0 100% 0); }
  100%                               { clip-path: inset(100% 0 0% 0); }
}

@keyframes ripple-wiggle-1 {
  0%   { transform: translateX(0px); }
  50%  { transform: translateX(${wiggle}px); }
  100% { transform: translateX(0px); }
}
@keyframes ripple-wiggle-2 {
  0%   { transform: translateX(0px); }
  50%  { transform: translateX(-${wiggle}px); }
  100% { transform: translateX(0px); }
}
@keyframes ripple-wiggle-3 {
  0%   { transform: translateX(0px); }
  50%  { transform: translateX(${wiggle * 0.6}px); }
  100% { transform: translateX(0px); }
}

[id$="-ripple"].ripple-animated {
  animation: ripple-show ${durationSec}s linear infinite;
  mask-image: linear-gradient(to top, transparent 0%, black ${feather}%);
}
[id$="-ripple"].ripple-animated path:nth-child(1) {
  animation: ripple-wiggle-1 0.42s ease-in-out infinite;
}
[id$="-ripple"].ripple-animated path:nth-child(2) {
  animation: ripple-wiggle-2 0.57s ease-in-out infinite;
}
[id$="-ripple"].ripple-animated path:nth-child(3) {
  animation: ripple-wiggle-3 0.49s ease-in-out infinite;
}

/* ── Stern wake — continuous upward sweep ───────────────────────────────────── */
/* Two staggered instances (A and B, offset by half a cycle) keep the wake      */
/* always partially visible. The band sweeps from bottom to top and loops.      */
/* Opacity peaks mid-sweep and fades at entry/exit for a soft pulse feel.       */

/* ── Stern wake — three independent groups, each with own speed and drift ───── */
/* Each group translates upward (decreasing y) from under the hull, fading in   */
/* as it emerges and fading out as it exits the top. Staggered delays ensure    */
/* something is always visible. Different durations prevent re-syncing.          */

@keyframes wake-sweep-a {
  0%   { transform: translateY(0px);                   opacity: 0; }
  10%  { transform: translateY(-${WAKE.a.drift * 0.1}px); opacity: ${WAKE.a.opacity}; }
  70%  { transform: translateY(-${WAKE.a.drift * 0.8}px); opacity: ${WAKE.a.opacity}; }
  90%  { transform: translateY(-${WAKE.a.drift}px);       opacity: 0; }
  100% { transform: translateY(-${WAKE.a.drift}px);       opacity: 0; }
}

@keyframes wake-sweep-b {
  0%   { transform: translateY(0px);                   opacity: 0; }
  10%  { transform: translateY(-${WAKE.b.drift * 0.1}px); opacity: ${WAKE.b.opacity}; }
  70%  { transform: translateY(-${WAKE.b.drift * 0.8}px); opacity: ${WAKE.b.opacity}; }
  90%  { transform: translateY(-${WAKE.b.drift}px);       opacity: 0; }
  100% { transform: translateY(-${WAKE.b.drift}px);       opacity: 0; }
}

@keyframes wake-sweep-c {
  0%   { transform: translateY(0px);                   opacity: 0; }
  10%  { transform: translateY(-${WAKE.c.drift * 0.1}px); opacity: ${WAKE.c.opacity}; }
  70%  { transform: translateY(-${WAKE.c.drift * 0.8}px); opacity: ${WAKE.c.opacity}; }
  90%  { transform: translateY(-${WAKE.c.drift}px);       opacity: 0; }
  100% { transform: translateY(-${WAKE.c.drift}px);       opacity: 0; }
}

@keyframes wake-wiggle-1 {
  0%   { transform: translateX(0px); }
  50%  { transform: translateX(${WAKE.wiggle}px); }
  100% { transform: translateX(0px); }
}
@keyframes wake-wiggle-2 {
  0%   { transform: translateX(0px); }
  50%  { transform: translateX(-${WAKE.wiggle}px); }
  100% { transform: translateX(0px); }
}
@keyframes wake-wiggle-3 {
  0%   { transform: translateX(0px); }
  50%  { transform: translateX(${WAKE.wiggle * 0.7}px); }
  100% { transform: translateX(0px); }
}

.wake-wake-a {
  animation: wake-sweep-a ${WAKE.a.sweepSec}s linear infinite;
  animation-delay: 0s;
}
.wake-wake-b {
  animation: wake-sweep-b ${WAKE.b.sweepSec}s linear infinite;
  animation-delay: -${(WAKE.b.sweepSec / 3).toFixed(2)}s;
}
.wake-wake-c {
  animation: wake-sweep-c ${WAKE.c.sweepSec}s linear infinite;
  animation-delay: -${((WAKE.c.sweepSec * 2) / 3).toFixed(2)}s;
}
.wake-animated path:nth-child(1) {
  animation: wake-wiggle-1 0.65s ease-in-out infinite;
}
.wake-animated path:nth-child(2) {
  animation: wake-wiggle-2 0.88s ease-in-out infinite;
}
.wake-animated path:nth-child(3) {
  animation: wake-wiggle-3 0.74s ease-in-out infinite;
}

/* Pause all wake animations including children — used during panel rotation */
#boat_wake.wake-paused,
#boat_wake.wake-paused * {
  animation-play-state: paused !important;
}
`;

  const style = document.createElement("style");
  style.id          = "ship-anim-styles";
  style.textContent = css;
  document.head.appendChild(style);
}
