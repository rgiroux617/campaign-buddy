// cameraJourney.js
// Scripted camera movement for Campaign Buddy.
//
// Usage:
//   const journey = createCameraJourney(camera, center, svg);
//   journey.goTo("19,03", 200, 1000);               // single move, console-testable
//   journey.play(journeyDef, { card, shipPanel });   // full sequence with callbacks
//   journey.stop();                                  // interrupt and revert rotation

// ── Easing library ────────────────────────────────────────────────────────────
const EASINGS = {
  'ease': t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  'linear': t => t,
  'ease-in': t => t * t * t,
  'ease-out': t => 1 - Math.pow(1 - t, 3),
};

// ── Arc constants — tune these to adjust the zoom-arc behaviour ───────────────
const ARC = {
  minDistance: 130,  // map units below which no arc is applied (~4 hexes)
  maxZoom: 800,  // ceiling on how far out the arc pulls
  scale: 0.8,  // how aggressively distance drives the peak zoom-out
};

export function createCameraJourney(camera, center, svg) {

  let _stopRequested = false;
  let _currentRotation = 0;  // tracks rotation so each move knows its start angle

  // ── Resolve a named place or raw hex string to map coords ───────────────────
  function _resolve(hex, namedPlaces) {
    const resolved = namedPlaces?.[hex] ?? hex;
    const [c, r] = resolved.split(",").map(Number);
    return center(c, r);
  }

  // ── Convert keyframe values into a camera viewBox object ────────────────────
  function _toViewBox(hex, zoom, fracX, fracY, namedPlaces) {
    const { x, y } = _resolve(hex, namedPlaces);
    const aspect = svg.clientHeight / svg.clientWidth;
    const w = zoom;
    const h = zoom * aspect;
    return { x: x - w * fracX, y: y - h * fracY, w, h };
  }

  // ── Calculate straight-line distance between two hex addresses ───────────────
  function _hexDistance(hexA, hexB, namedPlaces) {
    const a = _resolve(hexA, namedPlaces);
    const b = _resolve(hexB, namedPlaces);
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  // ── Calculate peak zoom for an arc based on distance ────────────────────────
  function _peakZoom(distance, destinationZoom, currentZoom) {
    // Zooming out — no arc needed, destination is already wider
    if (destinationZoom >= currentZoom) return destinationZoom;
    return Math.min(ARC.maxZoom, destinationZoom + distance * ARC.scale);
  }

  // ── Apply rotation directly with no transition — used inside RAF loops ───────
  function _applyRotation(deg) {
    svg.style.transition = 'none';
    svg.style.transformOrigin = '50% 50%';
    svg.style.transform = `rotate(${deg}deg)`;
  }

  // ── Flat camera move — interpolates viewBox and rotation together ─────────────
  function _animateCamera(to, ms, easingFn, fromDeg, toDeg) {
    return new Promise(resolve => {

      if (ms <= 0) {
        camera.setViewBox(to.x, to.y, to.w, to.h);
        _applyRotation(toDeg);
        _currentRotation = toDeg;
        resolve();
        return;
      }

      const from = camera.getViewBox();
      const start = performance.now();

      function step(now) {
        const t = Math.min(1, (now - start) / ms);
        const e = easingFn(t);

        camera.setViewBox(
          from.x + (to.x - from.x) * e,
          from.y + (to.y - from.y) * e,
          from.w + (to.w - from.w) * e,
          from.h + (to.h - from.h) * e,
        );

        // Rotation interpolated with same easing as pan
        _applyRotation(fromDeg + (toDeg - fromDeg) * e);

        if (t < 1 && !_stopRequested) requestAnimationFrame(step);
        else {
          _currentRotation = toDeg;
          resolve();
        }
      }

      requestAnimationFrame(step);
    });
  }

  // ── Arc camera move — pan eased, zoom parabolic, rotation eased ──────────────
  function _animateCameraArc(fromVb, toVb, peakZoom, ms, easingFn, fromDeg, toDeg) {
    return new Promise(resolve => {

      const aspect = svg.clientHeight / svg.clientWidth;

      const fromCX = fromVb.x + fromVb.w / 2;
      const fromCY = fromVb.y + fromVb.h / 2;
      const toCX = toVb.x + toVb.w / 2;
      const toCY = toVb.y + toVb.h / 2;

      const start = performance.now();

      function step(now) {
        const t = Math.min(1, (now - start) / ms);
        const e = easingFn(t);

        // Pan — eased
        const cx = fromCX + (toCX - fromCX) * e;
        const cy = fromCY + (toCY - fromCY) * e;

        // Zoom — parabolic, no easing stutter
        const fromZoom = fromVb.w;
        const toZoom = toVb.w;
        const arc = 4 * t * (1 - t);
        const w = Math.max(toZoom, fromZoom + (toZoom - fromZoom) * t + (peakZoom - Math.max(fromZoom, toZoom)) * arc);
        const h = w * aspect;

        camera.setViewBox(cx - w / 2, cy - h / 2, w, h);

        // Rotation — eased, same curve as pan
        _applyRotation(fromDeg + (toDeg - fromDeg) * e);

        if (t < 1 && !_stopRequested) requestAnimationFrame(step);
        else {
          _currentRotation = toDeg;
          resolve();
        }
      }

      requestAnimationFrame(step);
    });
  }

  // ── Single hex navigation — console-testable, no rotation ────────────────────
  function goTo(hexStr, zoom, durationMs = 800, fracX = 0.5, fracY = 0.5) {
    const vb = _toViewBox(hexStr, zoom, fracX, fracY, null);
    _animateCamera(vb, durationMs, EASINGS['ease'], _currentRotation, _currentRotation);
  }

  // ── Play a full journey definition ───────────────────────────────────────────
  async function play(journeyDef, context = {}) {
    _stopRequested = false;

    const { namedPlaces = {}, keyframes = [] } = journeyDef;

    for (let i = 0; i < keyframes.length; i++) {
      if (_stopRequested) break;

      const kf = keyframes[i];
      const {
        hex,
        zoom,
        durationMs = 800,
        pauseMs = 0,
        fracX = 0.5,
        fracY = 0.5,
        rotateDeg = 0,
        easing = 'ease',
        onDepart = null,
        onArrive = null,
      } = kf;

      // rotateMs is no longer used — rotation is driven by durationMs
      // kept in journeys.js for backwards compatibility but ignored here

      // Fire onDepart before movement begins
      onDepart?.(context);

      const fromDeg = _currentRotation;
      const toDeg = rotateDeg;
      const toVb = _toViewBox(hex, zoom, fracX, fracY, namedPlaces);
      const easingFn = EASINGS[easing] ?? EASINGS['ease'];

      const isFirst = i === 0;
      if (!isFirst && durationMs > 0) {
        const prevHex = keyframes[i - 1].hex;
        const distance = _hexDistance(prevHex, hex, namedPlaces);

        const currentZoom = camera.getViewBox().w;
        const peak = _peakZoom(distance, zoom, currentZoom);
        const useArc = distance >= ARC.minDistance && peak > Math.max(currentZoom, zoom);

        if (useArc) {
          const fromVb = camera.getViewBox();
          await _animateCameraArc(fromVb, toVb, peak, durationMs, easingFn, fromDeg, toDeg);
        } else {
          await _animateCamera(toVb, durationMs, easingFn, fromDeg, toDeg);
        }
      } else {
        await _animateCamera(toVb, durationMs, easingFn, fromDeg, toDeg);
      }

      if (_stopRequested) break;

      onArrive?.(context);

      if (pauseMs > 0) await _wait(pauseMs);
    }

    // Revert rotation smoothly when sequence ends naturally
    await _animateCamera(camera.getViewBox(), 600, EASINGS['ease'], _currentRotation, 0);
  }

  // ── Interrupt and clean up ────────────────────────────────────────────────────
  function stop() {
    _stopRequested = true;
    // Snap rotation back — no smooth revert since we're interrupting
    _applyRotation(0);
    _currentRotation = 0;
  }

  // ── Internal helpers ──────────────────────────────────────────────────────────
  function _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  return { goTo, play, stop, getRotation: () => _currentRotation };
}