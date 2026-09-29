// @ts-check
import { describe, expect, it } from "vitest";
import { createCursor, createPinch, isNear } from "./gestures.js";
import { STANDARD } from "./settings.js";

/** Run a sequence of distances and return the down state after each. */
const run = (/** @type {number[]} */ dists, cfg = STANDARD.pinch) => {
  const p = createPinch(cfg);
  return dists.map((d) => p.update(d));
};

describe("createPinch", () => {
  it("needs holdFrames consecutive frames under 'on' to start", () => {
    expect(run([0.2]).map((r) => r.down)).toEqual([false]);
    expect(run([0.2, 0.2]).map((r) => r.down)).toEqual([false, true]);
  });
  it("ignores a one-frame blip", () => {
    expect(run([0.2, 0.5, 0.2, 0.5]).some((r) => r.down)).toBe(false);
  });
  it("stays down between 'on' and 'off' (hysteresis)", () => {
    expect(run([0.2, 0.2, 0.35, 0.41]).map((r) => r.down)).toEqual([false, true, true, true]);
  });
  it("releases as soon as the distance reaches 'off'", () => {
    expect(run([0.2, 0.2, 0.42]).map((r) => r.down)).toEqual([false, true, false]);
  });
  it("reports pressed and released for exactly one frame", () => {
    const r = run([0.2, 0.2, 0.2, 0.5, 0.5]);
    expect(r.map((x) => x.pressed)).toEqual([false, true, false, false, false]);
    expect(r.map((x) => x.released)).toEqual([false, false, false, true, false]);
  });
  it("does not start between 'on' and 'off' from open", () => {
    expect(run([0.35, 0.35, 0.35]).some((r) => r.down)).toBe(false);
  });
  it("reset clears state", () => {
    const p = createPinch(STANDARD.pinch);
    p.update(0.2); p.update(0.2); expect(p.down).toBe(true);
    p.reset(); expect(p.down).toBe(false);
    expect(p.update(0.2).down).toBe(false);
  });
});

describe("createCursor", () => {
  it("starts at the first point, then moves 'smoothing' of the way each frame", () => {
    const c = createCursor({ smoothing: 0.5 });
    expect(c.update({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(c.update({ x: 100, y: 40 })).toEqual({ x: 50, y: 20 });
    expect(c.update({ x: 100, y: 40 })).toEqual({ x: 75, y: 30 });
  });
  it("smoothing 1 is raw input", () => {
    const c = createCursor({ smoothing: 1 });
    c.update({ x: 0, y: 0 });
    expect(c.update({ x: 7, y: 9 })).toEqual({ x: 7, y: 9 });
  });
  it("reset starts fresh at the next point", () => {
    const c = createCursor({ smoothing: 0.5 });
    c.update({ x: 0, y: 0 }); c.reset();
    expect(c.update({ x: 10, y: 10 })).toEqual({ x: 10, y: 10 });
  });
});

describe("isNear", () => {
  it("is strictly inside the radius", () => {
    expect(isNear({ x: 9, y: 0 }, { x: 0, y: 0, r: 10 })).toBe(true);
    expect(isNear({ x: 10, y: 0 }, { x: 0, y: 0, r: 10 })).toBe(false);
    expect(isNear(null, { x: 0, y: 0, r: 10 })).toBe(false);
  });
});
