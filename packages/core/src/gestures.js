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

// ---------------------------------------------------------------- detectors
//
// Every detector has the same shape:
//   update(pt, target, dt) -> number of counts this frame (0 or 1)
//     pt      smoothed cursor in px, or null when there is no input
//     target  { x, y, r } the gesture must happen over
//     dt      seconds since the previous call (render frame, clamped)
//   progress() -> 0..1 toward the next count (for meters)
//   reset()    -> forget everything (new step, hand lost)

/**
 * @typedef {object} Detector
 * @property {(pt: Point | null, target: Target | null, dt: number) => number} update
 * @property {() => number} progress
 * @property {() => void} reset
 */

/**
 * Stir: circles over the target. Counts once per `turnsPerCount` full turns
 * of accumulated angle. Leaving the target pauses without losing progress.
 * From legacy/kitchen-race.html, case "stir".
 * @param {{ turnsPerCount: number }} cfg
 * @returns {Detector}
 */
export function createStir(cfg) {
  /** @type {number | null} */
  let lastAng = null;
  let acc = 0;
  const need = () => 2 * Math.PI * cfg.turnsPerCount;
  return {
    update(pt, target) {
      if (!pt || !target || !isNear(pt, target)) { lastAng = null; return 0; }
      const ang = Math.atan2(pt.y - target.y, pt.x - target.x);
      let n = 0;
      if (lastAng != null) {
        let d = ang - lastAng;
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        acc += Math.abs(d);
        if (acc > need()) { acc = 0; n = 1; }
      }
      lastAng = ang;
      return n;
    },
    progress: () => Math.min(1, acc / need()),
    reset() { lastAng = null; acc = 0; },
  };
}

/**
 * Reversal counter shared by chop (vertical) and shake (horizontal): a count
 * happens when the direction of travel flips after moving more than
 * `travelPx` since the last counted turning point.
 * @param {"x" | "y"} axis
 * @param {number} travelPx
 * @param {(dir: number) => boolean} countsOn which new direction scores (chop: only downward)
 */
function createReversal(axis, travelPx, countsOn) {
  /** @type {number | null} */ let prev = null;
  /** @type {number | null} */ let ext = null;
  let dir = 0;
  return {
    /** @param {Point | null} pt  null ends the current stroke */
    update(pt) {
      if (!pt) { prev = null; return 0; }
      const v = pt[axis];
      let n = 0;
      if (prev != null) {
        const d = Math.sign(v - prev);
        if (d && dir && d !== dir && Math.abs(v - (ext ?? v)) > travelPx) { ext = v; if (countsOn(d)) n = 1; }
        if (d) dir = d;
        if (ext == null) ext = v;
      }
      prev = v;
      return n;
    },
    reset() { prev = null; ext = null; dir = 0; },
  };
}

/**
 * Chop: up-and-down over the target. Counts on the turn from rising to
 * falling (screen y increasing) after more than `travelPx` of travel.
 * From legacy/kitchen-race.html, case "chop".
 * @param {{ travelPx: number }} cfg
 * @returns {Detector}
 */
export function createChop(cfg) {
  const rev = createReversal("y", cfg.travelPx, (d) => d > 0);
  return {
    update: (pt, target) => rev.update(pt && target && isNear(pt, target) ? pt : null),
    progress: () => 0,
    reset: () => rev.reset(),
  };
}

/**
 * Flick: a fast upward move that starts over the target. Counts when upward
 * speed exceeds minSpeedPxPerS, then waits cooldownS before the next.
 * From legacy/kitchen-race.html, case "flick".
 *
 * Speed is measured per render frame (dt), as in the original. The cursor
 * only moves when a new video frame arrives, so on a 60 fps screen with a
 * 30 fps camera the measured speed is roughly double the real hand speed.
 * The 1100 px/s threshold was tuned with that behaviour, so it is kept.
 * @param {{ minSpeedPxPerS: number, cooldownS: number }} cfg
 * @returns {Detector}
 */
export function createFlick(cfg) {
  /** @type {number | null} */ let prevY = null;
  let cool = 0;
  return {
    update(pt, target, dt) {
      if (!pt) { prevY = null; return 0; }
      let n = 0;
      if (prevY != null && dt > 0) {
        const vy = (prevY - pt.y) / dt;
        cool = Math.max(0, cool - dt);
        if (vy > cfg.minSpeedPxPerS && cool === 0 && isNear({ x: pt.x, y: prevY }, target)) { cool = cfg.cooldownS; n = 1; }
      }
      prevY = pt.y;
      return n;
    },
    progress: () => 0,
    reset() { prevY = null; cool = 0; },
  };
}

/**
 * Shake: side to side over the target while holding something. Counts on
 * every direction change after more than travelPx of horizontal travel.
 * The caller passes pt = null whenever nothing is held.
 * From legacy/kitchen-race.html, case "shake" (same turning-point quirk as chop).
 * @param {{ travelPx: number }} cfg
 * @returns {Detector}
 */
export function createShake(cfg) {
  const rev = createReversal("x", cfg.travelPx, () => true);
  return {
    update: (pt, target) => rev.update(pt && target && isNear(pt, target) ? pt : null),
    progress: () => 0,
    reset: () => rev.reset(),
  };
}

/** @typedef {"stir" | "chop" | "flick" | "shake"} GestureKind */

/**
 * Build a detector by name from the profile's gesture settings.
 * @param {GestureKind} kind
 * @param {import("./settings.js").Settings["gestures"]} gestures
 * @returns {Detector}
 */
export function createDetector(kind, gestures) {
  switch (kind) {
    case "stir": return createStir(gestures.stir);
    case "chop": return createChop(gestures.chop);
    case "flick": return createFlick(gestures.flick);
    case "shake": return createShake(gestures.shake);
    default: throw new Error(`Unknown gesture kind: ${kind}`);
  }
}
