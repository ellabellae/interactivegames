// @ts-check
// Gesture detection with no DOM access. Each function takes plain numbers
// (points in screen px, times in seconds) and returns plain results, so it
// can be unit-tested with recorded or synthetic hand paths.
//
// The logic is lifted from the prototypes in legacy/ and kept behaviourally
// identical under the standard profile; only the thresholds moved to settings.

/**
 * @typedef {{ x: number, y: number }} Point
 * @typedef {{ x: number, y: number, r: number }} Target  centre and hit radius in px
 */

/** @param {Point | null | undefined} pt @param {Target | null | undefined} target */
export const isNear = (pt, target) => !!pt && !!target && Math.hypot(pt.x - target.x, pt.y - target.y) < target.r;

// ---------------------------------------------------------------- pinch

/**
 * Pinch state with hysteresis and a hold filter.
 * From legacy/brick-race.html and kitchen-race.html frame().
 * @param {{ on: number, off: number, holdFrames: number }} cfg
 */
export function createPinch(cfg) {
  let down = false, frames = 0;
  return {
    /**
     * Feed one video frame's normalised pinch distance.
     * @param {number} dist
     * @returns {{ down: boolean, pressed: boolean, released: boolean }}
     */
    update(dist) {
      const was = down;
      const want = down ? dist < cfg.off : dist < cfg.on;
      frames = want ? frames + 1 : 0;
      if (!down && frames >= cfg.holdFrames) down = true;
      if (down && !want) down = false;
      return { down, pressed: down && !was, released: !down && was };
    },
    get down() { return down; },
    reset() { down = false; frames = 0; },
  };
}

// ---------------------------------------------------------------- cursor

/**
 * Exponential smoothing of the cursor, applied once per video frame.
 * @param {{ smoothing: number }} cfg
 */
export function createCursor(cfg) {
  /** @type {Point | null} */
  let s = null;
  return {
    /** @param {Point} pt @returns {Point} */
    update(pt) {
      s = s ? { x: s.x + (pt.x - s.x) * cfg.smoothing, y: s.y + (pt.y - s.y) * cfg.smoothing } : { x: pt.x, y: pt.y };
      return s;
    },
    get value() { return s; },
    reset() { s = null; },
  };
}
