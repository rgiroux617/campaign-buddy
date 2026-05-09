// shipPathDrawTool.js
// Interactive point-and-click drawing tool for ship paths.
//
// ── How to use ────────────────────────────────────────────────────────────────
//   1. Click the "Ship Path" button in the draw toolbar.
//   2. LEFT-CLICK anywhere on the map to place waypoints.
//      Right-click drag still pans the map normally while you draw.
//   3. Press D to mark the last-placed point as a dock stop.
//      Prompts will ask for pauseMs, zoom level, and entityId.
//      Press D again on the same point to un-dock it.
//   4. Press ENTER or DOUBLE-CLICK to finish the segment.
//      A prompt asks for a name, then shipPath.json is downloaded.
//   5. Press ESCAPE to cancel without saving.
//   6. Press BACKSPACE to remove the last placed point.
//
// ── Dock stops ────────────────────────────────────────────────────────────────
//   Dock points show as larger orange dots in the preview.
//   Values set via prompt:
//     pauseMs   — how long the ship pauses (ms), e.g. 2000
//     zoom      — reserved for future camera zoom integration
//     entityId  — reserved for future card-open integration
//
// ── Snapping ─────────────────────────────────────────────────────────────────
//   Snaps only to first/last endpoints of existing ship path segments —
//   not rivers or roads. Zoom in close to use snapping reliably.
//
// ── Saving ───────────────────────────────────────────────────────────────────
//   After naming the segment, the full updated shipPathData array is
//   downloaded as shipPath.json. Replace data/shipPath.json with this file.
//   The new path is also passed to onSaved() so the map updates immediately.

import { catmullRomPath } from "./lineLayer.js";

const NS             = "http://www.w3.org/2000/svg";
const SNAP_THRESHOLD = 5; // SVG coordinate units

const COLOR_PATH = "#e8c840"; // gold — normal waypoints and the curve
const COLOR_DOCK = "#ff7a30"; // orange — dock stop waypoints

export function createShipPathDrawTool({ svg, shipPathData, onSaved, statusEl }) {

  let active = false;
  let pts    = []; // committed waypoints for the current segment

  // SVG preview elements (exist only while draw mode is active)
  let previewGroup = null;
  let previewPath  = null;
  let previewDots  = null;
  let snapRing     = null;

  // ── Coordinate conversion ─────────────────────────────────────────────────
  function _toSvgPt(clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  // ── Snap detection ────────────────────────────────────────────────────────
  // Only snaps to first/last endpoints of existing ship path segments.
  // Also snaps to the current segment's own start point for loop closure.
  function _findSnap(svgPt) {
    const check = (candidate) => {
      const dx = candidate.x - svgPt.x;
      const dy = candidate.y - svgPt.y;
      return Math.hypot(dx, dy) <= SNAP_THRESHOLD
        ? { x: candidate.x, y: candidate.y }
        : null;
    };

    for (const seg of shipPathData) {
      if (!seg.points?.length) continue;
      const first = seg.points[0];
      const last  = seg.points[seg.points.length - 1];
      const hitFirst = check(first);
      if (hitFirst) return hitFirst;
      if (last !== first) {
        const hitLast = check(last);
        if (hitLast) return hitLast;
      }
    }

    // Snap to current segment's own start (for drawing closed loops)
    if (pts.length > 2) {
      const hit = check(pts[0]);
      if (hit) return hit;
    }

    return null;
  }

  // ── Preview elements ──────────────────────────────────────────────────────
  function _buildPreview() {
    previewGroup = document.createElementNS(NS, "g");
    previewGroup.setAttribute("id", "_shipPathDrawPreview");
    previewGroup.setAttribute("pointer-events", "none");

    // ── Existing segments layer ───────────────────────────────────────────
    // Drawn first so they sit below the active curve and snap-ring.
    // Each saved segment is shown as a dimmed gold curve with endpoint dots
    // so the user can see where to snap the next segment onto.
    const existingGroup = document.createElementNS(NS, "g");
    for (const seg of shipPathData) {
      if (!seg.points?.length) continue;

      // The curve
      const segPath = document.createElementNS(NS, "path");
      segPath.setAttribute("d",                catmullRomPath(seg.points));
      segPath.setAttribute("fill",             "none");
      segPath.setAttribute("stroke",           COLOR_PATH);
      segPath.setAttribute("stroke-width",     "2");
      segPath.setAttribute("stroke-linecap",   "round");
      segPath.setAttribute("stroke-linejoin",  "round");
      segPath.setAttribute("opacity",          "0.45");
      existingGroup.appendChild(segPath);

      // Endpoint dots — only first and last, so the user knows where to snap
      for (const pt of [seg.points[0], seg.points[seg.points.length - 1]]) {
        const dot = document.createElementNS(NS, "circle");
        dot.setAttribute("cx",      pt.x);
        dot.setAttribute("cy",      pt.y);
        dot.setAttribute("r",       "4");
        dot.setAttribute("fill",    "none");
        dot.setAttribute("stroke",  COLOR_PATH);
        dot.setAttribute("stroke-width", "1.5");
        dot.setAttribute("opacity", "0.7");
        existingGroup.appendChild(dot);
      }
    }
    previewGroup.appendChild(existingGroup);

    // ── Active drawing elements ───────────────────────────────────────────
    previewPath = document.createElementNS(NS, "path");
    previewPath.setAttribute("fill",            "none");
    previewPath.setAttribute("stroke-linecap",  "round");
    previewPath.setAttribute("stroke-linejoin", "round");

    previewDots = document.createElementNS(NS, "g");

    // White ring that appears when the cursor gets close to a snap target
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

  // Redraws the preview curve and waypoint dots.
  // mousePos (optional) adds a ghost dashed segment from the last committed
  // point to the cursor — shows where the next click will land.
  function _updatePreview(mousePos = null) {
    const drawPts = mousePos ? [...pts, mousePos] : [...pts];

    if (drawPts.length >= 2) {
      previewPath.setAttribute("d",                catmullRomPath(drawPts));
      previewPath.setAttribute("stroke",           COLOR_PATH);
      previewPath.setAttribute("stroke-width",     "2.5");
      previewPath.setAttribute("opacity",          "0.85");
      previewPath.setAttribute("stroke-dasharray", mousePos ? "4 4" : "none");
    } else {
      previewPath.setAttribute("d", "");
    }

    // Redraw waypoint dots — dock points are larger and orange
    previewDots.innerHTML = "";
    for (const pt of pts) {
      const isDock = !!pt.dock;
      const dot    = document.createElementNS(NS, "circle");
      dot.setAttribute("cx",      pt.x);
      dot.setAttribute("cy",      pt.y);
      dot.setAttribute("r",       isDock ? "4" : "2.5");
      dot.setAttribute("fill",    isDock ? COLOR_DOCK : COLOR_PATH);
      dot.setAttribute("opacity", "0.9");
      previewDots.appendChild(dot);
    }
  }

  // ── Status bar ────────────────────────────────────────────────────────────
  function _status(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  function _ptLabel() {
    const docks = pts.filter(p => p.dock).length;
    const base  = `${pts.length} pt${pts.length !== 1 ? "s" : ""}`;
    return docks > 0 ? `${base}, ${docks} dock${docks !== 1 ? "s" : ""}` : base;
  }

  // ── Event handlers ────────────────────────────────────────────────────────
  function _onClick(e) {
    if (!active || e.button !== 0) return;
    e.stopPropagation();

    const raw     = _toSvgPt(e.clientX, e.clientY);
    const snapped = _findSnap(raw);
    const pt      = snapped ?? { x: +raw.x.toFixed(2), y: +raw.y.toFixed(2) };

    pts.push(pt);
    _updatePreview();
    _status(`Ship Path — ${_ptLabel()} · D = dock · Enter = done · Backspace = undo · Esc = cancel`);
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
    // Second click of the double-click already fired _onClick and added a point;
    // remove it to avoid a duplicate at the endpoint before finishing.
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
      _status(`Ship Path — ${_ptLabel()} · D = dock · Enter = done · Backspace = undo · Esc = cancel`);

    } else if (e.key === "d" || e.key === "D") {
      e.preventDefault();
      _markDock();
    }
  }

  // ── Mark/unmark dock stop ─────────────────────────────────────────────────
  function _markDock() {
    if (pts.length === 0) {
      alert("Place at least one point first, then press D to mark it as a dock stop.");
      return;
    }

    const last = pts[pts.length - 1];

    // Pressing D on an already-docked point removes the dock flag
    if (last.dock) {
      delete last.dock;
      delete last.pauseMs;
      delete last.zoom;
      delete last.entityId;
      _updatePreview();
      _status(`Dock removed. Ship Path — ${_ptLabel()} · D = dock · Enter = done · Esc = cancel`);
      return;
    }

    // Prompt for the three dock values — Cancel on the first one bails out
    const pauseStr = prompt("Pause at this dock (ms):", "2000");
    if (pauseStr === null) return;

    const zoomStr   = prompt("Camera zoom at this dock (leave blank to skip):", "");
    const entityStr = prompt("Entity ID to open at this dock (leave blank to skip):", "");

    last.dock = true;

    const pauseMs = parseInt(pauseStr, 10);
    if (!isNaN(pauseMs))              last.pauseMs  = pauseMs;

    const zoom = parseFloat(zoomStr);
    if (!isNaN(zoom) && zoomStr.trim() !== "") last.zoom = zoom;

    const entityId = entityStr.trim();
    if (entityId)                     last.entityId = entityId;

    _updatePreview();
    _status(`Dock set. Ship Path — ${_ptLabel()} · D = dock · Enter = done · Esc = cancel`);
  }

  // ── Finish & save ─────────────────────────────────────────────────────────
  function _finish() {
    if (pts.length < 2) {
      alert("Need at least 2 points to save a path.\nKeep clicking, or press Esc to cancel.");
      return;
    }

    const defaultName = `Segment ${shipPathData.length + 1}`;
    const name = prompt("Name this ship path segment:", defaultName);
    if (name === null) return; // user pressed Cancel

    const trimmed = name.trim() || defaultName;
    const id      = "ship_" + trimmed.toLowerCase().replace(/\s+/g, "_") + "_" + Date.now();

    // Build a clean copy of each point — only write properties that are defined
    const cleanPoints = pts.map(p => {
      const out = { x: p.x, y: p.y };
      if (p.dock)              out.dock     = true;
      if (p.pauseMs   != null) out.pauseMs  = p.pauseMs;
      if (p.zoom      != null) out.zoom     = p.zoom;
      if (p.entityId)          out.entityId = p.entityId;
      if (p.speedMult != null) out.speedMult = p.speedMult;
      return out;
    });

    const newSeg = { id, name: trimmed, points: cleanPoints };

    shipPathData.push(newSeg);
    _download(shipPathData, "shipPath.json");
    onSaved?.(newSeg);

    deactivate();
    _status(`"${trimmed}" saved — replace data/shipPath.json with the downloaded file.`);
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

  function activate() {
    if (active) deactivate();

    active = true;
    pts    = [];

    _buildPreview();

    svg.addEventListener("click",     _onClick);
    svg.addEventListener("mousemove", _onMouseMove);
    svg.addEventListener("dblclick",  _onDblClick);
    document.addEventListener("keydown", _onKeyDown);

    svg.style.cursor = "crosshair";
    _status("Ship Path — click to place points · D = dock stop · Enter = done · Esc = cancel");
  }

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
