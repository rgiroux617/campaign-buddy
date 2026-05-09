// shipMovement.js
// Animates the ship (and optionally the helmet) along hand-drawn Catmull-Rom
// paths stored in shipPath.json.
//
// Usage:
//   const move = createShipMovement(shipLayer, shipPathData, helmetLayer, landMovement);
//   move.play();                       // plays all segments; returns a Promise
//   move.playSegments(["seg1","seg2"]) // plays named segments only; returns a Promise
//   move.stop();                       // interrupts cleanly at the next frame
//   move.setCallbacks({ onFrame, onDockArrive, onDockLeave })
//   move.clearCallbacks()
//
// ── Callbacks (used by sessionPlayer) ────────────────────────────────────────
//   onFrame(x, y)              — fired every animation frame with ship position
//   onDockArrive(x, y, zoom)   — fired when ship reaches a dock stop (fire-and-forget)
//   onDockLeave()              — fired after dock pause ends; AWAITED before ship moves
//
// ── Path data format ─────────────────────────────────────────────────────────
// shipPathData is the parsed shipPath.json array.
// Each entry is one sailing segment with a points array:
//
//   { x, y }                          required — SVG map coordinates
//   { ..., speedMult: 0.5 }           optional — 1.0 = normal, lower = slower
//   { ..., dock: true,                optional — ship pauses; helmet appears
//           pauseMs: 2000,                        pause duration in ms
//           zoom: 300,                            viewBox width to zoom to at this dock
//           entityId: "steele_monolith" }         links to a land.json path
//
// At a dock stop:
//   • If landMovement.hasPath(entityId) → helmet travels the drawn land loop
//   • Otherwise → helmet fades in, waits pauseMs, fades out in place
//
// Multiple segments chain automatically: the end of segment N connects
// smoothly to the start of segment N+1 because the draw tool snaps
// their endpoints together.

import { buildSpline, sampleSpline } from "./splineUtils.js";

// ── Tuning constants ──────────────────────────────────────────────────────────
const MOVE = {
  speedUnitsPerMs: 1 / 75, // map units per ms  — matches old hex-step feel
                             // (≈ 13 map units per second at speedMult 1.0)
                             // lower number = faster; higher = slower
  dockFadeMs:      400,     // helmet fade-in / fade-out duration in ms
  maxDeltaMs:       50,     // frame-time cap — prevents a big position jump
                             // when the browser tab is hidden then shown again
  segmentRotateMs: 400,     // heading rotation at segment transitions (ms)
                             // set to 0 to snap instantly
};

export function createShipMovement(shipLayer, shipPathData, helmetLayer = null, landMovement = null) {

  let _stopRequested  = false;
  let _currentHeading = 0;    // tracked so the helmet can inherit it at dock stops
  let _firstSegment   = true; // skip rotation animation on the very first segment
  let _callbacks      = {};   // set by sessionPlayer via setCallbacks()

  // Build all splines at creation time, storing each segment's id alongside.
  // Segments with fewer than 2 points are silently skipped so bad data
  // doesn't crash the whole journey.
  const _segments = (shipPathData ?? [])
    .map(seg => ({
      id: seg.id,
      spline: buildSpline(seg.points),
      points: seg.points,
      segMult: seg.speedMult ?? 1.0,
    }))
    .filter(s => s.spline !== null);

  // ── Speed interpolation ───────────────────────────────────────────────────
  // Returns the speed multiplier at a given arc-length position by finding
  // the two nearest control points and linearly interpolating between their
  // speedMult values.  Defaults to 1.0 when not specified.
  function _speedMult(spline, points, arcLen) {
    const lens = spline.pointArcLens;
    // Find lo such that lens[lo] <= arcLen < lens[lo+1]
    let lo = lens.length - 2; // default to the last segment
    for (let i = 0; i < lens.length - 1; i++) {
      if (arcLen <= lens[i + 1]) { lo = i; break; }
    }
    const hi   = lo + 1;
    const span = lens[hi] - lens[lo];
    const frac = span > 0 ? Math.max(0, Math.min(1, (arcLen - lens[lo]) / span)) : 0;
    return (points[lo].speedMult ?? 1.0) + ((points[hi].speedMult ?? 1.0) - (points[lo].speedMult ?? 1.0)) * frac;
  }

  // ── Core animation run ────────────────────────────────────────────────────
  // Moves the ship from fromArcLen to toArcLen along the spline.
  // Returns a Promise that resolves when toArcLen is reached or stop() fires.
  // Fires _callbacks.onFrame(x, y) on every frame if set.
  function _animateRun(spline, points, fromArcLen, toArcLen, segmentMult = 1.0) {
    return new Promise(resolve => {
      const runLength = toArcLen - fromArcLen;
      if (runLength <= 0) { resolve(); return; }

      let currentArcLen = fromArcLen;
      let lastTime      = null;

      function step(now) {
        if (lastTime === null) lastTime = now;
        const dt = Math.min(now - lastTime, MOVE.maxDeltaMs);
        lastTime  = now;

        // Advance arc length by speed × elapsed time, clamped to the target
        const mult = _speedMult(spline, points, currentArcLen);
        currentArcLen = Math.min(
          currentArcLen + MOVE.speedUnitsPerMs * mult * segmentMult * dt,
          toArcLen
        );

        // Position and heading come directly from the spline — no separate
        // heading interpolation needed
        const { x, y, headingDeg } = sampleSpline(spline, currentArcLen);
        shipLayer.setPosition(x, y);
        shipLayer.setHeading(headingDeg);
        _currentHeading = headingDeg;

        // Notify session player of current position (used for camera follow)
        _callbacks.onFrame?.(x, y);

        if (currentArcLen < toArcLen && !_stopRequested) {
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

  // ── Heading rotation ──────────────────────────────────────────────────────
  // Smoothly rotates the ship from _currentHeading to targetDeg over durationMs,
  // always taking the shortest angular path (handles 350°→10° wraparound).
  // Resolves immediately if the difference is negligible or duration is 0.
  function _rotateToHeading(targetDeg, durationMs) {
    return new Promise(resolve => {
      // Shortest angular difference in [-180, 180]
      let diff = ((targetDeg - _currentHeading) % 360 + 360) % 360;
      if (diff > 180) diff -= 360;

      if (durationMs <= 0 || Math.abs(diff) < 0.5) {
        shipLayer.setHeading(targetDeg);
        _currentHeading = targetDeg;
        resolve();
        return;
      }

      const fromDeg  = _currentHeading;
      let startTime  = null;

      function step(now) {
        if (startTime === null) startTime = now;
        const t       = Math.min(1, (now - startTime) / durationMs);
        const heading = fromDeg + diff * t;
        shipLayer.setHeading(heading);
        _currentHeading = heading;
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      }

      requestAnimationFrame(step);
    });
  }

  // ── Play one segment ──────────────────────────────────────────────────────
  async function _playSegment({ spline, points, segMult }) {

    // Snap ship position to segment start (no-op when endpoints are snapped).
    const startSample = sampleSpline(spline, 0);
    shipLayer.setPosition(startSample.x, startSample.y);

    // Rotate to the starting heading.  First segment snaps immediately so
    // there's no odd spin from the default 0° before the journey begins.
    // All subsequent segments rotate smoothly to avoid the pop at join points.
    if (_firstSegment) {
      shipLayer.setHeading(startSample.headingDeg);
      _currentHeading = startSample.headingDeg;
      _firstSegment   = false;
    } else {
      await _rotateToHeading(startSample.headingDeg, MOVE.segmentRotateMs);
    }

    // Build the list of stops: all dock points, plus the final point.
    // The final point is always appended so the animation reaches the end
    // of the segment even when there are no dock points.
    const stops = [];
    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      if (pt.dock) {
        stops.push({
          arcLen:   spline.pointArcLens[i],
          dock:     true,
          pauseMs:  pt.pauseMs ?? 0,
          zoom:     pt.zoom    ?? null,
          entityId: pt.entityId ?? null,
        });
      }
    }
    // End-of-segment stop — just reaches the final position, no pause
    stops.push({
      arcLen:  spline.totalLength,
      dock:    false,
      pauseMs: 0,
    });

    let currentArcLen = 0;

    for (const stop of stops) {
      if (_stopRequested) break;

      // Animate to this stop's position on the spline
      await _animateRun(spline, points, currentArcLen, stop.arcLen, segMult);
      currentArcLen = stop.arcLen;

      if (_stopRequested) break;

      if (stop.dock && helmetLayer) {
        // Ship anchors — helmet appears and either travels a drawn land path
        // or simply fades in/out in place if no land path is defined.
        const pos = sampleSpline(spline, currentArcLen);
        helmetLayer.setPosition(pos.x, pos.y);
        helmetLayer.setHeading(_currentHeading);

        // Notify session player: ship has docked (camera can zoom in).
        // Fire-and-forget — the dock pause runs in parallel with the zoom animation.
        _callbacks.onDockArrive?.(pos.x, pos.y, stop.zoom);

        if (stop.entityId && landMovement?.hasPath(stop.entityId)) {
          // Land path available — helmet travels the loop, total time = pauseMs
          await landMovement.play(stop.entityId, stop.pauseMs, MOVE.dockFadeMs);
        } else {
          // No land path — fall back to fade-in / wait / fade-out in place
          await helmetLayer.fadeIn(MOVE.dockFadeMs);
          if (stop.pauseMs > 0) await _wait(stop.pauseMs);
          await helmetLayer.fadeOut(MOVE.dockFadeMs);
        }

        // Notify session player: dock pause ended.
        // Awaited so the camera can zoom back out before the ship resumes.
        if (_callbacks.onDockLeave) await _callbacks.onDockLeave();

      } else if (stop.pauseMs > 0) {
        // Non-dock pause (e.g. end-of-segment rest before next leg)
        await _wait(stop.pauseMs);
      }
    }
  }

  // ── Public: play ──────────────────────────────────────────────────────────
  // Plays all segments in order.  Chains smoothly because each segment's
  // start position is the same SVG coordinate as the previous segment's end.
  async function play() {
    _stopRequested = false;
    _firstSegment  = true; // reset so the first segment always snaps heading
    for (const seg of _segments) {
      if (_stopRequested) break;
      await _playSegment(seg);
    }
  }

  // ── Public: playSegments ─────────────────────────────────────────────────
  // Plays only the segments whose id appears in segmentIds (in array order).
  // Used by sessionPlayer to play a single session's route.
  async function playSegments(segmentIds) {
    _stopRequested = false;
    _firstSegment  = true;
    const toPlay   = segmentIds
      ? _segments.filter(s => segmentIds.includes(s.id))
      : _segments;
    for (const seg of toPlay) {
      if (_stopRequested) break;
      await _playSegment(seg);
    }
  }

  // ── Public: stop ─────────────────────────────────────────────────────────
  function stop() {
    _stopRequested = true;
  }

  // ── Public: callbacks ─────────────────────────────────────────────────────
  // Used by sessionPlayer to hook into frame and dock events.
  function setCallbacks(cbs) { _callbacks = cbs ?? {}; }
  function clearCallbacks()  { _callbacks = {}; }

  return { play, playSegments, stop, setCallbacks, clearCallbacks };
}
