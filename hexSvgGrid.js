// hexSvgGrid.js version 02-23-02
// Focus: ONLY generating the SVG hex grid (polygons + optional icon text)
const NS = "http://www.w3.org/2000/svg";
function make(tag) {
  return document.createElementNS(NS, tag);
}
// --- geometry ---
export function makeHexMath({ COLS, ROWS, SIZE, PAD }) {
  const HEX_H = Math.sqrt(3) * SIZE;
  const DX = 1.5 * SIZE;
  const DY = HEX_H;

  function center(c, r) {
    const x = PAD + SIZE + c * DX;
    const y = PAD + (HEX_H / 2) + r * DY + ((c & 1) ? (DY / 2) : 0);
    return { x, y };
  }

  function points(cx, cy) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i);
      pts.push([cx + SIZE * Math.cos(a), cy + SIZE * Math.sin(a)]);
    }
    return pts.map(p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ");
  }

  function computeBounds() {
    let maxX = 0, maxY = 0;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const { x, y } = center(c, r);
      maxX = Math.max(maxX, x + SIZE);
      maxY = Math.max(maxY, y + (HEX_H / 2));
    }
    return { w: Math.ceil(maxX + PAD), h: Math.ceil(maxY + PAD) };
  }

  return { HEX_H, DX, DY, center, points, computeBounds };
}

// --- grid build ---
export function buildHexSvgGrid({
  svg,
  COLS,
  ROWS,
  center,
  points,
  computeBounds,
  // hooks (you plug in your existing logic)
  setVisual,          // (poly, c, r) -> void
  onClickHex,         // (c, r, poly) -> void
  onEnterHex,         // (c, r, poly) -> void (optional)
  onLeaveHex,         // (c, r, poly) -> void (optional)
  makeIconText = true // create the <text> nodes and attach poly._hexIcon
}) {
  // 1) size svg to fit the world
  const { w, h } = computeBounds();
  svg.setAttribute("width", w);
  svg.setAttribute("height", h);
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);

  // 2) clear old grid
  svg.innerHTML = "";

  // 3) build new grid
  const polyByKey = new Map(); // key "c,r" -> polygon
  let count = 0;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const { x, y } = center(c, r);

      const poly = make("polygon");
      poly.setAttribute("points", points(x, y));

      let hexIcon = null;
      if (makeIconText) {
        hexIcon = make("text");
        hexIcon.textContent = "";
        hexIcon.setAttribute("x", x);
        hexIcon.setAttribute("y", y);
        hexIcon.setAttribute("text-anchor", "middle");
        hexIcon.setAttribute("dominant-baseline", "central");
        hexIcon.setAttribute("font-size", "18");
        hexIcon.setAttribute("fill", "#000");
        hexIcon.style.pointerEvents = "none";
        hexIcon.style.userSelect = "none";
        hexIcon.style.display = "none";

        // link poly -> its text node (same idea you’re using now)
        poly._hexIcon = hexIcon;
      }

      // apply your existing appearance rules
      setVisual(poly, c, r);

      // listeners (optional hover hooks)
      if (onEnterHex) poly.addEventListener("mouseenter", () => onEnterHex(c, r, poly));
      if (onLeaveHex) poly.addEventListener("mouseleave", () => onLeaveHex(c, r, poly));

      // click hook (required)
      poly.addEventListener("click", () => onClickHex(c, r, poly));

      svg.appendChild(poly);
      if (hexIcon) svg.appendChild(hexIcon);

      polyByKey.set(`${c},${r}`, poly);
      count++;
    }
  }

  return { w, h, count, polyByKey };
}