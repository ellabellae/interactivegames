// @ts-check
import { describe, expect, it } from "vitest";
import { createChop, createDetector, createFlick, createShake, createStir } from "./gestures.js";
import { STANDARD } from "./settings.js";
import { legacyKitchen } from "../test/legacy-kitchen-oracle.js";
import { atVideoRate, circles, oscillate, randomWalk, sweep } from "../test/paths.js";

const TARGET = { x: 200, y: 200, r: 90 };
const G = STANDARD.gestures;

/**
 * Feed a path to a detector and return the frame-by-frame counts.
 * @param {import("./gestures.js").Detector} det
 * @param {{ pt: {x:number,y:number} | null, dt: number }[]} path
 */
const feed = (det, path, target = TARGET) => path.map((f) => det.update(f.pt, target, f.dt));
/** Same for the legacy oracle. */
const feedLegacy = (/** @type {string} */ kind, /** @type {any[]} */ path, target = TARGET, held = true) => {
  const step = legacyKitchen();
  return path.map((f) => step(kind, f.pt, target, f.dt, held));
};
const sum = (/** @type {number[]} */ a) => a.reduce((s, x) => s + x, 0);

/** Paths every detector is checked on against the legacy code. */
const PARITY_PATHS = {
  "circles r40": circles({ r: 40, turns: 5 }),
  "circles r80 slow": circles({ r: 80, turns: 3, framesPerTurn: 120 }),
  "circles leaving target": circles({ r: 110, turns: 3 }),
  "oscillate y amp 20": oscillate({ axis: "y", amp: 20, cycles: 10 }),
  "oscillate y amp 8": oscillate({ axis: "y", amp: 8, cycles: 10 }),
  "oscillate x amp 12": oscillate({ axis: "x", amp: 12, cycles: 10 }),
  "oscillate x amp 5": oscillate({ axis: "x", amp: 5, cycles: 10 }),
  "fast sweep up": sweep({ frames: 4 }),
  "slow sweep up": sweep({ frames: 40 }),
  "sweep at video rate": atVideoRate(sweep({ frames: 4 })),
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((seed) => [`random walk ${seed}`, randomWalk({ seed })])),
};

describe("stir", () => {
  it("counts one per full circle", () => {
    expect(sum(feed(createStir(G.stir), circles({ r: 40, turns: 3 })))).toBe(2);   // > 2π needed, so 3 turns of 60 frames = 2 full counts + remainder
    expect(sum(feed(createStir(G.stir), circles({ r: 40, turns: 3.1 })))).toBe(3);
  });
  it("counts nothing outside the target", () => {
    expect(sum(feed(createStir(G.stir), circles({ r: 40, turns: 5 }), { x: 600, y: 600, r: 90 }))).toBe(0);
  });
  it("reports partial progress", () => {
    const s = createStir(G.stir);
    feed(s, circles({ r: 40, turns: 0.5 }));
    expect(s.progress()).toBeCloseTo(0.5, 1);
  });
  it("turnsPerCount 2 halves the counts", () => {
    expect(sum(feed(createStir({ turnsPerCount: 2 }), circles({ r: 40, turns: 4.2 })))).toBe(2);
  });
  it.each(Object.entries(PARITY_PATHS))("matches legacy kitchen-race frame by frame: %s", (_, path) => {
    expect(feed(createStir(G.stir), path)).toEqual(feedLegacy("stir", path));
  });
});

/** Oscillation with a fast small tremor on top, on the same axis. */
const withTremor = (/** @type {{ pt: {x:number,y:number} | null, dt: number }[]} */ path, /** @type {"x"|"y"} */ axis, amp = 6, period = 4) =>
  path.map((f, i) => ({ ...f, pt: f.pt && { ...f.pt, [axis]: f.pt[axis] + amp * Math.sin((2 * Math.PI * i) / period) } }));

describe("chop", () => {
  const chops = (/** @type {number} */ amp, cycles = 10) => oscillate({ axis: "y", amp, cycles });
  it("counts one per down-stroke longer than travelPx", () => {
    // 10 cycles starting and ending mid-stroke = 9 full down-strokes + two half strokes
    expect(sum(feed(createChop(G.chop), chops(20)))).toBe(9);    // 40px strokes
    expect(sum(feed(createChop(G.chop), chops(20, 11).slice(8)))).toBe(10);   // starting at the top: 10 full
  });
  it("counts the same wherever the first stroke starts (fixes the prototype's 0/10 case)", () => {
    for (const amp of [12, 14, 16, 20]) {                         // 24-40px strokes, all over the 22px threshold
      const fromMid = sum(feed(createChop(G.chop), chops(amp)));
      const fromTop = sum(feed(createChop(G.chop), chops(amp).slice(8)));
      expect(fromMid).toBeGreaterThanOrEqual(9);
      expect(Math.abs(fromMid - fromTop)).toBeLessThanOrEqual(1);
    }
  });
  it("prototype comparison: the old rule gave 0/10 for 30px chops started mid-stroke", () => {
    expect(sum(feedLegacy("chop", chops(15)))).toBe(0);
    expect(sum(feed(createChop(G.chop), chops(15)))).toBeGreaterThanOrEqual(9);
  });
  it("ignores strokes shorter than travelPx, however many", () => {
    expect(sum(feed(createChop(G.chop), chops(10, 30)))).toBe(0);   // 20px strokes
  });
  it("ignores tremor on its own", () => {
    expect(sum(feed(createChop(G.chop), withTremor(chops(0), "y", 8)))).toBe(0);
  });
  it("tremor during real chops doesn't split or add strokes", () => {
    expect(sum(feed(createChop(G.chop), withTremor(chops(25), "y", 6)))).toBe(sum(feed(createChop(G.chop), chops(25))));
  });
  it("ignores side-to-side movement", () => {
    expect(sum(feed(createChop(G.chop), oscillate({ axis: "x", amp: 40, cycles: 10 })))).toBe(0);
  });
  it("lower travelPx accepts smaller chops", () => {
    expect(sum(feed(createChop({ travelPx: 10 }), chops(8)))).toBeGreaterThanOrEqual(9);
  });
  it("big strokes count the same as the prototype (within one)", () => {
    for (const amp of [20, 30, 40]) {
      const path = chops(amp).slice(8);
      expect(Math.abs(sum(feed(createChop(G.chop), path)) - sum(feedLegacy("chop", path)))).toBeLessThanOrEqual(1);
    }
  });
  it("leaving the target ends the stroke", () => {
    const det = createChop(G.chop);
    const path = chops(20);
    const counts = path.map((f, i) => det.update(i % 20 < 10 ? f.pt : null, TARGET, f.dt));   // in and out every 10 frames
    expect(sum(counts)).toBeLessThan(sum(feed(createChop(G.chop), path)));
  });
});

describe("flick", () => {
  it("counts a fast upward sweep that starts over the target", () => {
    expect(sum(feed(createFlick(G.flick), sweep({ frames: 4 })))).toBe(1);          // 140px in 4 frames ≈ 2100 px/s
  });
  it("ignores a slow raise", () => {
    expect(sum(feed(createFlick(G.flick), sweep({ frames: 40 })))).toBe(0);         // ≈ 210 px/s
  });
  it("ignores a fast downward move", () => {
    expect(sum(feed(createFlick(G.flick), sweep({ y0: 120, y1: 260, frames: 4 })))).toBe(0);
  });
  it("ignores a flick that starts outside the target", () => {
    expect(sum(feed(createFlick(G.flick), sweep({ x: 600, frames: 4 })))).toBe(0);
  });
  it("counts once per cooldown even if the fast move lasts several frames", () => {
    expect(sum(feed(createFlick(G.flick), sweep({ y0: 280, y1: 40, frames: 8 })))).toBe(1);
  });
  // With a tracked hand there is a point every frame, and then the new
  // detector must match the prototype exactly. (Paths with dropouts differ on
  // purpose: see the mouse test below.)
  const continuous = Object.entries(PARITY_PATHS).map(([k, p]) => /** @type {[string, typeof p]} */ ([k, p.filter((/** @type {{ pt: unknown }} */ f) => f.pt)]));
  it.each(continuous)("matches legacy kitchen-race frame by frame while a hand is present: %s", (_, path) => {
    expect(feed(createFlick(G.flick), path)).toEqual(feedLegacy("flick", path));
  });
  it("cooldown keeps running with no input, so repeated mouse flicks count", () => {
    // mouse: press, flick fast, release, wait 0.7s with no input, repeat 3 times
    const gap = Array.from({ length: 42 }, () => ({ pt: null, dt: 1 / 60 }));
    const one = sweep({ frames: 4, hold: 0 });
    const path = [...one, ...gap, ...one, ...gap, ...one];
    expect(sum(feed(createFlick(G.flick), path))).toBe(3);
    expect(sum(feedLegacy("flick", path))).toBe(1);   // prototype: only the first counted
  });
  it("still enforces the cooldown between quick flicks", () => {
    const one = sweep({ frames: 4, hold: 0 }), gap = Array.from({ length: 6 }, () => ({ pt: null, dt: 1 / 60 }));
    expect(sum(feed(createFlick(G.flick), [...one, ...gap, ...one]))).toBe(1);
  });
});

describe("shake", () => {
  const shakes = (/** @type {number} */ amp, cycles = 10) => oscillate({ axis: "x", amp, cycles });
  it("counts every sideways stroke longer than travelPx, both directions", () => {
    expect(sum(feed(createShake(G.shake), shakes(12)))).toBeGreaterThanOrEqual(19);   // 24px strokes
  });
  it("counts the same wherever the first stroke starts", () => {
    const fromMid = sum(feed(createShake(G.shake), shakes(9)));                       // 18px strokes
    const fromSide = sum(feed(createShake(G.shake), shakes(9).slice(8)));
    expect(fromMid).toBeGreaterThanOrEqual(18);
    expect(Math.abs(fromMid - fromSide)).toBeLessThanOrEqual(1);
  });
  it("ignores tremor-sized wiggles", () => {
    expect(sum(feed(createShake(G.shake), shakes(5)))).toBe(0);
  });
  it("tremor during real shakes doesn't add strokes", () => {
    expect(sum(feed(createShake(G.shake), withTremor(shakes(20), "x", 5)))).toBe(sum(feed(createShake(G.shake), shakes(20))));
  });
  it("counts nothing when not holding (pt = null)", () => {
    const det = createShake(G.shake);
    expect(sum(shakes(20).map((f) => det.update(null, TARGET, f.dt)))).toBe(0);
  });
  it("big strokes count the same as the prototype (within one)", () => {
    const path = shakes(20).slice(8);
    expect(Math.abs(sum(feed(createShake(G.shake), path)) - sum(feedLegacy("shake", path)))).toBeLessThanOrEqual(1);
  });
});

describe("parity paths", () => {
  // Guard against a vacuous parity test: every detector must actually count
  // on the shared paths, otherwise "matches legacy" could just mean "both 0".
  it.each(/** @type {const} */ (["stir", "chop", "flick", "shake"]))("exercise %s with real counts", (kind) => {
    const total = Object.values(PARITY_PATHS).reduce((n, p) => n + sum(feedLegacy(kind, p)), 0);
    expect(total).toBeGreaterThan(5);
  });
});

describe("createDetector", () => {
  it("builds each kind from settings and rejects unknown kinds", () => {
    for (const k of /** @type {const} */ (["stir", "chop", "flick", "shake"])) expect(typeof createDetector(k, G).update).toBe("function");
    expect(() => createDetector(/** @type {any} */ ("wave"), G)).toThrow(/Unknown gesture/);
  });
});
