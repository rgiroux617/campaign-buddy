// shipPanel.js
// Single responsibility: open a full-screen ship detail view when the ship
// is clicked. Zooms the camera to the ship, rotates it 90°, and slides up
// an info panel from the bottom of the viewport.
//
// Designed as a standalone module reusable across campaigns.
//
// Usage:
//   const shipPanel = createShipPanel(document.body, {
//     camera, shipLayer, shipX, shipY
//   });
//   shipPanel.open(cardData);
//
// cardData shape (same as cardOverlay):
//   { title, subtitle, body, quote, npcs, tags, note }
//
// Returns: { open, close, isOpen }

// ── Layout constants ──────────────────────────────────────────────────────────
// Zoom is computed from hex geometry: hexesVisible controls how many hex-heights
// fill the upper portion of the viewport (above the panel).
// entryFracY / settleFracY: vertical position of ship in frame (0=top, 1=bottom).
// Panel takes panelFrac of viewport height; ship lives in (1 - panelFrac) above.
const PANEL = {
  hexesVisible: 1.25,  // hex-heights visible in upper area
  panelFrac:    0.45,  // fraction of viewport the panel occupies
  entryFracY:   0.80,  // ship enters near bottom of upper area
  settleFracY:  0.30,  // ship rows up to this position (lower = higher in frame)
  rotateDeg:    90,    // degrees to rotate ship for horizontal display
  rotateMs:     700,   // rotation animation duration ms
  zoomMs:       800,   // initial zoom duration ms
  settleMs:     1400,  // upward pan duration ms
  settleDelay:  300,   // ms after zoom before pan begins
  panelSlideMs: 500,   // panel slide-up duration ms
};

export function createShipPanel(containerEl, { camera, shipLayer, shipX, shipY, hexSize = 22, svg }) {

  // ── Build DOM ──────────────────────────────────────────────────────────────
  const panel = document.createElement("div");
  panel.id = "ship-panel";
  panel.setAttribute("aria-hidden", "true");

  panel.innerHTML = `
    <div id="ship-panel-inner">
      <button id="ship-panel-close" aria-label="Close">✕</button>
      <div id="ship-panel-title"></div>
      <div id="ship-panel-subtitle"></div>
      <div id="ship-panel-divider"></div>
      <div id="ship-panel-body"></div>
      <div id="ship-panel-quote"></div>
      <div id="ship-panel-npcs"></div>
      <div id="ship-panel-tags"></div>
      <div id="ship-panel-note"></div>
    </div>
  `;

  containerEl.appendChild(panel);

  // ── Internal refs ──────────────────────────────────────────────────────────
  const titleEl    = panel.querySelector("#ship-panel-title");
  const subtitleEl = panel.querySelector("#ship-panel-subtitle");
  const bodyEl     = panel.querySelector("#ship-panel-body");
  const quoteEl    = panel.querySelector("#ship-panel-quote");
  const npcsEl     = panel.querySelector("#ship-panel-npcs");
  const tagsEl     = panel.querySelector("#ship-panel-tags");
  const noteEl     = panel.querySelector("#ship-panel-note");
  const closeBtn   = panel.querySelector("#ship-panel-close");

  let _isOpen       = false;
  let _savedCamera  = null;
  let _wasAnimating = false;

  // ── Close ──────────────────────────────────────────────────────────────────
  function close() {
    if (!_isOpen) return;
    _isOpen = false;

    document.getElementById('wrap').style.padding = '';

    panel.classList.remove("ship-panel-visible");
    panel.setAttribute("aria-hidden", "true");

    // Reverse rotation
    shipLayer.setRotation(0, PANEL.rotateMs);

    // Restore camera
    if (_savedCamera) {
      camera.animateTo(_savedCamera, PANEL.zoomMs);
      _savedCamera = null;
    }

    // Restore zoom level, wake, and body animations after camera returns
    setTimeout(() => {
      const v = camera.getViewBox();
      shipLayer.setZoomLevel(v.w);
    }, PANEL.zoomMs);

    if (!_wasAnimating) shipLayer.stopAnimation();
  }

  closeBtn.addEventListener("click", close);
  panel.addEventListener("click", (e) => { if (e.target === panel) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && _isOpen) close(); });

  // ── Open ───────────────────────────────────────────────────────────────────
  function open(cardData = {}) {
    if (_isOpen) { close(); return; }
    _isOpen = true;

    document.getElementById('wrap').style.padding = '0';

    // Save camera state and note if animation was already running
    _savedCamera  = camera.getViewBox();
    _wasAnimating = shipLayer.group.querySelector(".oar-animated") !== null;

    // Populate content
    titleEl.textContent    = cardData.title ?? "The Implication";
    subtitleEl.textContent = cardData.subtitle ?? "";
    subtitleEl.style.display = cardData.subtitle ? "block" : "none";

    bodyEl.innerHTML = cardData.body
      ? cardData.body.replace(/\n/g, "<br>")
      : "";
    bodyEl.style.display = cardData.body ? "block" : "none";

    quoteEl.innerHTML = cardData.quote
      ? cardData.quote.replace(/\n/g, "<br>")
      : "";
    quoteEl.style.display = cardData.quote ? "block" : "none";

    npcsEl.innerHTML = "";
    if (cardData.npcs?.length) {
      cardData.npcs.forEach(npc => {
        const row = document.createElement("div");
        row.className = "ship-panel-npc-row";
        row.innerHTML =
          `<span class="ship-panel-npc-name">${npc.name}</span>` +
          ` · <span class="ship-panel-npc-desc">${npc.desc}</span>`;
        npcsEl.appendChild(row);
      });
    }
    npcsEl.style.display = cardData.npcs?.length ? "block" : "none";

    tagsEl.innerHTML = "";
    if (cardData.tags?.length) {
      cardData.tags.forEach(tag => {
        const pill = document.createElement("span");
        pill.className = "ship-panel-tag";
        pill.textContent = tag;
        tagsEl.appendChild(pill);
      });
    }
    tagsEl.style.display = cardData.tags?.length ? "flex" : "none";

    noteEl.innerHTML = cardData.note
      ? cardData.note.replace(/\n/g, "<br>")
      : "";
    noteEl.style.display = cardData.note ? "block" : "none";

    // ── Camera: hex-geometry based zoom ────────────────────────────────────
    // Flat-top hex height = hexSize * sqrt(3). Size the viewBox so hexesVisible
    // hex-heights fill the upper portion of the viewport (above the panel).
    // viewBox.y = shipY - fraction * zoomH places ship at that fraction from top.
    const currentVb = svg.viewBox.baseVal;
    const scale = svg.getBoundingClientRect().width / currentVb.width;
    const targetPx = window.innerWidth * (1 - PANEL.panelFrac);
    const zoomWidth = targetPx / scale;
    const hexH = hexSize * Math.sqrt(3);
    const zoomH = zoomWidth * (svg.viewBox.baseVal.height / svg.viewBox.baseVal.width);
    const cx = shipX - zoomWidth / 2;
    const cy = shipY - zoomH * PANEL.settleFracY;

    console.log("[shipPanel] shipX:", shipX.toFixed(1), "shipY:", shipY.toFixed(1),
      "| zoomW:", zoomWidth.toFixed(1), "zoomH:", zoomH.toFixed(1),
      "| scale:", scale.toFixed(3), "targetPx:", targetPx.toFixed(0));

    // Entry: ship at bottom of upper area (arriving from below)
    camera.animateTo({
      x: cx,
      y: shipY - PANEL.entryFracY * zoomH,
      w: zoomWidth,
      h: zoomH,
    }, PANEL.zoomMs);

    // Force zoom2 asset immediately
    shipLayer.setZoomLevel(zoomWidth);

    // Rotate ship to horizontal
    shipLayer.setRotation(PANEL.rotateDeg, PANEL.rotateMs);

    // Start animation first, THEN stop wake and body — order matters because
    // startAnimation adds the classes that these then remove.
    if (!_wasAnimating) shipLayer.startAnimation();

    // Stage 2: gentle upward pan — ship rows into final position, one time only
    setTimeout(() => {
      if (_isOpen) camera.animateTo({
        x: cx,
        y: shipY - PANEL.settleFracY * zoomH,
        w: zoomWidth,
        h: zoomH,
      }, PANEL.settleMs);
    }, PANEL.settleDelay);

    // Slide panel up
    panel.setAttribute("aria-hidden", "false");
    // Tiny defer so CSS transition fires after display change
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        panel.classList.add("ship-panel-visible");
      });
    });
  }

  function isOpen() { return _isOpen; }

  return { open, close, isOpen };
}

// ── CSS ────────────────────────────────────────────────────────────────────────
const PANEL_CSS = `
#ship-panel {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 200;
}

#ship-panel.ship-panel-visible {
  pointer-events: none; /* panel-inner handles clicks; background stays interactive */
}

#ship-panel-inner {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  max-height: 45vh;
  overflow-y: auto;
  background: rgba(8, 16, 24, 0.94);
  border-top: 1px solid rgba(255,255,255,0.10);
  border-radius: 20px 20px 0 0;
  padding: 28px 28px 32px;
  box-shadow:
    0 -8px 40px rgba(0,0,0,0.6),
    0 0 80px rgba(40,80,100,0.25);

  transform: translateY(100%);
  transition: transform ${PANEL.panelSlideMs}ms cubic-bezier(0.32, 0.72, 0, 1);
  pointer-events: all;
}

#ship-panel.ship-panel-visible #ship-panel-inner {
  transform: translateY(0);
}

#ship-panel-close {
  position: absolute;
  top: 14px; right: 18px;
  background: none;
  border: none;
  color: rgba(255,255,255,0.35);
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  line-height: 1;
  transition: color 150ms;
  font-family: inherit;
}
#ship-panel-close:hover { color: rgba(255,255,255,0.85); }

#ship-panel-title {
  font-family: "IM Fell English SC", serif;
  font-size: 26px;
  color: #e8d9b0;
  text-align: center;
  line-height: 1.2;
  letter-spacing: 0.03em;
  margin-bottom: 4px;
}

#ship-panel-subtitle {
  font-size: 12px;
  color: rgba(255,255,255,0.38);
  text-align: center;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  margin-bottom: 14px;
}

#ship-panel-divider {
  width: 48px;
  height: 1px;
  background: rgba(232,217,176,0.25);
  margin: 0 auto 18px;
}

#ship-panel-body {
  font-size: 16px;
  color: rgba(255,255,255,0.80);
  line-height: 1.65;
  margin-bottom: 14px;
}

#ship-panel-quote {
  font-size: 14px;
  color: rgba(232,217,176,0.6);
  font-style: italic;
  padding-left: 14px;
  border-left: 2px solid rgba(232,217,176,0.22);
  line-height: 1.6;
  margin-bottom: 14px;
}

#ship-panel-npcs {
  margin-bottom: 14px;
}

.ship-panel-npc-row {
  font-size: 13px;
  color: rgba(255,255,255,0.72);
  padding: 6px 0;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  line-height: 1.4;
}
.ship-panel-npc-row:last-child { border-bottom: none; }
.ship-panel-npc-name { font-weight: 600; color: rgba(255,255,255,0.90); }
.ship-panel-npc-desc { color: rgba(255,255,255,0.46); font-style: italic; }

#ship-panel-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 14px;
}

.ship-panel-tag {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 3px 10px;
  border-radius: 20px;
  border: 1px solid rgba(255,255,255,0.16);
  color: rgba(255,255,255,0.46);
}

#ship-panel-note {
  padding: 11px 14px;
  border-radius: 8px;
  background: rgba(255,255,255,0.04);
  border-left: 2px solid rgba(232,217,176,0.35);
  font-size: 14px;
  color: rgba(232,217,176,0.70);
  font-style: italic;
  line-height: 1.6;
}

@media (max-width: 600px) {
  #ship-panel-inner { padding: 22px 18px 28px; }
  #ship-panel-title { font-size: 22px; }
}
`;

// Inject CSS once — use template literal to embed PANEL constants
const _style = document.createElement("style");
_style.textContent = PANEL_CSS
  .replace("${PANEL.panelSlideMs}", `${PANEL.panelSlideMs}`);
document.head.appendChild(_style);
