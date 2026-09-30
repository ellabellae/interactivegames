// @ts-check
import { describe, expect, it } from "vitest";
import { GENTLE, STANDARD, STORAGE_KEY, loadChoice, loadSettings, mergeSettings, resolveSettings, saveChoice } from "./settings.js";

/** In-memory stand-in for localStorage. */
function memoryStorage(initial = /** @type {Record<string, string>} */ ({})) {
  const data = { ...initial };
  return { data, getItem: (/** @type {string} */ k) => data[k] ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => { data[k] = v; } };
}

describe("STANDARD profile", () => {
  it("keeps the values the prototypes shipped with", () => {
    expect(STANDARD.pinch).toEqual({ on: 0.30, off: 0.42, holdFrames: 2 });
    expect(STANDARD.cursor.smoothing).toBe(0.5);
    expect(STANDARD.tracking.handLostFrames).toBe(10);
    expect(STANDARD.gestures.chop.travelPx).toBe(22);
    expect(STANDARD.gestures.flick).toEqual({ minSpeedPxPerS: 1100, cooldownS: 0.6 });
    expect(STANDARD.gestures.shake.travelPx).toBe(14);
    expect(STANDARD.gestures.stir.turnsPerCount).toBe(1);
    expect(STANDARD.targets.brickGrabPx).toBe(28);
    expect(STANDARD.targets.partGrabPx).toBe(110);
  });
});

describe("mergeSettings", () => {
  it("merges nested objects and replaces leaves", () => {
    const out = mergeSettings(STANDARD, { pinch: { on: 0.4 } });
    expect(out.pinch).toEqual({ on: 0.4, off: 0.42, holdFrames: 2 });
    expect(out.cursor).toBe(STANDARD.cursor);
  });
  it("ignores unknown keys and wrong types", () => {
    const out = mergeSettings(STANDARD, { pinch: { on: "wide", bogus: 1 }, extra: true });
    expect(out.pinch.on).toBe(0.30);
    expect(out).not.toHaveProperty("extra");
    expect(out.pinch).not.toHaveProperty("bogus");
  });
  it("replaces arrays whole", () => {
    expect(mergeSettings(STANDARD, { targets: { brickCellPx: [30, 44] } }).targets.brickCellPx).toEqual([30, 44]);
  });
  it("fills a null slot (e.g. raise) with the override", () => {
    expect(mergeSettings(STANDARD, { gestures: { raise: { travelPx: 60, maxS: 2 } } }).gestures.raise).toEqual({ travelPx: 60, maxS: 2 });
  });
});

describe("resolveSettings", () => {
  it("falls back to standard for an unknown profile", () => {
    expect(resolveSettings("nope").id).toBe("standard");
  });
  it("returns a frozen copy that does not alias the preset", () => {
    const s = resolveSettings("standard", { pinch: { on: 0.35 } });
    expect(Object.isFrozen(s.pinch)).toBe(true);
    expect(STANDARD.pinch.on).toBe(0.30);
  });
});

describe("storage", () => {
  it("round-trips a choice", () => {
    const st = memoryStorage();
    saveChoice({ profileId: "standard", overrides: { cursor: { smoothing: 0.3 } } }, st);
    expect(loadSettings(st).cursor.smoothing).toBe(0.3);
  });
  it("survives corrupt, missing or blocked storage", () => {
    expect(loadChoice(memoryStorage({ [STORAGE_KEY]: "{not json" })).profileId).toBe("standard");
    expect(loadChoice(null).profileId).toBe("standard");
    const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
    expect(loadChoice(throwing).profileId).toBe("standard");
    expect(saveChoice({ profileId: "standard", overrides: {} }, throwing)).toBe(false);
  });
  it("maps a removed profile id back to standard", () => {
    expect(loadChoice(memoryStorage({ [STORAGE_KEY]: JSON.stringify({ profileId: "old", overrides: {} }) })).profileId).toBe("standard");
  });
});

describe("GENTLE profile", () => {
  it("has the agreed values", () => {
    expect(GENTLE.id).toBe("gentle");
    expect(GENTLE.pinch).toEqual({ on: 0.38, off: 0.55, holdFrames: 4 });
    expect(GENTLE.cursor.smoothing).toBe(0.25);
    expect(GENTLE.tracking.handLostFrames).toBe(20);
    expect(GENTLE.targets).toEqual({ padPx: 50, brickGrabPx: 50, partGrabPx: 110, brickCellPx: [30, 46], snapCells: 0.8 });
    expect(GENTLE.gestures).toMatchObject({ stir: { turnsPerCount: 0.5 }, chop: { travelPx: 12 }, shake: { travelPx: 8 }, raise: { travelPx: 60, maxS: 3 } });
    expect(GENTLE.game).toEqual({ repsScale: 0.5, tempo: { startBpm: 110, bpmPerStep: 0, maxBpm: 110 }, wrongDrop: "none", countdownMs: 1200 });
  });
  it("is easier than standard on every difficulty threshold", () => {
    expect(GENTLE.pinch.on).toBeGreaterThan(STANDARD.pinch.on);          // pinch starts further apart
    expect(GENTLE.pinch.off).toBeGreaterThan(STANDARD.pinch.off);        // and holds further apart
    expect(GENTLE.cursor.smoothing).toBeLessThan(STANDARD.cursor.smoothing);
    expect(GENTLE.targets.padPx).toBeGreaterThan(STANDARD.targets.padPx);
    expect(GENTLE.targets.brickGrabPx).toBeGreaterThan(STANDARD.targets.brickGrabPx);
    expect(GENTLE.targets.snapCells).toBeGreaterThan(STANDARD.targets.snapCells);
    expect(GENTLE.gestures.chop.travelPx).toBeLessThan(STANDARD.gestures.chop.travelPx);
    expect(GENTLE.gestures.shake.travelPx).toBeLessThan(STANDARD.gestures.shake.travelPx);
    expect(GENTLE.gestures.stir.turnsPerCount).toBeLessThan(STANDARD.gestures.stir.turnsPerCount);
    expect(GENTLE.game.repsScale).toBeLessThan(STANDARD.game.repsScale);
  });
  it("keeps the pinch release wider than the start (hysteresis still works)", () => {
    expect(GENTLE.pinch.off).toBeGreaterThan(GENTLE.pinch.on);
  });
  it("leaves standard unchanged", () => {
    expect(STANDARD.id).toBe("standard");
    expect(STANDARD.gestures.raise).toBeNull();
  });
  it("can be chosen and saved", () => {
    const st = memoryStorage();
    saveChoice({ profileId: "gentle", overrides: {} }, st);
    expect(loadSettings(st).id).toBe("gentle");
  });
});
