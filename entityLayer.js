// entityLayer.js
// Single responsibility: render named entities (locations) onto the SVG.
//
// Takes the raw entities array + the hex center() function and stamps:
//   - an SVG icon (loaded from file, scaled + positioned)
//   - a text label
//   - a curved pointer line from hex center → label
//
// Returns the mutated entities array (each entry gets _icon, _label, _line
// attached so the camera fade system in app.js can reach them).
//
// Nothing here knows about clicks, cards, or camera — that's app.js's job.

const NS = "http://www.w3.org/2000/svg";

// ─── Defaults ────────────────────────────────────────────────────────────────
const POINTER_DEFAULTS = {
  enabled: true,
  curve: true,
  curveBend: 10,
  arrow: true,
  style: {
    color: "white",
    width: 1.5,
    dash: null,
    opacity: 1,
  },
  anchor: {
    from: "center",
    to: "label",
    nudge: { x: 0, y: 0 },
  },
};

const OFFSET_DEFAULT = { x: -40, y: -40 };

// ─── SVG file loader ──────────────────────────────────────────────────────────
// Fetches an SVG file, bakes any CSS fill rules into attributes so the SVG
// renders correctly when inlined, then returns the root <svg> element.
export async function loadSvg(url) {
  const res = await fetch(url);
  const text = await res.text();

  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "image/svg+xml");
  const svgEl = doc.documentElement;

  // Bake all CSS class presentation properties → inline attributes.
  // Handles fill, stroke, stroke-width, stroke-miterlimit, opacity etc.
  // so SVGs with Illustrator-style .cls-N classes render correctly when inlined.
  const styleEl = svgEl.querySelector("style");
  if (styleEl) {
    const PROPS = [
      "fill", "stroke", "stroke-width", "stroke-miterlimit",
      "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity", "clip-path"
    ];

    // Match each full CSS rule block: "selector, selector { declarations }"
    const ruleRegex = /([^{]+)\{([^}]+)\}/g;
    for (const [, selectorGroup, declarations] of styleEl.textContent.matchAll(ruleRegex)) {

      // Extract all relevant property:value pairs from this rule
      const props = {};
      for (const prop of PROPS) {
        // \b prevents matching stroke when looking for stroke-width etc.
        const propRegex = new RegExp(`\\b${prop}\\s*:\\s*([^;}\n]+)`);
        const match = declarations.match(propRegex);
        if (match) props[prop] = match[1].trim();
      }
      if (Object.keys(props).length === 0) continue;

      // Apply to every element matching each selector in the group
      for (let selector of selectorGroup.split(",")) {
        selector = selector.trim();
        if (!selector.startsWith(".")) continue;
        svgEl.querySelectorAll(selector).forEach(el => {
          for (const [prop, value] of Object.entries(props)) {
            el.setAttribute(prop, value);
          }
        });
      }
    }

    // Classes are now redundant — remove them to keep the DOM clean
    svgEl.querySelectorAll("[class]").forEach(el => el.removeAttribute("class"));
  }

  // Any shape without a fill gets currentColor so parent <g> can control it
  svgEl.querySelectorAll("path, polygon, circle, rect, ellipse, polyline").forEach(el => {
    if (!el.hasAttribute("fill")) el.setAttribute("fill", "currentColor");
  });

  return svgEl;
}

// ─── Main render function ─────────────────────────────────────────────────────
// Call once after buildGrid(). Appends icon groups, labels, and pointer lines
// directly to the root SVG element.
export async function renderEntityLayer(svg, entities, centerFn) {

  // Ensure the arrowhead marker exists in <defs>
  _ensureSilhouetteFilter(svg);
  _ensureArrowDef(svg);

  // Load all SVG icons in parallel
  await Promise.all(
    entities.map(async entity => {
      if (entity.icon) entity._svg = await loadSvg(entity.icon);
    })
  );

  for (const entity of entities) {
    const [c, r] = entity.hex.split(",").map(Number);
    const { x, y } = centerFn(c, r);

    const offset = entity.offset ?? OFFSET_DEFAULT;
    const labelX = x + offset.x;
    const labelY = y + offset.y;

    // ── Icon ──────────────────────────────────────────────────────────────────
    let iconGroup = null;

    if (entity._svg) {
      const clone = entity._svg.cloneNode(true);
      const SIZE = 20;
      const vb = clone.viewBox.baseVal;
      const scale = SIZE / vb.width;

      // Temporarily add content to DOM to measure actual visual bounds
      const tempG = document.createElementNS(NS, "g");
      Array.from(clone.childNodes).forEach(child => {
        tempG.appendChild(child.cloneNode(true));
      });
      svg.appendChild(tempG);
      const bbox = tempG.getBBox();
      svg.removeChild(tempG);

      // Center based on actual content bounds, not viewBox
      const vbOffX = -(bbox.x + bbox.width / 2);
      const vbOffY = -(bbox.y + bbox.height / 2);

      // ── Shadow group — same content, silhouette filter, rendered below icon
      const shadowClone = entity._svg.cloneNode(true);
      const shadowG = document.createElementNS(NS, "g");
      shadowG.setAttribute("filter", "url(#icon-silhouette)");
      shadowG.setAttribute("opacity", "0");
      shadowG.style.pointerEvents = "none";
      Array.from(shadowClone.childNodes).forEach(child => {
        shadowG.appendChild(child.cloneNode(true));
      });
      svg.appendChild(shadowG);

      // ── Icon group — on top of shadow
      const g = document.createElementNS(NS, "g");
      g.setAttribute(
        "transform",
        `translate(${x}, ${y}) scale(${scale}) translate(${vbOffX}, ${vbOffY})`
      );
      g.setAttribute("opacity", "0");
      g.style.pointerEvents = "none";

      Array.from(clone.childNodes).forEach(child => {
        g.appendChild(child);
      });

      // Gold hover effect
      g.addEventListener("mouseenter", () => {
        g.querySelectorAll("[fill]").forEach(el => {
          el._originalFill = el.getAttribute("fill");
          el.setAttribute("fill", "gold");
        });
      });
      g.addEventListener("mouseleave", () => {
        g.querySelectorAll("[fill]").forEach(el => {
          if (el._originalFill) el.setAttribute("fill", el._originalFill);
        });
      });

      svg.appendChild(g);
      iconGroup = g;

      // Store positioning data for shadow frame updates in app.js
      entity._shadow = shadowG;
      entity._mapX = x;
      entity._mapY = y;
      entity._iconScale = scale;
      entity._vbOffX = vbOffX;
      entity._vbOffY = vbOffY;
      entity._vbH = vb.height;

      // Compute anchor mathematically — getBBox() is unreliable before layout
      // Anchor = bottom center of icon in map coordinate space
      entity._shadowAnchorX = x;
      entity._shadowAnchorY = y + scale * vb.height / 2;
    }

    // ── Label ─────────────────────────────────────────────────────────────────
    const label = document.createElementNS(NS, "text");
    label.textContent = entity.name;
    label.setAttribute("x", labelX);
    label.setAttribute("y", labelY);
    label.setAttribute("fill", "white");
    label.setAttribute("font-size", "24");
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "middle");
    label.setAttribute("opacity", "0");
    label.style.pointerEvents = "none";
    label.style.userSelect = "none";
    svg.appendChild(label);

    const labelBox = label.getBBox();

    // ── Pointer line ──────────────────────────────────────────────────────────
    const pointer = {
      ...POINTER_DEFAULTS,
      ...(entity.pointer || {}),
      style: { ...POINTER_DEFAULTS.style, ...(entity.pointer?.style || {}) },
      anchor: { ...POINTER_DEFAULTS.anchor, ...(entity.pointer?.anchor || {}) },
    };

    let line = null;

    if (pointer.enabled) {
      const { x: nx = 0, y: ny = 0 } = pointer.anchor.nudge;

      const dx = (labelX + nx) - x;
      const dy = (labelY + ny) - y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;

      // Walk back from label center to label edge.
      // LABEL_PAD trims the standoff so the line ends closer to the visible
      // text — getBBox() includes descender space below the baseline which
      // creates a visual gap between arrow tip and the bottom of the letters.
      // Increase this number to close the gap further; decrease to add space.
      const LABEL_PAD = 6;
      const sx = Math.abs(ux) > 0.0001 ? (labelBox.width  / 2 - LABEL_PAD) / Math.abs(ux) : Infinity;
      const sy = Math.abs(uy) > 0.0001 ? (labelBox.height / 2 - LABEL_PAD) / Math.abs(uy) : Infinity;
      const s = Math.min(sx, sy);

      const x2 = labelX + nx - ux * s;
      const y2 = labelY + ny - uy * s;

      if (pointer.curve) {
        line = document.createElementNS(NS, "path");
        const bend = pointer.curveBend ?? POINTER_DEFAULTS.curveBend;
        const len2 = Math.hypot(x2 - x, y2 - y) || 1;
        const px = -(y2 - y) / len2;
        const py = (x2 - x) / len2;
        const mx = (x + x2) / 2 + px * bend;
        const my = (y + y2) / 2 + py * bend;
        line.setAttribute("d", `M ${x} ${y} Q ${mx} ${my} ${x2} ${y2}`);
        line.setAttribute("fill", "none");
      } else {
        line = document.createElementNS(NS, "line");
        line.setAttribute("x1", x); line.setAttribute("y1", y);
        line.setAttribute("x2", x2); line.setAttribute("y2", y2);
      }

      line.setAttribute("stroke", pointer.style.color);
      line.setAttribute("stroke-width", pointer.style.width);
      if (pointer.style.dash) line.setAttribute("stroke-dasharray", pointer.style.dash);
      line.setAttribute("opacity", "0");
      line.setAttribute("pointer-events", "none");
      if (pointer.arrow) line.setAttribute("marker-start", "url(#arrow)");

      svg.appendChild(line);
      svg.appendChild(label); // label on top of line
    }

    // Store references for the camera fade system
    entity._icon  = iconGroup;
    entity._label = label;
    entity._line  = line;
  }

  return entities;
}

// ─── Private helpers ──────────────────────────────────────────────────────────
function _ensureArrowDef(svg) {
  if (svg.querySelector("#arrow")) return;

  const defs   = document.createElementNS(NS, "defs");
  const marker = document.createElementNS(NS, "marker");
  marker.setAttribute("id", "arrow");
  marker.setAttribute("viewBox", "0 0 6 6");
  marker.setAttribute("markerWidth", "6");
  marker.setAttribute("markerHeight", "6");
  marker.setAttribute("refX", "5");
  marker.setAttribute("refY", "3");
  marker.setAttribute("orient", "auto-start-reverse");
  marker.setAttribute("markerUnits", "strokeWidth");

  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", "M0,0 L6,3 L0,6 Z");
  path.setAttribute("fill", "white");

  marker.appendChild(path);
  defs.appendChild(marker);
  svg.appendChild(defs);
}

function _ensureSilhouetteFilter(svg) {
  if (svg.querySelector("#icon-silhouette")) return;

  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = document.createElementNS(NS, "defs");
    svg.prepend(defs);
  }

  const filter = document.createElementNS(NS, "filter");
  filter.setAttribute("id", "icon-silhouette");
  filter.setAttribute("x", "-50%");
  filter.setAttribute("y", "-50%");
  filter.setAttribute("width", "200%");
  filter.setAttribute("height", "200%");
  filter.setAttribute("color-interpolation-filters", "sRGB");

  // Flood with shadow color, then clip to the icon's alpha channel
  const flood = document.createElementNS(NS, "feFlood");
  flood.setAttribute("flood-color", "rgba(0,0,0,0.85)");
  flood.setAttribute("flood-opacity", "1");
  flood.setAttribute("result", "color");

  const composite = document.createElementNS(NS, "feComposite");
  composite.setAttribute("in", "color");
  composite.setAttribute("in2", "SourceAlpha");
  composite.setAttribute("operator", "in");

  filter.appendChild(flood);
  filter.appendChild(composite);
  defs.appendChild(filter);
}