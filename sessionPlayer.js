// sessionPlayer.js
// Plays a single session's ship segments with a one-time camera framing.
//
// Usage:
//   const player = createSessionPlayer(shipMove, camera, svg, shipPathData);
//   await player.playSession({ id, name, shipSegments, startViewMobile, startViewDesktop });
//   player.stop();
//
// ── Camera behaviour ──────────────────────────────────────────────────────────
// On session start: camera glides to the appropriate startView for the current
//   screen size (startViewDesktop on wide screens, startViewMobile on phones).
//   Falls back to startViewMobile if startViewDesktop is not yet set.
// During travel   : camera is completely static — no following, no dock zooms.
// Session end     : user can pan/zoom freely.
//
// ── Screen detection ──────────────────────────────────────────────────────────
// Any screen wider than MOBILE_MAX_WIDTH is treated as desktop.
// Adjust this value if tablets need to be reclassified.

// ── Tuning ───────────────────────────────────────────────────────────────────
const SP = {
  approachMs:      1200,   // ms for the opening glide to startView
  audioLeadMs:      800,
  mobileMaxWidth:  1024,   // px — screens wider than this use startViewDesktop
};

export function createSessionPlayer(shipMove, camera, svg, shipPathData) {

  let _stopRequested = false;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function _aspect() {
    return svg.clientHeight / svg.clientWidth;
  }

  // Smooth animated pan+zoom to center (x, y) at width w, returns a Promise.
  function _animateCenter(x, y, w, ms) {
    return new Promise(resolve => {
      const from = camera.getViewBox();
      const h = w * _aspect();
      const to = { x: x - w / 2, y: y - h / 2, w, h };

      if (ms <= 0) {
        camera.setViewBox(to.x, to.y, to.w, to.h);
        resolve();
        return;
      }

      const start = performance.now();

      function step(now) {
        const t = Math.min(1, (now - start) / ms);
        // ease-in-out-cubic
        const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

        camera.setViewBox(
          from.x + (to.x - from.x) * e,
          from.y + (to.y - from.y) * e,
          from.w + (to.w - from.w) * e,
          from.h + (to.h - from.h) * e,
        );

        if (t < 1 && !_stopRequested) requestAnimationFrame(step);
        else resolve();
      }

      requestAnimationFrame(step);
    });
  }

  // ── Public: playSession ───────────────────────────────────────────────────
  async function playSession(session) {
    _stopRequested = false;

    // No callbacks needed — camera is static during playback
    shipMove.clearCallbacks();

    // Brief pause so audio has time to start cleanly before the glide begins
    await new Promise(resolve => setTimeout(resolve, SP.audioLeadMs));

    // Pick the right startView for the current screen size.
    // startViewDesktop is used on wide screens; startViewMobile is the fallback
    // for phones or when the desktop entry hasn't been set yet (null).
    const isDesktop = window.innerWidth > SP.mobileMaxWidth;
    const startView = (isDesktop ? session.startViewDesktop : null)
                   ?? session.startViewMobile;

    // Glide to the session's starting framing if defined.
    if (startView) {
      await _animateCenter(
        startView.x,
        startView.y,
        startView.zoom,
        SP.approachMs
      );
    } else {
      // Fallback: pan to first point of first segment at a reasonable zoom
      const firstSegId = session.shipSegments?.[0];
      const firstSeg = (shipPathData ?? []).find(s => s.id === firstSegId);
      if (firstSeg?.points?.length) {
        const pt = firstSeg.points[0];
        await _animateCenter(pt.x, pt.y, 600, SP.approachMs);
      }
    }

    // Play the session's segments — camera stays exactly where it is
    await shipMove.playSegments(session.shipSegments);

    // Clean up
    shipMove.clearCallbacks();
  }

  // ── Public: stop ──────────────────────────────────────────────────────────
  function stop() {
    _stopRequested = true;
    shipMove.stop();
    shipMove.clearCallbacks();
  }

  return { playSession, stop };
}