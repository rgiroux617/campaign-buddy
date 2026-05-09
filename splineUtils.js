// splineUtils.js
// Arc-length parameterized Catmull-Rom spline math.
//
// Used by shipMovement.js to animate the ship along a hand-drawn curve.
//
// The Catmull-Rom → Bezier formula here uses the same ghost-point padding as
// lineLayer.js, so the animation path follows the drawn visual exactly.
//
// "Arc-length parameterized" means: equal time increments = equal distance
// traveled along the curve. Without this the ship would rush through
// widely-spaced control points and creep through tightly-spaced ones.
//
// Exports:
//   buildSpline(points)          — call once per path segment; returns a spline object
//   sampleSpline(spline, arcLen) — returns { x, y, headingDeg } at that arc length

// ── Tuning ────────────────────────────────────────────────────────────────────
const SAMPLES_PER_SEGMENT = 30; // arc-length table resolution per Bezier segment
                                  // raise to 50+ for very tight hairpin curves

// ── Private Bezier helpers ────────────────────────────────────────────────────

// Point on a cubic Bezier at parameter t ∈ [0, 1].
// P0 = segment start, P1 = cp1, P2 = cp2, P3 = segment end.
function _bezierPoint(P0, P1, P2, P3, t) {
  const u = 1 - t;
  return {
    x: u*u*u*P0.x + 3*u*u*t*P1.x + 3*u*t*t*P2.x + t*t*t*P3.x,
    y: u*u*u*P0.y + 3*u*u*t*P1.y + 3*u*t*t*P2.y + t*t*t*P3.y,
  };
}

// Tangent vector on a cubic Bezier at t (un-normalized {dx, dy}).
function _bezierTangent(P0, P1, P2, P3, t) {
  const u = 1 - t;
  return {
    dx: 3*(u*u*(P1.x-P0.x) + 2*u*t*(P2.x-P1.x) + t*t*(P3.x-P2.x)),
    dy: 3*(u*u*(P1.y-P0.y) + 2*u*t*(P2.y-P1.y) + t*t*(P3.y-P2.y)),
  };
}

// Convert a 2D direction vector to a compass heading in degrees.
// 0° = north / up, 90° = east / right, 180° = south / down.
// +180° offset because the ship SVG faces south by default.
function _tangentToHeading(dx, dy) {
  return Math.atan2(dx, -dy) * (180 / Math.PI) + 180;
}

// Convert four neighboring Catmull-Rom points into cubic Bezier control points.
// Identical formula to lineLayer.js — keeps drawn and animated paths in sync.
function _catmullCPs(p0, p1, p2, p3) {
  return {
    cp1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
    cp2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
  };
}

// ── Public: buildSpline ───────────────────────────────────────────────────────

/**
 * buildSpline(points)
 *
 * Converts an array of {x, y} control points into a spline object.
 * The curve passes exactly through every point (Catmull-Rom interpolation).
 *
 * Points may carry extra metadata — buildSpline just passes them through
 * untouched so shipMovement.js can read dock / speedMult / pauseMs etc.
 *
 * Returns null if fewer than 2 points are provided.
 *
 * Returned object shape:
 *   totalLength   — total arc length in SVG map units
 *   table         — arc-length lookup table (used internally by sampleSpline)
 *   segments      — Bezier segment data (used internally by sampleSpline)
 *   pointArcLens  — arc length at each original control point [0..n]
 *   points        — the original points array (unchanged reference)
 */
export function buildSpline(points) {
  if (!points || points.length < 2) return null;

  // Ghost-pad: duplicate first and last so the curve begins and ends
  // precisely at the outermost control points (no undershoot).
  const p           = [points[0], ...points, points[points.length - 1]];
  const numSegments = points.length - 1;

  // Convert every Catmull-Rom quad to a cubic Bezier segment.
  const segments = [];
  for (let i = 0; i < numSegments; i++) {
    const { cp1, cp2 } = _catmullCPs(p[i], p[i + 1], p[i + 2], p[i + 3]);
    segments.push({ start: p[i + 1], cp1, cp2, end: p[i + 2] });
  }

  // Sample each segment at SAMPLES_PER_SEGMENT evenly-spaced t values,
  // accumulating arc length. This is the lookup table sampleSpline() uses
  // to convert "how far along?" into "where exactly?".
  const table     = [];
  let totalLength = 0;
  let prevX       = segments[0].start.x;
  let prevY       = segments[0].start.y;

  // First entry — the very start of the curve
  table.push({ x: prevX, y: prevY, arcLen: 0, segIdx: 0, segT: 0 });

  for (let seg = 0; seg < numSegments; seg++) {
    const { start, cp1, cp2, end } = segments[seg];
    for (let s = 1; s <= SAMPLES_PER_SEGMENT; s++) {
      const t        = s / SAMPLES_PER_SEGMENT;
      const { x, y } = _bezierPoint(start, cp1, cp2, end, t);
      totalLength   += Math.hypot(x - prevX, y - prevY);
      table.push({ x, y, arcLen: totalLength, segIdx: seg, segT: t });
      prevX = x;
      prevY = y;
    }
  }

  // pointArcLens[i] = the arc length when the ship is exactly at points[i].
  // The end of Bezier segment i lands at table index (i+1)*SAMPLES_PER_SEGMENT.
  // shipMovement.js uses this to detect when the ship reaches a dock point.
  const pointArcLens = new Array(points.length);
  pointArcLens[0] = 0;
  for (let i = 0; i < numSegments; i++) {
    pointArcLens[i + 1] = table[(i + 1) * SAMPLES_PER_SEGMENT].arcLen;
  }

  return { totalLength, table, pointArcLens, segments, points };
}

// ── Public: sampleSpline ──────────────────────────────────────────────────────

/**
 * sampleSpline(spline, arcLen)
 *
 * Returns { x, y, headingDeg } at the requested arc length.
 * arcLen is clamped to [0, spline.totalLength] automatically.
 *
 * headingDeg is derived from the Bezier tangent at that exact point,
 * so the ship faces the direction the curve is traveling — no separate
 * heading calculation needed in the caller.
 */
export function sampleSpline(spline, arcLen) {
  const { table, segments, totalLength } = spline;

  const clamped = Math.max(0, Math.min(totalLength, arcLen));

  // Binary search: find the two table entries that bracket this arc length.
  let lo = 0, hi = table.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid].arcLen <= clamped) lo = mid;
    else hi = mid;
  }

  const a    = table[lo];
  const b    = table[hi];
  const span = b.arcLen - a.arcLen;
  const frac = span > 0 ? (clamped - a.arcLen) / span : 0;

  // Interpolated position
  const x = a.x + (b.x - a.x) * frac;
  const y = a.y + (b.y - a.y) * frac;

  // Heading from the Bezier tangent.
  // When lo and hi happen to straddle a segment boundary, pick whichever
  // side is closer rather than interpolating across the boundary.
  const crossBoundary = a.segIdx !== b.segIdx;
  const segIdx = crossBoundary ? (frac < 0.5 ? a.segIdx : b.segIdx) : a.segIdx;
  const segT   = crossBoundary
    ? (frac < 0.5 ? a.segT : b.segT)
    : a.segT + (b.segT - a.segT) * frac;

  const { start, cp1, cp2, end } = segments[segIdx];
  const { dx, dy }               = _bezierTangent(start, cp1, cp2, end, segT);

  // If the tangent is degenerate (two overlapping control points), fall back
  // to the chord direction between the bracketing table entries.
  const headingDeg = Math.hypot(dx, dy) > 0.001
    ? _tangentToHeading(dx, dy)
    : _tangentToHeading(b.x - a.x, b.y - a.y);

  return { x, y, headingDeg };
}
