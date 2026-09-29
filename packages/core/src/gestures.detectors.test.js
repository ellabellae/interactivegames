// @ts-check
import { describe, expect, it } from "vitest";
import { createChop, createStir } from "./gestures.js";
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

describe("chop", () => {
  it("counts once per down-stroke when travel exceeds travelPx", () => {
    // amplitude 20 = 40px peak to peak > 22px; first reversal only sets the reference
    expect(sum(feed(createChop(G.chop), oscillate({ axis: "y", amp: 20, cycles: 10 })))).toBeGreaterThanOrEqual(9);
  });
  it("ignores small movements (tremor-sized)", () => {
    expect(sum(feed(createChop(G.chop), oscillate({ axis: "y", amp: 8, cycles: 10 })))).toBe(0);
  });
  it("ignores side-to-side movement", () => {
    expect(sum(feed(createChop(G.chop), oscillate({ axis: "x", amp: 40, cycles: 10 })))).toBe(0);
  });
  it("lower travelPx accepts smaller chops", () => {
    const fromTop = oscillate({ axis: "y", amp: 8, cycles: 10 }).slice(8);
    expect(sum(feed(createChop(G.chop), fromTop))).toBe(0);
    expect(sum(feed(createChop({ travelPx: 10 }), fromTop))).toBeGreaterThan(0);
  });
  // KNOWN LEGACY QUIRK, kept for parity with kitchen-race (owner decision
  // pending). Travel is measured from the last *counted* turning point, and
  // before the first count that is wherever the hand entered the target. So
  // 30px chops count every time if the first stroke starts at the top, and
  // never if it starts mid-stroke. If this is fixed, flip these expectations.
  it("legacy quirk: the same 30px chops count or not depending on where they start", () => {
    const chops = oscillate({ axis: "y", amp: 15, cycles: 10 });
    expect(sum(feed(createChop(G.chop), chops.slice(8)))).toBe(10);   // starts at a peak
    expect(sum(feed(createChop(G.chop), chops))).toBe(0);             // starts mid-stroke
  });
  it.each(Object.entries(PARITY_PATHS))("matches legacy kitchen-race frame by frame: %s", (_, path) => {
    expect(feed(createChop(G.chop), path)).toEqual(feedLegacy("chop", path));
  });
});
