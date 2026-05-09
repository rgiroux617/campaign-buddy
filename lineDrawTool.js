// lineDrawTool.js
// Interactive point-and-click drawing tool for rivers, roads, and misc lines.
//
// ── How to use ────────────────────────────────────────────────────────────────
//   1. Click a type button in the draw toolbar (River / Road / Misc).
//   2. LEFT-CLICK anywhere on the map to place waypoints.
//      Right-click drag still pans the map normally while you draw.
//   3. Press ENTER or DOUBLE-CLICK to finish the segment.
//      A prompt asks for a name, then lines.json is downloaded automatically.
//   4. Press ESCAPE to cancel without saving.
//   5. Press BACKSPACE to remove the last placed point.
//
// ── Snapping ─────────────────────────────────────────────────────────────────
//   When you click within SNAP_THRESHOLD SVG units of any existing line's
//   first or last endpoint, the new point locks to that exact coordinate.
//   This guarantees branch segments share a precise junction.
//   Zoom in close to a junction before clicking — the threshold is fixed in
//   map units, so zooming in gives you more screen precision.
//   A white ring appears around a snap target when your cursor is close enough.
//
// ── Saving ───────────────────────────────────────────────────────────────────
//   After naming a line, the FULL updated linesData array is downloaded as
//   lines.json. Replace data/lines.json with this file. The new line also
//   appears on the map immediately without needing a page reload.

import { catmullRomPath } from "./lineLayer.js";

const NS             = "http://www.w3.org/2000/svg";
const SNAP_THRESHOLD = 5; // SVG coordinate units

const TYPE_COLORS = {
  river: "#5ab4d6",
  road:  "#c4a46b",
  misc:  "#a06898",
};

export function createLineDrawTool({ svg, linesData, onSaved, statusEl }) {

  let active      = false;
  let currentType = "river";
  let pts         = []; // committed waypoints for the current segment

  // SVG preview elements (exist only while draw mode is active)
  let previewGroup = null;
  let previewPath  = null;
  let previewDots  = null;
  let snapRing     = null;

  // ── Coordinate conversion ─────────────────────────────────────────────────
  // Converts a screen-space mouse position into SVG coordinate space,
  // correctly accounting for the current viewBox (zoom + pan).
  function _toSvgPt(clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  // ── Snap detection ────────────────────────────────────────────────────────
  // Returns a snapped {x, y} if the given SVG point is within SNAP_THRESHOLD
  // of any existing line's first or last endpoint. Returns null otherwise.
  // Also snaps to the current segment's own start point (loop closure).
  function _findSnap(svgPt) {
    const check = (candidate) => {
      const dx = candidate.x - svgPt.x;
      const dy = candidate.y - svgPt.y;
      return Math.hypot(dx, dy) <= SNAP_THRESHOLD
        ? { x: candidate.x, y: candidate.y }
        : null;
    };

    for (const line of linesData) {
      if (!line.points?.length) continue;
      const first  = line.points[0];
      const last   = line.points[line.points.length - 1];
      const hitFirst = check(first);
      if (hitFirst) return hitFirst;
      // Only check last if it differs from first (avoid double-hit on 1-pt lines)
      if (last !== first) {
        const hitLast = check(last);
        if (hitLast) return hitLast;
      }
    }

    // Snap to current segment's own start (for drawing closed shapes)
    if (pts.length > 2) {
      const hit = check(pts[0]);
      if (hit) return hit;
    }

    return null;
  }

  // ── Preview elements ──────────────────────────────────────────────────────
  function _buildPreview() {
    previewGroup = document.createElementNS(NS, "g");
    previewGroup.setAttribute("id", "_lineDrawPreview");
    previewGroup.setAttribute("pointer-events", "none");

    previewPath = document.createElementNS(NS, "path");
    previewPath.setAttribute("fill", "none");
    previewPath.setAttribute("stroke-linecap",  "round");
    previewPath.setAttribute("stroke-linejoin", "round");

    previewDots = document.createElementNS(NS, "g");

    // White ring that pulses around a snap target when the cursor gets close
    snapRing = document.createElementNS(NS, "circle");
    snapRing.setAttribute("r",            SNAP_THRESHOLD + 2);
    snapRing.setAttribute("fill",         "none");
    snapRing.setAttribute("stroke",       "#ffffff");
    snapRing.setAttribute("stroke-width", "1");
    snapRing.setAttribute("opacity",      "0");

    previewGroup.appendChild(previewPath);
    previewGroup.appendChild(previewDots);
    previewGroup.appendChild(snapRing);
    svg.appendChild(previewGroup);
  }

  function _destroyPreview() {
    previewGroup?.remove();
    previewGroup = previewPath = previewDots = snapRing = null;
  }

  // Redraws the preview curve and dots.
  // mousePos (optional) adds a ghost segment from the last committed point
  // to the current cursor — shows where the next click will go.
  function _updatePreview(mousePos = null) {
    const color   = TYPE_COLORS[currentType] ?? "#ffffff";
    const drawPts = mousePos ? [...pts, mousePos] : [...pts];

    if (drawPts.length >= 2) {
      previewPath.setAttribute("d",                catmullRomPath(drawPts));
      previewPath.setAttribute("stroke",           color);
      previewPath.setAttribute("stroke-width",     "2.5");
      previewPath.setAttribute("opacity",          "0.85");
      // Ghost segment to cursor is dashed; committed curve is solid
      previewPath.setAttribute("stroke-dasharray", mousePos ? "4 4" : "none");
    } else if (drawPts.length === 1) {
      // Just a dot at the first point — nothing to curve yet
      previewPath.setAttribute("d", "");
    } else {
      previewPath.setAttribute("d", "");
    }

    // Redraw committed-point dots
    previewDots.innerHTML = "";
    for (const pt of pts) {
      const dot = document.createElementNS(NS, "circle");
      dot.setAttribute("cx",      pt.x);
      dot.setAttribute("cy",      pt.y);
      dot.setAttribute("r",       "2.5");
      dot.setAttribute("fill",    color);
      dot.setAttribute("opacity", "0.9");
      previewDots.appendChild(dot);
    }
  }

  // ── Status display ────────────────────────────────────────────────────────
  function _status(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  function _ptLabel() {
    return `${pts.length} pt${pts.length !== 1 ? "s" : ""}`;
  }

  function _cap(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ── Event handlers ────────────────────────────────────────────────────────
  function _onClick(e) {
    // Only respond to left-click; right-click is reserved for camera pan
    if (!active || e.button !== 0) return;

    // Stop the event so it doesn't reach hex-click or entity-click handlers
    e.stopPropagation();

    const raw     = _toSvgPt(e.clientX, e.clientY);
    const snapped = _findSnap(raw);
    const pt      = snapped ?? { x: +raw.x.toFixed(2), y: +raw.y.toFixed(2) };

    pts.push(pt);
    _updatePreview();
    _status(`${_cap(currentType)} — ${_ptLabel()} · Enter = done · Backspace = undo · Esc = cancel`);
  }

  function _onMouseMove(e) {
    if (!active || !previewGroup) return;

    const raw     = _toSvgPt(e.clientX, e.clientY);
    const snapped = _findSnap(raw);

    if (snapped) {
      snapRing.setAttribute("cx",      snapped.x);
      snapRing.setAttribute("cy",      snapped.y);
      snapRing.setAttribute("opacity", "0.75");
      _updatePreview(snapped);
    } else {
      snapRing.setAttribute("opacity", "0");
      _updatePreview({ x: raw.x, y: raw.y });
    }
  }

  function _onDblClick(e) {
    if (!active) return;
    e.stopPropagation();
    // The second click of the double-click already fired _onClick and added
    // a point, so remove it before finishing to avoid a duplicate endpoint.
    if (pts.length > 0) pts.pop();
    _finish();
  }

  function _onKeyDown(e) {
    if (!active) return;

    if (e.key === "Enter") {
      e.preventDefault();
      _finish();
    } else if (e.key === "Escape") {
      e.preventDefault();
      deactivate();
      _status("");
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      pts.pop();
      _updatePreview();
      _status(`${_cap(currentType)} — ${_ptLabel()} · Enter = done · Backspace = undo · Esc = cancel`);
    }
  }

  // ── Finish & save ─────────────────────────────────────────────────────────
  function _finish() {
    if (pts.length < 2) {
      alert("Need at least 2 points to save a line.\nKeep clicking, or press Esc to cancel.");
      return;
    }

    const defaultName = `${_cap(currentType)} ${linesData.length + 1}`;
    const name = prompt(`Name this ${currentType}:`, defaultName);
    if (name === null) return; // user pressed Cancel in the prompt

    const trimmed = name.trim() || defaultName;
    const id      = trimmed.toLowerCase().replace(/\s+/g, "_") + "_" + Date.now();

    const newLine = {
      id,
      name:   trimmed,
      type:   currentType,
      points: [...pts],
    };

    linesData.push(newLine);

    // Trigger browser download of the complete updated lines.json
    _download(linesData, "lines.json");

    // Tell app.js to paint the new line immediately (no reload needed)
    onSaved?.(newLine);

    deactivate();
    _status(`"${trimmed}" saved — replace data/lines.json with the downloaded file.`);
  }

  function _download(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  // Enters draw mode for the given type ("river", "road", or "misc").
  // Calling activate() while already active switches type cleanly.
  function activate(type = "river") {
    if (active) deactivate();

    active      = true;
    currentType = type;
    pts         = [];

    _buildPreview();

    // Listen on the SVG so clicks anywhere on the map (hex or open water) work.
    // We use capture:false — the hex polygon's own click fires first and gets
    // suppressed by the isActive() check in app.js before it opens a card.
    svg.addEventListener("click",    _onClick);
    svg.addEventListener("mousemove", _onMouseMove);
    svg.addEventListener("dblclick",  _onDblClick);
    document.addEventListener("keydown", _onKeyDown);

    svg.style.cursor = "crosshair";
    _status(`${_cap(type)} — click to place points · Enter = done · Esc = cancel`);
  }

  // Exits draw mode and cleans up all preview elements and listeners.
  function deactivate() {
    active = false;
    pts    = [];

    _destroyPreview();

    svg.removeEventListener("click",     _onClick);
    svg.removeEventListener("mousemove", _onMouseMove);
    svg.removeEventListener("dblclick",  _onDblClick);
    document.removeEventListener("keydown", _onKeyDown);

    svg.style.cursor = "";
  }

  // Used by app.js to suppress hex-click cards while drawing
  function isActive() { return active; }

  return { activate, deactivate, isActive };
}
