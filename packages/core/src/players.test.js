// @ts-check
import { describe, expect, it } from "vitest";
import { createSlots } from "./players.js";
import { STANDARD } from "./settings.js";

/** Minimal Hand at (x, y) with a pinch distance. */
const hand = (/** @type {number} */ x, /** @type {number} */ y, pinchDist = 0.8) =>
  /** @type {import("./tracking.js").Hand} */ ({ pt: { x, y }, sideX: x, pinchDist, lm: [], lmNorm: [], palm: { x, y }, palmNorm: { x: 0, y: 0 } });

const make = (/** @type {import("./players.js").SlotMode} */ mode) => createSlots({ mode, settings: STANDARD, width: () => 1000 });

describe("split mode", () => {
  it("gives each half of the screen its own player", () => {
    const s = make("split");
    s.updateHands([hand(800, 300), hand(200, 300)]);
    const [p1, p2] = s.frame();
    expect([p1.x, p2.x]).toEqual([200, 800]);
    expect(p1.source).toBe("hand");
  });
  it("leaves a player empty when two hands are on the same side", () => {
    const s = make("split");
    s.updateHands([hand(100, 300), hand(200, 300)]);
    expect(s.frame()[1].x).toBeNull();
  });
  it("pinches after holdFrames video frames and reports the edge once", () => {
    const s = make("split");
    s.updateHands([hand(200, 300, 0.2)]); expect(s.frame()[0].down).toBe(false);
    s.updateHands([hand(200, 300, 0.2)]);
    expect(s.frame()[0].pressed).toBe(true);
    expect(s.frame()[0].pressed).toBe(false);   // next render frame, no new video frame
  });
  it(`keeps the cursor (and anything held) for ${STANDARD.tracking.handLostFrames} frames after the hand disappears`, () => {
    const s = make("split");
    s.updateHands([hand(200, 300, 0.2)]); s.updateHands([hand(200, 300, 0.2)]); s.frame();
    for (let i = 0; i < STANDARD.tracking.handLostFrames; i++) { s.updateHands([]); expect(s.frame()[0].down).toBe(true); }
    s.updateHands([]);
    const lost = s.frame()[0];
    expect(lost).toMatchObject({ down: false, released: true, x: null, source: null });
  });
  it("does not draw a lost hand even while its cursor is kept", () => {
    const s = make("split");
    s.updateHands([hand(200, 300)]); s.updateHands([]);
    expect(s.frame()[0].hand).toBeNull();
  });
});

describe("pointer fallback", () => {
  it("drives the slot for its half, overrides the hand, then releases at the up position", () => {
    const s = make("split");
    s.updateHands([hand(700, 300)]);
    expect(s.pointerDown(1, 900, 100)).toBe(1);
    expect(s.frame()[1]).toMatchObject({ x: 900, down: true, pressed: true, source: "pointer" });
    s.pointerMove(1, 950, 120);
    expect(s.frame()[1]).toMatchObject({ x: 950, y: 120, down: true, pressed: false });
    s.pointerUp(1, 960, 130);
    expect(s.frame()[1]).toMatchObject({ x: 960, released: true, source: "pointer" });
    expect(s.frame()[1]).toMatchObject({ source: "hand", released: false });
  });
  it("two pointers in shared mode take different slots", () => {
    const s = make("shared");
    expect([s.pointerDown(1, 100, 100), s.pointerDown(2, 120, 100), s.pointerDown(3, 140, 100)]).toEqual([0, 1, -1]);
  });
});

describe("shared mode", () => {
  it("keeps each hand on its slot when MediaPipe swaps their order", () => {
    const s = make("shared");
    s.updateHands([hand(300, 300), hand(600, 300)]);
    s.updateHands([hand(610, 300), hand(305, 300)]);   // order swapped, positions continuous
    const [a, b] = s.frame();
    expect(a.x).toBeLessThan(400); expect(b.x).toBeGreaterThan(500);
  });
  it("lets both hands be on the same half of the screen", () => {
    const s = make("shared");
    s.updateHands([hand(100, 300), hand(200, 300)]);
    expect(s.frame().every((i) => i.x !== null)).toBe(true);
  });
});

describe("solo mode", () => {
  it("has one slot that follows the nearest hand", () => {
    const s = make("solo");
    expect(s.count).toBe(1);
    s.updateHands([hand(900, 300)]);
    s.updateHands([hand(100, 100), hand(880, 310)]);
    expect(s.frame()[0].x).toBeGreaterThan(800);
  });
});
