// helmetLayer.js
// Renders the helmet SVG marker for land traversal segments of the journey.
//
// The helmet appears at the shore (midpoint of last-sea / first-land hex pair),
// moves through all land hexes honoring waypoint pauses, then fades out at
// the return shore when the path re-enters sea.
//
// This module handles rendering and position only.
// All sequencing is driven by shipMovement.js.

import { loadSvg } from "./entityLayer.js";

const NS = "http://www.w3.org/2000/svg";

// Display constants -- tune these to adjust rendered size
const HELMET = {
  asset: "images/helmet.svg",
  size:  10,    // rendered diameter in map units (same scale as entity icons)
};

export async function createHelmetLayer(svg) {

  const svgEl = await loadSvg(HELMET.asset);
  const vb    = svgEl.viewBox.baseVal;
  const scale = HELMET.size / Math.max(vb.width, vb.height);

  const group = document.createElementNS(NS, "g");
  group.setAttribute("id",             "helmetLayer");
  group.setAttribute("opacity",        "0");       // hidden until first fade-in
  group.setAttribute("pointer-events", "none");

  // Clone SVG content into the group.
  // Strip any injected <style> blocks so they don't conflict with the page.
  Array.from(svgEl.childNodes).forEach(child => {
    const clone = child.cloneNode(true);
    if (clone.nodeName === "defs") {
      clone.querySelectorAll("style").forEach(s => s.remove());
    }
    group.appendChild(clone);
  });

  svg.appendChild(group);

  let _x   = 0;
  let _y   = 0;
  let _deg = 0;

  // Build the SVG transform that centers the helmet at (_x, _y) and rotates it.
  // Order (applied right-to-left in SVG):
  //   1. translate(-w/2, -h/2)  -- center SVG content around its own origin
  //   2. scale(s)               -- scale to map units
  //   3. translate(x, y)        -- move to map position
  //   4. rotate(deg, x, y)      -- rotate around that map position
  function _applyTransform() {
    group.setAttribute("transform",
      "rotate("    + _deg.toFixed(2) + ", " + _x.toFixed(2) + ", " + _y.toFixed(2) + ") " +
      "translate(" + _x.toFixed(2)   + ", " + _y.toFixed(2) + ") " +
      "scale("     + scale.toFixed(4) + ") " +
      "translate(" + (-vb.width  / 2).toFixed(2) + ", " +
                     (-vb.height / 2).toFixed(2) + ")"
    );
  }

  function setPosition(x, y) {
    _x = x;
    _y = y;
    _applyTransform();
  }

  function setHeading(deg) {
    _deg = deg;
    _applyTransform();
  }

  // Fade from transparent to fully opaque over ms milliseconds.
  function fadeIn(ms) {
    return new Promise(resolve => {
      const start = performance.now();
      function step(now) {
        const t = Math.min(1, (now - start) / ms);
        group.setAttribute("opacity", t.toFixed(3));
        if (t < 1) requestAnimationFrame(step); else resolve();
      }
      requestAnimationFrame(step);
    });
  }

  // Fade from fully opaque to transparent over ms milliseconds.
  function fadeOut(ms) {
    return new Promise(resolve => {
      const start = performance.now();
      function step(now) {
        const t = Math.min(1, (now - start) / ms);
        group.setAttribute("opacity", (1 - t).toFixed(3));
        if (t < 1) requestAnimationFrame(step); else resolve();
      }
      requestAnimationFrame(step);
    });
  }

  // Expose group so app.js can manage z-order (insertBefore shipLayer).
  return { group, setPosition, setHeading, fadeIn, fadeOut };
}
