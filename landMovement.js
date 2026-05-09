// landMovement.js
// Animates the helmet/land-party icon along a drawn Catmull-Rom path during
// a ship dock stop.
//
// Usage:
//   const landMove = createLandMovement(helmetLayer, landData);
//   landMove.hasPath("steele_monolith")           // → true / false
//   await landMove.play("steele_monolith", 4000, 400)
//     // entityId, pauseMs (total dock window), fadeMs (fade in + out each)
//
// ── Timing model ─────────────────────────────────────────────────────────────
// Total dock window = pauseMs.
// That window is divided:
//   fade-in  (fadeMs)
//   travel   (pauseMs - 2×fadeMs - sum of all pause-point durations)
//   pauses   (each point marked { pause: true, pauseMs: N } waits N ms)
//   fade-out (fadeMs)
// Speed is auto-calculated so movement exactly fills the remaining time.
// If pauses + fades exceed pauseMs, movement speed is clamped to a minimum
// (1 map unit/s) so the helmet still travels — it will just run over time.
//
// ── Path format ──────────────────────────────────────────────────────────────
// land.json is an array of objects:
//   { id, entityId, points: [{x, y}, ...] }
//
// Pause points carry extra fields set by the draw tool:
//   { x, y, pause: true, pauseMs: 1500, name: "optional label" }
//
// The drawn path should be a closed loop so the helmet returns to the ship.

import { buildSpline, sampleSpline } from "./splineUtils.js";

const LAND = {
  maxDeltaMs:      50,   // frame-time cap — same as shipMovement
  minSpeedPerMs:    1,   // minimum map units/ms — prevents zero-speed lock
};

export function createLandMovement(helmetLayer, landData) {

  // Build splines for all land paths at construction time.
  // Keyed by entityId for O(1) lookup at dock stops.
  const _byEntity = new Map();

  function _buildIndex() {
    _byEntity.clear();
    for (const entry of (landData ?? [])) {
      if (!entry.entityId || !entry.points?.length) continue;
      const spline = buildSpline(entry.points);
      if (spline) _byEntity.set(entry.entityId, { spline, points: entry.points });
    }
  }
  _buildIndex();

  // ── Public: hasPath ───────────────────────────────────────────────────────
  function hasPath(entityId) {
    return _byEntity.has(entityId);
  }

  // ── Public: play ──────────────────────────────────────────────────────────
  // Animates the helmet along the land path for entityId.
  // Total elapsed time ≈ pauseMs (fade-in + travel + pauses + fade-out).
  async function play(entityId, pauseMs, fadeMs) {
    const entry = _byEntity.get(entityId);
    if (!entry) return;

    const { spline, points } = entry;

    // ── Build pause stop list (parallel to shipMovement's stop list) ────────
    // Each pause point in the drawn path becomes a stop at its arc length.
    const pauseStops = [];
    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      if (pt.pause) {
        pauseStops.push({
          arcLen:  spline.pointArcLens[i],
          pauseMs: pt.pauseMs ?? 0,
          name:    pt.name ?? null,
        });
      }
    }

    // Total time that pauses will consume
    const totalPauseMs = pauseStops.reduce((sum, s) => sum + s.pauseMs, 0);

    // Movement time = dock window minus fades minus pauses, minimum clamped
    const movementMs = Math.max(
      spline.totalLength / LAND.minSpeedPerMs,
      pauseMs - 2 * fadeMs - totalPauseMs
    );

    const speedUnitsPerMs = spline.totalLength / movementMs;

    // Position helmet at path start before fading in
    const startSample = sampleSpline(spline, 0);
    helmetLayer.setPosition(startSample.x, startSample.y);
    helmetLayer.setHeading(startSample.headingDeg);

    await helmetLayer.fadeIn(fadeMs);

    // ── Animate in legs, pausing at each pause stop ──────────────────────
    let currentArcLen = 0;
    for (const stop of pauseStops) {
      await _animateRun(spline, speedUnitsPerMs, currentArcLen, stop.arcLen);
      currentArcLen = stop.arcLen;
      if (stop.pauseMs > 0) await _wait(stop.pauseMs);
    }
    // Final leg to end of path
    await _animateRun(spline, speedUnitsPerMs, currentArcLen, spline.totalLength);

    await helmetLayer.fadeOut(fadeMs);
  }

  // ── Core animation run ────────────────────────────────────────────────────
  // Moves the helmet from fromArcLen to toArcLen at speedUnitsPerMs.
  function _animateRun(spline, speedUnitsPerMs, fromArcLen, toArcLen) {
    return new Promise(resolve => {
      if (toArcLen <= fromArcLen) { resolve(); return; }

      let currentArcLen = fromArcLen;
      let lastTime      = null;

      function step(now) {
        if (lastTime === null) lastTime = now;
        const dt = Math.min(now - lastTime, LAND.maxDeltaMs);
        lastTime  = now;

        currentArcLen = Math.min(currentArcLen + speedUnitsPerMs * dt, toArcLen);

        const { x, y, headingDeg } = sampleSpline(spline, currentArcLen);
        helmetLayer.setPosition(x, y);
        helmetLayer.setHeading(headingDeg);

        if (currentArcLen < toArcLen) {
          requestAnimationFrame(step);
        } else {
          resolve();
        }
      }

      requestAnimationFrame(step);
    });
  }

  function _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ── rebuild ───────────────────────────────────────────────────────────────
  // Called by app.js after the land draw tool saves a new path, so the new
  // path is live without a page reload.
  function rebuild() {
    _buildIndex();
  }

  return { hasPath, play, rebuild };
}
