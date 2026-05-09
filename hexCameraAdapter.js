// hexCameraAdapter.js
// Hex-specific “glue” that converts {c,r} routes into {x,y} routes for createViewBoxCamera(...)

/**
 * makeHexToXY(centerFn)
 * Goal: given your existing center(c,r) function, return a converter (c,r)->{x,y}
 *
 * centerFn MUST be a function like:
 *   function center(c,r){ return {x:..., y:...}; }
 */
export function makeHexToXY(centerFn) {
  return function hexToXY(c, r) {
    const { x, y } = centerFn(c, r);
    return { x, y };
  };
}

/**
 * hexPathToXY(path, centerFn)
 * Goal: take a path in hex coords and convert it to pixel coords for the camera module.
 *
 * Input path item shapes supported:
 *   { c:12, r:8, pauseMs?:300 }
 *   { c:12, r:8, pauseMs?:300, meta?: any }   // meta is carried through (optional)
 *
 * Output:
 *   { x:..., y:..., pauseMs?:..., meta?:... }
 */
export function hexPathToXY(path, centerFn) {
  return path.map((step) => {
    const { x, y } = centerFn(step.c, step.r);
    const out = { x, y };

    // carry optional fields through
    if (step.pauseMs != null) out.pauseMs = step.pauseMs;
    if (step.meta != null) out.meta = step.meta;

    return out;
  });
}

/**
 * Optional convenience: run a hex path directly
 * (keeps your app code super clean)
 *
 * camera should be the object returned by createViewBoxCamera(svg)
 */
export async function runHexPath(camera, hexPath, centerFn, opts = {}) {
  const xyPath = hexPathToXY(hexPath, centerFn);
  await camera.runPath(xyPath, opts);
}