// lineLayer.js
// Renders rivers, roads, and misc boundary lines on the SVG map.
//
// Lines are stored as arrays of raw SVG {x, y} coordinate points and
// drawn as smooth Catmull-Rom curves that pass through every point.
//
// Types:
//   "river" — solid blue-teal stroke
//   "road"  — solid warm tan stroke
//   "misc"  — dashed purple stroke (borders, trails, etc.)
//
// The catmullRomPath() function is also exported so lineDrawTool.js
// can use it for the live preview without duplicating the math.

const NS = "http://www.w3.org/2000/svg";

// ── Styles by type ────────────────────────────────────────────────────────────
const STYLES = {
  river: {
    stroke:          "#416876",
    strokeWidth:     3.0,
    opacity:         1,
    strokeDasharray: null,
  },
  road: {
    stroke:          "#7b6237",
    strokeWidth:     2.0,
    opacity:         0.82,
    strokeDasharray: null,
  },
  misc: {
    stroke:          "#a0253b",
    strokeWidth:     4.5,
    opacity:         0.65,
    strokeDasharray: null,
  },
};

// ── Curve math ────────────────────────────────────────────────────────────────
// Converts an array of {x, y} points into an SVG cubic Bezier path string
// using Catmull-Rom splines. The curve passes exactly through every point.
//
// Ghost points are duplicated at each end so the curve doesn't undershoot —
// it starts and ends precisely at the first and last point.
export function catmullRomPath(pts) {
  if (!pts || pts.length === 0) return "";
  if (pts.length === 1) {
    return `M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  }
  if (pts.length === 2) {
    return `M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)} ` +
           `L ${pts[1].x.toFixed(2)},${pts[1].y.toFixed(2)}`;
  }

  // Pad: [P0, P0, P1, P2, ..., Pn, Pn]
  // This makes the first and last real points act like interior points
  // so the Catmull-Rom formula gives clean tangents at the endpoints.
  const p = [pts[0], ...pts, pts[pts.length - 1]];

  let d = `M ${p[1].x.toFixed(2)},${p[1].y.toFixed(2)}`;

  // Each iteration draws one cubic Bezier from p[i+1] to p[i+2].
  // Control points are derived from the neighboring points p[i] and p[i+3].
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = p[i], p1 = p[i + 1], p2 = p[i + 2], p3 = p[i + 3];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(2)},${cp1y.toFixed(2)}` +
         ` ${cp2x.toFixed(2)},${cp2y.toFixed(2)}` +
         ` ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }

  return d;
}

// ── Render a single line entry as an SVG <path> ───────────────────────────────
function _makePath(line) {
  const style = STYLES[line.type] ?? STYLES.misc;
  const path  = document.createElementNS(NS, "path");

  path.setAttribute("d",               catmullRomPath(line.points));
  path.setAttribute("stroke",          style.stroke);
  path.setAttribute("stroke-width",    style.strokeWidth);
  path.setAttribute("stroke-linecap",  "round");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("fill",            "none");
  path.setAttribute("opacity",         style.opacity);
  path.setAttribute("pointer-events",  "none");

  if (style.strokeDasharray) {
    path.setAttribute("stroke-dasharray", style.strokeDasharray);
  }

  // Dataset tags let the browser inspector and future tooling identify lines
  path.dataset.lineId   = line.id   ?? "";
  path.dataset.lineName = line.name ?? "";
  path.dataset.lineType = line.type ?? "misc";

  return path;
}

// ── Main render ───────────────────────────────────────────────────────────────
// Call once on startup with the loaded linesData array.
// Returns a layer object with show/hide/toggle and an addLine() method
// so the draw tool can append new segments without re-rendering everything.
export function renderLineLayer(svg, linesData) {
  const group = document.createElementNS(NS, "g");
  group.setAttribute("id", "lineLayer");

  for (const line of linesData) {
    if (!line.points || line.points.length < 2) continue;
    group.appendChild(_makePath(line));
  }

  svg.appendChild(group);

  // Called by the draw tool after the user saves a new line,
  // so it appears immediately without reloading the page.
  function addLine(line) {
    if (!line.points || line.points.length < 2) return;
    group.appendChild(_makePath(line));
  }

  function show()   { group.removeAttribute("display"); }
  function hide()   { group.setAttribute("display", "none"); }
  function toggle() { group.getAttribute("display") === "none" ? show() : hide(); }

  return { id: "lines", label: "Rivers & Roads", group, addLine, show, hide, toggle };
}
