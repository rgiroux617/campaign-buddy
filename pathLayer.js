// pathLayer.js
// Single responsibility: render the crew's travel path onto the SVG map.
//
// Takes ordered path data (hex coords + movement type) and draws
// styled SVG line segments connecting hex centers.
//
// Sea movement : dashed blue line
// Land movement: dashed green line
//
// Waypoint steps (waypoint: true) get a visible dot and carry metadata
// for storyteller mode. Pass-through steps draw no dot.
//
// Steps with entityId inherit their hex from entities.json automatically.
//
// Returns a layer object { id, label, group, segments, show, hide, toggle }

const NS = "http://www.w3.org/2000/svg";

const STYLES = {
  sea: {
    stroke: "#42d1f5",
    strokeWidth: 2.5,
    strokeDasharray: "2 6",
    opacity: 0.85,
  },
  land: {
    stroke: "#108920",
    strokeWidth: 2.5,
    strokeDasharray: "2 4",
    opacity: 0.85,
  },
};

const WAYPOINT_DOT = {
  r: 4,
  fill: "#42c5f5",
  opacity: 0.0,
  rLand: 4,
  fillLand: "#4db87a",
};

// ── Hex resolution ────────────────────────────────────────────────────────────
// Builds a lookup from entityId → hex string using the entities array.
// Allows path.json steps to omit hex when entityId is present.
function _buildEntityHexMap(entities) {
  const map = new Map();
  for (const e of entities) {
    map.set(e.id, e.hex);
  }
  return map;
}

// Returns the resolved hex string for a step, or null if unresolvable.
function _resolveHex(step, entityHexMap) {
  if (step.hex) return step.hex;
  if (step.entityId) return entityHexMap.get(step.entityId) ?? null;
  return null;
}

// ── Main render ───────────────────────────────────────────────────────────────
export function renderPathLayer(svg, pathData, centerFn, entities = []) {

  const entityHexMap = _buildEntityHexMap(entities);

  // Resolve hex for every step up front, and attach it back onto the step
  // so downstream code (storyteller) always has step.hex available.
  const resolved = pathData.map(step => ({
    ...step,
    hex: _resolveHex(step, entityHexMap),
  }));

  const group = document.createElementNS(NS, "g");
  group.setAttribute("id", "pathLayer");

  const segments = []; // for storyteller access

  // ── Line segments ─────────────────────────────────────────────────────────
  // ── Line segments ─────────────────────────────────────────────────────────
  // Skip any consecutive pair where either hex failed to resolve.
  // On type transitions (sea→land or land→sea), split at the midpoint:
  // first half uses the "from" style, second half uses the "to" style.
  // This reflects that terrain transitions happen at hex edges, not centers.
  for (let i = 0; i < resolved.length - 1; i++) {
    const from = resolved[i];
    const to = resolved[i + 1];

    if (!from.hex || !to.hex) continue;

    const [fc, fr] = from.hex.split(",").map(Number);
    const [tc, tr] = to.hex.split(",").map(Number);

    const { x: x1, y: y1 } = centerFn(fc, fr);
    const { x: x2, y: y2 } = centerFn(tc, tr);

    const fromStyle = STYLES[from.type] ?? STYLES.sea;
    const toStyle = STYLES[to.type] ?? STYLES.sea;

    if (from.type === to.type) {
      // Same terrain — one line, one style
      const line = _makeLine(x1, y1, x2, y2, fromStyle);
      line.dataset.segmentIndex = i;
      line.dataset.type = from.type;
      group.appendChild(line);
      segments.push({ line, from, to, type: from.type });

    } else {
      // Terrain transition — split at midpoint, each half gets its own style
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;

      const lineA = _makeLine(x1, y1, mx, my, fromStyle);
      lineA.dataset.segmentIndex = i;
      lineA.dataset.type = from.type;
      lineA.dataset.transition = "out";
      group.appendChild(lineA);

      const lineB = _makeLine(mx, my, x2, y2, toStyle);
      lineB.dataset.segmentIndex = i;
      lineB.dataset.type = to.type;
      lineB.dataset.transition = "in";
      group.appendChild(lineB);

      // Store both lines — storyteller can find them by segmentIndex
      segments.push({ line: lineA, lineB, from, to, type: from.type, transition: true });
    }
  }

  // ── Waypoint dots ─────────────────────────────────────────────────────────
  // Only render a dot where waypoint: true. Pass-through steps draw nothing.
  for (const step of resolved) {
    if (!step.waypoint || !step.hex) continue;

    const [c, r] = step.hex.split(",").map(Number);
    const { x, y } = centerFn(c, r);

    const isLand = step.type === "land";

    const dot = document.createElementNS(NS, "circle");
    dot.setAttribute("cx", x);
    dot.setAttribute("cy", y);
    dot.setAttribute("r", isLand ? WAYPOINT_DOT.rLand : WAYPOINT_DOT.r);
    dot.setAttribute("fill", isLand ? WAYPOINT_DOT.fillLand : WAYPOINT_DOT.fill);
    dot.setAttribute("opacity", WAYPOINT_DOT.opacity);
    dot.setAttribute("pointer-events", "none");

    // Tag for storyteller
    if (step.entityId) dot.dataset.entityId = step.entityId;

    group.appendChild(dot);
  }

  svg.appendChild(group);

  // ── Layer interface ───────────────────────────────────────────────────────
  function show() { group.removeAttribute("display"); }
  function hide() { group.setAttribute("display", "none"); }
  function toggle() { group.getAttribute("display") === "none" ? show() : hide(); }

  // ── Private helpers ───────────────────────────────────────────────────────────

  function _makeLine(x1, y1, x2, y2, style) {
    const line = document.createElementNS(NS, "line");
    line.setAttribute("x1", x1);
    line.setAttribute("y1", y1);
    line.setAttribute("x2", x2);
    line.setAttribute("y2", y2);
    line.setAttribute("stroke", style.stroke);
    line.setAttribute("stroke-width", style.strokeWidth);
    line.setAttribute("stroke-dasharray", style.strokeDasharray);
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("opacity", style.opacity);
    line.setAttribute("pointer-events", "none");
    return line;
  }

  return {
    id: "path",
    label: "Travel Path",
    group,
    segments,         // ordered list for storyteller animation
    waypoints: resolved.filter(s => s.waypoint), // quick access for storyteller pauses
    show,
    hide,
    toggle,
  };
}