// camera.js v2026-03-22-01
// Minimal extraction of existing MapBuddy camera (no behavior changes yet)

export function createViewBoxCamera(svg) {

  let view = null;
  let listeners = [];

  let _rafPending = false;
  let _zoomLocked = false;

  function emitChange() {
    if (_rafPending) return;
    _rafPending = true;
    requestAnimationFrame(() => {
      _rafPending = false;
      const v = getViewBox();
      listeners.forEach(fn => fn(v));
    });
  }

  function setViewBox(x, y, w, h) {
    svg.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
    emitChange();
  }

  function getViewBox(){
    const vb = svg.viewBox.baseVal;
    return { x: vb.x, y: vb.y, w: vb.width, h: vb.height };
  }

  function clamp(v, min, max){
    return Math.max(min, Math.min(max, v));
  }

  function easeInOutCubic(t){
    return t < 0.5
      ? 4*t*t*t
      : 1 - Math.pow(-2*t + 2, 3)/2;
  }

  function animateTo(to, ms = 300){
    const from = getViewBox();

    const start = performance.now();

    function step(now){
      const t = Math.min(1, (now - start) / ms);
      const e = easeInOutCubic(t);

      const x = from.x + (to.x - from.x) * e;
      const y = from.y + (to.y - from.y) * e;
      const w = from.w + (to.w - from.w) * e;
      const h = from.h + (to.h - from.h) * e;

      setViewBox(x, y, w, h);

      if (t < 1) requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  }

  function attachControls(){

    let isPanning = false;
    let last = null;

    svg.addEventListener("contextmenu", (e) => {
      e.preventDefault();
    });

    // --- mouse pan (right click) ---
    svg.addEventListener("mousedown", (e) => {
      if (!view) view = getViewBox();

      if (e.button !== 2) return;

      isPanning = true;
      last = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener("mousemove", (e) => {
      if (!view) view = getViewBox();
      if (!isPanning) return;

      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;

      view.x -= dx * (view.w / svg.clientWidth);
      view.y -= dy * (view.h / svg.clientHeight);

      setViewBox(view.x, view.y, view.w, view.h);
      last = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener("mouseup", () => isPanning = false);

    // --- wheel zoom ---
    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (_zoomLocked) return;

      if (!view) view = getViewBox();

      const rect = svg.getBoundingClientRect();

      const mx = (e.clientX - rect.left) / rect.width;
      const my = (e.clientY - rect.top) / rect.height;

      const scale = e.deltaY > 0 ? 1.1 : 0.9;

      const newW = view.w * scale;
      const newH = view.h * scale;

      view.x += (view.w - newW) * mx;
      view.y += (view.h - newH) * my;
      view.w = newW;
      view.h = newH;

      setViewBox(view.x, view.y, view.w, view.h);

    }, { passive: false });

    // --- touch (same as before, simplified carry-over) ---
    let touchMode = null;
    let startDist = 0;
    let startMid = null;
    let startView = null;

    svg.addEventListener("touchstart", (e) => {
      if (e.touches.length === 1) {
        touchMode = "pan";
        last = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else if (e.touches.length === 2) {
        touchMode = "pinch";

        if (!view) view = getViewBox();
        startView = { ...view };

        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        startDist = Math.hypot(dx, dy);

        startMid = {
          x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
          y: (e.touches[0].clientY + e.touches[1].clientY) / 2
        };
      }
    }, { passive: false });

    svg.addEventListener("touchmove", (e) => {
      if (!view) view = getViewBox();

      if (touchMode === "pan" && e.touches.length === 1) {
        const t = e.touches[0];
        const dx = t.clientX - last.x;
        const dy = t.clientY - last.y;

        view.x -= dx * (view.w / svg.clientWidth);
        view.y -= dy * (view.h / svg.clientHeight);

        setViewBox(view.x, view.y, view.w, view.h);
        last = { x: t.clientX, y: t.clientY };
      }

      if (_zoomLocked) touchMode = "pan"; // degrade pinch to pan while locked

      if (touchMode === "pinch" && e.touches.length === 2) {
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        const dist = Math.hypot(dx, dy);

        const scale = startDist / dist;

        const rect = svg.getBoundingClientRect();
        const mx = (startMid.x - rect.left) / rect.width;
        const my = (startMid.y - rect.top) / rect.height;

        const newW = startView.w * scale;
        const newH = startView.h * scale;

        view.x = startView.x + (startView.w - newW) * mx;
        view.y = startView.y + (startView.h - newH) * my;
        view.w = newW;
        view.h = newH;

        setViewBox(view.x, view.y, view.w, view.h);
      }

      e.preventDefault();
    }, { passive: false });

    svg.addEventListener("touchend", () => {
      touchMode = null;
    });
  }

  // initialize
  // view = getViewBox();
  attachControls();

  function onChange(fn) {
    listeners.push(fn);
  }

  function lockZoom()   { _zoomLocked = true; }
  function unlockZoom() { _zoomLocked = false; }

  return {
    getViewBox,
    setViewBox,
    animateTo,
    onChange,
    lockZoom,
    unlockZoom,
  };
}