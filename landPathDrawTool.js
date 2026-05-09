// landPathDrawTool.js
// Interactive point-and-click drawing tool for land/helmet paths.
//
// Each land path is a loop that the helmet icon travels during a ship dock
// stop. It is linked to a dock stop by entityId.
//
// ── How to use ────────────────────────────────────────────────────────────────
//   1. Click the "Land Path" button in the draw toolbar.
//      A prompt asks which dock (entityId) this path belongs to.
//   2. LEFT-CLICK to place waypoints. Start near the dock point — the
//      tool snaps to dock stop positions so you can start exactly there.
//   3. Press P to mark the last-placed point as a pause stop.
//      Prompts for duration (ms) and an optional name.
//      Press P again on the same point to remove the pause.
//   4. Draw a loop: end your path by snapping back to the start point.
//   5. Press ENTER or DOUBLE-CLICK to finish. Downloads land.json.
//   6. Press ESCAPE to cancel. BACKSPACE removes the last point.
//
// ── Snapping ─────────────────────────────────────────────────────────────────
//   Snaps to:
//     • Dock stop positions on any ship path segment
//     • First/last endpoints of existing land paths
//     • The current path's own start point (for closing the loop)
//
// ── Saving ───────────────────────────────────────────────────────────────────
//   Downloads the full updated land.json. Replace data/land.json with it.

import { catmullRomPath } from "./lineLayer.js";

const NS             = "http://www.w3.org/2000/svg";
const SNAP_THRESHOLD = 5;

const COLOR_PATH  = "#c8f0a0"; // pale green — normal waypoints and curve
const COLOR_PAUSE = "#ff7a30"; // orange — pause stop waypoints
const COLOR_DOCK  = "#e8c840"; // gold — highlights dock snap targets

export function createLandPathDrawTool({ svg, shipPathData, landData, onSaved, statusEl }) {

  let active    = false;
  let entityId  = null; // set at activate() time via prompt
  let pts       = [];

  let previewGroup  = null;
  let previewPath   = null;
  let previewDots   = null;
  let snapRing      = null;

  // ── Collect all dock stop positions from shipPathData ─────────────────────
  // Used both for snapping and for rendering guide markers.
  function _dockStops() {
    const stops = [];
    for (const seg of (shipPathData ?? [])) {
      for (const pt of (seg.points ?? [])) {
        if (pt.dock) stops.push({ x: pt.x, y: pt.y, entityId: pt.entityId ?? null });
      }
    }
    return stops;
  }

  // ── Coordinate conversion ─────────────────────────────────────────────────
  function _toSvgPt(clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  // ── Snap detection ────────────────────────────────────────────────────────
  // Priority: dock stops → land path endpoints → current path start (loop)
  function _findSnap(svgPt) {
    const check = (candidate) => {
      const dx = candidate.x - svgPt.x;
      const dy = candidate.y - svgPt.y;
      return Math.hypot(dx, dy) <= SNAP_THRESHOLD
        ? { x: candidate.x, y: candidate.y }
        : null;
    };

    // 1. Dock stop positions
    for (const stop of _dockStops()) {
      const hit = check(stop);
      if (hit) return hit;
    }

    // 2. Existing land path endpoints
    for (const entry of (landData ?? [])) {
      if (!entry.points?.length) continue;
      const first = entry.points[0];
      const last  = entry.points[entry.points.length - 1];
      const hitFirst = check(first);
      if (hitFirst) return hitFirst;
      if (last !== first) {
        const hitLast = check(last);
        if (hitLast) return hitLast;
      }
    }

    // 3. Current path's own start (for closing the loop)
    if (pts.length > 2) {
      const hit = check(pts[0]);
      if (hit) return hit;
    }

    return null;
  }

  // ── Preview elements ──────────────────────────────────────────────────────
  function _buildPreview() {
    previewGroup = document.createElementNS(NS, "g");
    previewGroup.setAttribute("id", "_landPathDrawPreview");
    previewGroup.setAttribute("pointer-events", "none");

    // ── Dock stop guide markers ───────────────────────────────────────────
    // Gold rings at every dock stop position so you know where to snap from.
    const dockGuides = document.createElementNS(NS, "g");
    for (const stop of _dockStops()) {
      const ring = document.createElementNS(NS, "circle");
      ring.setAttribute("cx",           stop.x);
      ring.setAttribute("cy",           stop.y);
      ring.setAttribute("r",            SNAP_THRESHOLD + 3);
      ring.setAttribute("fill",         "none");
      ring.setAttribute("stroke",       COLOR_DOCK);
      ring.setAttribute("stroke-width", "1.5");
      ring.setAttribute("opacity",      "0.7");
      dockGuides.appendChild(ring);

      // Tiny label for the entityId if present
      if (stop.entityId) {
        const label = document.createElementNS(NS, "text");
        label.setAttribute("x",           stop.x);
        label.setAttribute("y",           stop.y - SNAP_THRESHOLD - 5);
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("font-size",   "4");
        label.setAttribute("fill",        COLOR_DOCK);
        label.setAttribute("opacity",     "0.8");
        label.textContent = stop.entityId;
        dockGuides.appendChild(label);
      }
    }
    previewGroup.appendChild(dockGuides);

    // ── Existing land paths ───────────────────────────────────────────────
    const existingGroup = document.createElementNS(NS, "g");
    for (const entry of (landData ?? [])) {
      if (!entry.points?.length) continue;

      const segPath = document.createElementNS(NS, "path");
      segPath.setAttribute("d",               catmullRomPath(entry.points));
      segPath.setAttribute("fill",            "none");
      segPath.setAttribute("stroke",          COLOR_PATH);
      segPath.setAttribute("stroke-width",    "2");
      segPath.setAttribute("stroke-linecap",  "round");
      segPath.setAttribute("stroke-linejoin", "round");
      segPath.setAttribute("opacity",         "0.45");
      existingGroup.appendChild(segPath);

      // Endpoint rings
      for (const pt of [entry.points[0], entry.points[entry.points.length - 1]]) {
        const dot = document.createElementNS(NS, "circle");
        dot.setAttribute("cx",           pt.x);
        dot.setAttribute("cy",           pt.y);
        dot.setAttribute("r",            "4");
        dot.setAttribute("fill",         "none");
        dot.setAttribute("stroke",       COLOR_PATH);
        dot.setAttribute("stroke-width", "1.5");
        dot.setAttribute("opacity",      "0.7");
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

    previewDots.innerHTML = "";
    for (const pt of pts) {
      const isPause = !!pt.pause;
      const dot     = document.createElementNS(NS, "circle");
      dot.setAttribute("cx",      pt.x);
      dot.setAttribute("cy",      pt.y);
      dot.setAttribute("r",       isPause ? "4" : "2.5");
      dot.setAttribute("fill",    isPause ? COLOR_PAUSE : COLOR_PATH);
      dot.setAttribute("opacity", "0.9");
      previewDots.appendChild(dot);
    }
  }

  // ── Status bar ────────────────────────────────────────────────────────────
  function _status(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  function _ptLabel() {
    const pauses = pts.filter(p => p.pause).length;
    const base   = `${pts.length} pt${pts.length !== 1 ? "s" : ""}`;
    return pauses > 0 ? `${base}, ${pauses} pause${pauses !== 1 ? "s" : ""}` : base;
  }

  function _activeStatus() {
    _status(`Land Path [${entityId}] — ${_ptLabel()} · P = pause · Enter = done · Backspace = undo · Esc = cancel`);
  }

  // ── Mark/unmark pause stop ────────────────────────────────────────────────
  function _markPause() {
    if (pts.length === 0) {
      alert("Place at least one point first, then press P to mark it as a pause.");
      return;
    }

    const last = pts[pts.length - 1];

    // Press P again to remove the pause
    if (last.pause) {
      delete last.pause;
      delete last.pauseMs;
      delete last.name;
      _updatePreview();
      _status(`Pause removed. Land Path [${entityId}] — ${_ptLabel()} · P = pause · Enter = done · Esc = cancel`);
      return;
    }

    const msStr   = prompt("Pause duration (ms):", "1500");
    if (msStr === null) return;

    const nameStr = prompt("Name for this pause (optional):", "");

    last.pause = true;

    const pauseMs = parseInt(msStr, 10);
    if (!isNaN(pauseMs)) last.pauseMs = pauseMs;

    const name = nameStr?.trim();
    if (name) last.name = name;

    _updatePreview();
    _status(`Pause set. Land Path [${entityId}] — ${_ptLabel()} · P = pause · Enter = done · Esc = cancel`);
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
    _activeStatus();
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
      _activeStatus();
    } else if (e.key === "p" || e.key === "P") {
      e.preventDefault();
      _markPause();
    }
  }

  // ── Finish & save ─────────────────────────────────────────────────────────
  function _finish() {
    if (pts.length < 2) {
      alert("Need at least 2 points to save a land path.\nKeep clicking, or press Esc to cancel.");
      return;
    }

    const cleanPoints = pts.map(p => {
      const out = { x: p.x, y: p.y };
      if (p.pause)            out.pause   = true;
      if (p.pauseMs  != null) out.pauseMs = p.pauseMs;
      if (p.name)             out.name    = p.name;
      return out;
    });
    const id          = "land_" + entityId + "_" + Date.now();

    const newEntry = { id, entityId, points: cleanPoints };

    landData.push(newEntry);
    _download(landData, "land.json");
    onSaved?.(newEntry);

    deactivate();
    _status(`Land path for "${entityId}" saved — replace data/land.json with the downloaded file.`);
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
    // Ask which dock this path is for before doing anything else
    const id = prompt(
      "Entity ID for this land path:\n(must match the entityId on the dock stop in shipPath.json)",
      ""
    );
    if (!id || !id.trim()) return; // cancelled or blank — don't activate

    if (active) deactivate();

    active   = true;
    entityId = id.trim();
    pts      = [];

    _buildPreview();

    svg.addEventListener("click",     _onClick);
    svg.addEventListener("mousemove", _onMouseMove);
    svg.addEventListener("dblclick",  _onDblClick);
    document.addEventListener("keydown", _onKeyDown);

    svg.style.cursor = "crosshair";
    _status(`Land Path [${entityId}] — click to place points · P = pause · Enter = done · Esc = cancel`);
  }

  function deactivate() {
    active   = false;
    entityId = null;
    pts      = [];

    _destroyPreview();

    svg.removeEventListener("click",     _onClick);
    svg.removeEventListener("mousemove", _onMouseMove);
    svg.removeEventListener("dblclick",  _onDblClick);
    document.removeEventListener("keydown", _onKeyDown);

    svg.style.cursor = "";
  }

  function isActive() { return active; }

  return { activate, deactivate, isActive };
}
