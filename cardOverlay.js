// cardOverlay.js
// Single responsibility: show and hide the info card overlay.
//
// Changes from previous version:
//   - Icon loading now uses loadSvg() from entityLayer.js, which bakes CSS
//     class-based fills into inline attributes. Fixes icons appearing black.
//   - Added: quote (italic, indented), npcs (flat list), ad banner (bottom)
//   - Ad banner click delegates to adOverlay.open() passed in at creation time
//
// Card data shape:
// {
//   title:    "Lothing",
//   subtitle: "Trading Port",
//   icon:     "images/lothing.svg",
//   body:     "A busy fishing town...",
//   quote:    "\"The bell tower...\" — Unknown",
//   npcs:     [{ name: "Gunnar", desc: "Harbourmaster" }],
//   tags:     ["settlement", "port"],
//   note:     "Session note text",
//   adId:     "visit-lothing",
// }

import { loadSvg } from "./entityLayer.js";
import { ADS } from "../BugmanAds/ads-data.js";

const AD_IMAGE_PATH = new URL("../BugmanAds/images/", import.meta.url).href;

export function createCardOverlay(containerEl, adOverlay = null) {

  // ── Build DOM ──────────────────────────────────────────────────────────────
  const overlay = document.createElement("div");
  overlay.id = "card-overlay";
  overlay.setAttribute("aria-hidden", "true");

  overlay.innerHTML = `
    <div id="card-inner">
      <button id="card-close" aria-label="Close">✕</button>
      <div id="card-icon-wrap"></div>
      <div id="card-title"></div>
      <div id="card-subtitle"></div>
      <div id="card-body"></div>
      <div id="card-quote"></div>
      <div id="card-npcs"></div>
      <div id="card-tags"></div>
      <div id="card-note"></div>
      <div id="card-ad"></div>
    </div>
  `;

  containerEl.appendChild(overlay);

  // ── Internal refs ──────────────────────────────────────────────────────────
  const iconWrap = overlay.querySelector("#card-icon-wrap");
  const titleEl = overlay.querySelector("#card-title");
  const subtitleEl = overlay.querySelector("#card-subtitle");
  const bodyEl = overlay.querySelector("#card-body");
  const quoteEl = overlay.querySelector("#card-quote");
  const npcsEl = overlay.querySelector("#card-npcs");
  const tagsEl = overlay.querySelector("#card-tags");
  const noteEl = overlay.querySelector("#card-note");
  const adEl = overlay.querySelector("#card-ad");
  const closeBtn = overlay.querySelector("#card-close");

  // SVG elements are cached by URL path — load once, clone on reuse
  const svgCache = {};
  let _isOpen = false;
  let _lastKey = null;

  // ── Close ──────────────────────────────────────────────────────────────────
  function close() {
    overlay.classList.remove("card-visible");
    overlay.setAttribute("aria-hidden", "true");
    _isOpen = false;
    _lastKey = null
  }

  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && _isOpen) close(); });

  // ── Open ───────────────────────────────────────────────────────────────────
  function open(cardData, hexKey) {

    // Toggle off if same hex clicked twice
    if (_isOpen && hexKey !== undefined && hexKey === _lastKey) { close(); return; }
    _lastKey = hexKey;

    // Title
    titleEl.textContent = cardData.title ?? "";

    // Subtitle
    subtitleEl.textContent = cardData.subtitle ?? "";
    subtitleEl.style.display = cardData.subtitle ? "block" : "none";

    // Icon — use loadSvg so CSS fills are baked in (fixes black icon bug)
    iconWrap.innerHTML = "";
    if (cardData.icon) {
      const _applyIcon = (svgEl) => {
        const clone = svgEl.cloneNode(true);
        clone.removeAttribute("style");   // ← strips any inline width/height from the SVG file
        clone.setAttribute("width", "72");
        clone.setAttribute("height", "72");
        iconWrap.appendChild(clone);
      };
      if (svgCache[cardData.icon]) {
        _applyIcon(svgCache[cardData.icon]);
      } else {
        loadSvg(cardData.icon)
          .then(svgEl => { svgCache[cardData.icon] = svgEl; _applyIcon(svgEl); })
          .catch(() => { });
      }
    }
    iconWrap.style.display = cardData.icon ? "flex" : "none";

    // Body
    bodyEl.innerHTML = cardData.body
      ? cardData.body.replace(/\n/g, "<br>")
      : "";
    bodyEl.style.display = cardData.body ? "block" : "none";

    // Quote
    quoteEl.innerHTML = cardData.quote
      ? cardData.quote.replace(/\n/g, "<br>")
      : "";
    quoteEl.style.display = cardData.quote ? "block" : "none";

    // NPCs
    npcsEl.innerHTML = "";
    if (cardData.npcs?.length) {
      cardData.npcs.forEach(npc => {
        const row = document.createElement("div");
        row.className = "card-npc-row";
        row.innerHTML =
          `<span class="card-npc-name">${npc.name}</span>` +
          ` · <span class="card-npc-desc">${npc.desc}</span>`;
        npcsEl.appendChild(row);
      });
    }
    npcsEl.style.display = cardData.npcs?.length ? "block" : "none";

    // Tags
    tagsEl.innerHTML = "";
    if (cardData.tags?.length) {
      cardData.tags.forEach(tag => {
        const pill = document.createElement("span");
        pill.className = "card-tag";
        pill.textContent = tag;
        tagsEl.appendChild(pill);
      });
    }
    tagsEl.style.display = cardData.tags?.length ? "flex" : "none";

    // Session note
    noteEl.innerHTML = cardData.note
      ? cardData.note.replace(/\n/g, "<br>")
      : "";
    noteEl.style.display = cardData.note ? "block" : "none";

    // Ad banner
    adEl.innerHTML = "";
    if (cardData.adId) {
      const ad = ADS.find(a => a.id === cardData.adId);
      if (ad) {
        const img = document.createElement("img");
        img.src = `${AD_IMAGE_PATH}${ad.bannerImage}`;
        img.className = "card-ad-banner";
        img.alt = ad.title ?? "Advertisement";
        img.addEventListener("click", () => {
          adOverlay?.open(cardData.adId, img);
        });
        adEl.appendChild(img);
      }
    }
    adEl.style.display = cardData.adId ? "block" : "none";

    // Show
    overlay.classList.add("card-visible");
    overlay.setAttribute("aria-hidden", "false");
    _isOpen = true;
  }

  function isOpen() { return _isOpen; }

  return { open, close, isOpen };
}

// ── CSS (injected once) ────────────────────────────────────────────────────
const CARD_CSS = `
#card-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 200;
  padding: 20px;
}

#card-overlay.card-visible {
  pointer-events: all;
  background: rgba(0,0,0,0.45);
}

#card-inner {
  position: relative;
  width: 100%;
  max-width: 420px;
  max-height: 80vh;
  overflow-y: auto;
  background: rgba(12, 22, 30, 0.92);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 16px;
  padding: 32px 28px 28px;
  box-shadow:
    0 0 0 1px rgba(255,255,255,0.04),
    0 20px 60px rgba(0,0,0,0.7),
    0 0 80px rgba(60,98,112,0.3);
  opacity: 0;
  transform: translateY(12px) scale(0.97);
  transition: opacity 220ms ease, transform 220ms ease;
  pointer-events: none;
}

#card-overlay.card-visible #card-inner {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: all;
}

#card-close {
  position: absolute;
  top: 14px; right: 16px;
  background: none;
  border: none;
  color: rgba(255,255,255,0.4);
  font-size: 16px;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
  line-height: 1;
  transition: color 150ms;
  font-family: inherit;
}
#card-close:hover { color: rgba(255,255,255,0.9); }

#card-icon-wrap {
  width: 100%;          /* full content width so ::before can span edge-to-edge */
  height: 72px;
  margin: 0 auto 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;   /* needed so ::before positions against this element */
}

/* Translucent gradient panel behind the icon.
   Adjust the four inset values to resize the panel:
     top    — how far it extends above the icon (negative = upward)
     left/right — how much wider than the icon on each side
     bottom — how far below the icon it extends
   Adjust the gradient stops to control opacity and where the fade starts.
   Adjust border-radius for how rounded the panel corners are. */
#card-icon-wrap::before {
  content: "";
  position: absolute;
  inset: -20px 0 -12px;
  border-radius: 12px;
  background: linear-gradient(
    to top,
    rgba(255, 255, 255, 0.10) 0%,
    rgba(255, 255, 255, 0.05) 50%,
    transparent              100%
  );
  pointer-events: none;
  z-index: 0;
}

#card-icon-wrap svg {
  width: 72px;
  height: 72px;
  position: relative;   /* keeps svg above the ::before layer */
  z-index: 1;
}

#card-title {
  font-family: "IM Fell English SC", serif;
  font-size: 28px;
  color: #e8d9b0;
  text-align: center;
  line-height: 1.2;
  letter-spacing: 0.02em;
}

#card-subtitle {
  font-size: 13px;
  color: rgba(255,255,255,0.4);
  text-align: center;
  margin-top: 4px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

#card-body {
  font-size: 17px;
  color: rgba(255,255,255,0.82);
  line-height: 1.65;
  margin-top: 18px;
}

#card-quote {
  font-size: 15px;
  color: rgba(232,217,176,0.65);
  font-style: italic;
  margin-top: 16px;
  padding-left: 16px;
  border-left: 2px solid rgba(232,217,176,0.25);
  line-height: 1.6;
}

#card-npcs {
  margin-top: 16px;
}

.card-npc-row {
  font-size: 14px;
  color: rgba(255,255,255,0.75);
  padding: 7px 0;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  line-height: 1.4;
}
.card-npc-row:last-child { border-bottom: none; }

.card-npc-name {
  font-weight: 600;
  color: rgba(255,255,255,0.92);
}
.card-npc-desc {
  color: rgba(255,255,255,0.5);
  font-style: italic;
}

#card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 16px;
}

.card-tag {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 3px 10px;
  border-radius: 20px;
  border: 1px solid rgba(255,255,255,0.18);
  color: rgba(255,255,255,0.5);
}

#card-note {
  margin-top: 18px;
  padding: 12px 14px;
  border-radius: 8px;
  background: rgba(255,255,255,0.05);
  border-left: 2px solid rgba(232,217,176,0.4);
  font-size: 15px;
  color: rgba(232,217,176,0.75);
  font-style: italic;
  line-height: 1.6;
}

#card-ad {
  margin-top: 20px;
}

.card-ad-banner {
  width: 100%;
  border-radius: 8px;
  display: block;
  cursor: pointer;
  opacity: 0.88;
  transition: opacity 150ms, transform 150ms;
}
.card-ad-banner:hover {
  opacity: 1;
  transform: scale(1.01);
}

@media (max-width: 600px) {
  #card-inner { padding: 24px 18px 20px; border-radius: 12px; }
  #card-title { font-size: 22px; }
}
`;

const _cardStyle = document.createElement("style");
_cardStyle.textContent = CARD_CSS;
document.head.appendChild(_cardStyle);