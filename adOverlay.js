// adOverlay.js
// Self-contained in-world ad modal for the map viewer.
// Adapted from ad-engine.js — creates its own DOM programmatically,
// no index.html dependencies required.
//
// Usage:
//   const ads = createAdOverlay(document.body);
//   ads.open("visit-lothing", bannerEl);  // bannerEl enables flip animation

import { ADS } from "../BugmanAds/ads-data.js";

const AD_IMAGE_PATH = new URL("../BugmanAds/images/", import.meta.url).href;

export function createAdOverlay(containerEl) {

  // ── Build DOM ──────────────────────────────────────────────────────────────
  const modal = document.createElement("div");
  modal.id = "ad-modal";
  modal.className = "ad-hidden";
  modal.innerHTML = `
    <div id="ad-card" class="ad-card">
      <button id="ad-close-btn" aria-label="Close">✕</button>
      <div id="ad-kicker"></div>
      <div id="ad-title"></div>
      <div id="ad-body"></div>
      <div id="ad-footer"></div>
    </div>
  `;
  containerEl.appendChild(modal);

  const card    = modal.querySelector("#ad-card");
  const kicker  = modal.querySelector("#ad-kicker");
  const titleEl = modal.querySelector("#ad-title");
  const bodyEl  = modal.querySelector("#ad-body");
  const footer  = modal.querySelector("#ad-footer");
  const closeBtn = modal.querySelector("#ad-close-btn");

  // ── Close ──────────────────────────────────────────────────────────────────
  function close() {
    card.style.transition = "";
    card.style.transform  = "";
    modal.classList.add("ad-hidden");
    modal.classList.remove("ad-active");
  }

  closeBtn.addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  // ── renderBlock (carried from ad-engine.js) ───────────────────────────────
  function _renderBlock(block, container) {
    if (block.type === "paragraph") {
      const div = document.createElement("div");
      if (block.className) div.className = block.className;
      div.innerHTML = block.html;
      container.appendChild(div);
    }
    if (block.type === "list") {
      const ul = document.createElement("ul");
      if (block.className) ul.className = block.className;
      block.items.forEach(item => {
        const li = document.createElement("li");
        li.textContent = item;
        ul.appendChild(li);
      });
      container.appendChild(ul);
    }
  }

  // ── Open ───────────────────────────────────────────────────────────────────
  // bannerEl is optional — pass it to trigger the flip animation from the
  // card's ad banner image position.
  function open(adId, bannerEl = null) {
    const ad = ADS.find(a => a.id === adId);
    if (!ad) return;

    // Populate content
    titleEl.textContent = ad.title ?? "";

    if (ad.kicker) {
      kicker.textContent = ad.kicker;
      kicker.style.display = "block";
    } else {
      kicker.style.display = "none";
    }

    bodyEl.innerHTML = "";
    ad.body.forEach(block => _renderBlock(block, bodyEl));

    // Apply theme
    card.className = "ad-card";
    if (ad.theme)   card.classList.add("ad-theme-" + ad.theme);
    if (ad.variant) card.classList.add("ad-variant-" + ad.variant);

    // Buttons
    footer.innerHTML = "";
    ad.buttons.forEach(btn => {
      const button = document.createElement("button");
      button.textContent = btn.label;
      if (btn.className) button.className = btn.className;
      button.addEventListener("click", () => {
        if (btn.action === "close") close();
      });
      footer.appendChild(button);
    });

    // Flip animation (when a source banner element is provided)
    if (bannerEl) {
      card.style.transition = "";
      card.style.transform  = "";
      const first = bannerEl.getBoundingClientRect();
      modal.classList.remove("ad-hidden");
      modal.classList.add("ad-active");
      card.style.visibility = "hidden";
      requestAnimationFrame(() => {
        const last = card.getBoundingClientRect();
        const dx = first.left - last.left;
        const dy = first.top  - last.top;
        const sx = first.width  / last.width;
        const sy = first.height / last.height;
        card.style.transformOrigin = "top left";
        card.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy}) rotate(-0.6deg)`;
        card.style.visibility = "visible";
        requestAnimationFrame(() => {
          card.style.transition = "transform 620ms cubic-bezier(.18,.9,.32,1.1)";
          card.style.transform  = "none";
        });
      });
    } else {
      modal.classList.remove("ad-hidden");
      modal.classList.add("ad-active");
    }
  }

  return { open, close };
}

// ── CSS (injected once) ────────────────────────────────────────────────────
const AD_CSS = `
#ad-modal {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 300;
  padding: 20px;
  background: rgba(0,0,0,0.6);
  transition: background 200ms;
}

#ad-modal.ad-hidden  { display: none; }
#ad-modal.ad-active  { display: flex; }

.ad-card {
  position: relative;
  width: 100%;
  max-width: 440px;
  max-height: 80vh;
  overflow-y: auto;
  background: rgba(12, 22, 30, 0.97);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 16px;
  padding: 32px 28px 28px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.8);
  font-family: "Cormorant", serif;
  color: rgba(255,255,255,0.85);
}

/* Theme accents */
.ad-theme-oracle  { border-color: rgba(160,100,255,0.4); }
.ad-theme-bugman  { border-color: rgba(80,180,100,0.4); }
.ad-theme-patriot { border-color: rgba(100,140,220,0.4); }
.ad-theme-spooky  { border-color: rgba(120,60,180,0.4); background: rgba(8,5,15,0.98); }
.ad-theme-summer  { border-color: rgba(240,180,60,0.4); }

#ad-close-btn {
  position: absolute;
  top: 14px; right: 16px;
  background: none;
  border: none;
  color: rgba(255,255,255,0.4);
  font-size: 16px;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
  transition: color 150ms;
  font-family: inherit;
}
#ad-close-btn:hover { color: rgba(255,255,255,0.9); }

#ad-kicker {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: rgba(255,255,255,0.4);
  margin-bottom: 6px;
}

#ad-title {
  font-family: "IM Fell English SC", serif;
  font-size: 24px;
  color: #e8d9b0;
  margin-bottom: 16px;
}

#ad-body { font-size: 15px; line-height: 1.65; }
#ad-body .netScreed  { margin-bottom: 12px; }
#ad-body .simpleList { padding-left: 20px; margin: 8px 0; }
#ad-body .simpleList li { margin-bottom: 4px; }
#ad-body .boldText   { font-weight: 700; }
#ad-body .italicText { font-style: italic; }
#ad-body .greenText  { color: #4db87a; }
#ad-body .purpleText { color: #a864d4; }
#ad-body .redText    { color: #e05050; }

#ad-footer {
  margin-top: 20px;
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

#ad-footer .btn {
  font-family: "Cormorant", serif;
  font-size: 14px;
  padding: 8px 18px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.2);
  background: rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.8);
  cursor: pointer;
  transition: background 150ms, color 150ms;
}
#ad-footer .btn:hover {
  background: rgba(255,255,255,0.15);
  color: white;
}
`;

const _adStyle = document.createElement("style");
_adStyle.textContent = AD_CSS;
document.head.appendChild(_adStyle);