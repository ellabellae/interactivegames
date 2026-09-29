// @ts-check
import { describe, expect, it, vi } from "vitest";

// tracking.js imports MediaPipe from the CDN at runtime; tests only need the pure helpers.
vi.mock("@mediapipe/tasks-vision", () => ({ HandLandmarker: { HAND_CONNECTIONS: [] }, FilesetResolver: {} }));
const { coverRect, toHand } = await import("./tracking.js");

/** 21 landmarks all at one point, then override some. */
const lms = (/** @type {Record<number, {x:number,y:number}>} */ over) => Array.from({ length: 21 }, (_, i) => over[i] ?? { x: 0.5, y: 0.5 });

describe("coverRect", () => {
  it("fills a wider window by cropping top and bottom", () => {
    expect(coverRect(1280, 720, 1920, 800)).toEqual({ ox: 0, oy: -140, dw: 1920, dh: 1080 });
  });
  it("fills a taller window by cropping the sides", () => {
    const r = coverRect(1280, 720, 720, 1280);
    expect(r.dh).toBe(1280); expect(r.ox).toBeCloseTo(-777.78, 1);
  });
});

describe("toHand", () => {
  const rect = { ox: 0, oy: 0, dw: 1000, dh: 500 };
  const hand = toHand(lms({ 0: { x: 0.5, y: 0.8 }, 9: { x: 0.5, y: 0.6 }, 4: { x: 0.30, y: 0.4 }, 8: { x: 0.32, y: 0.4 } }), rect);
  it("mirrors x so the hand matches the mirrored video", () => {
    expect(hand.lmNorm[4].x).toBeCloseTo(0.70);
    expect(hand.lm[4].x).toBeCloseTo(700);
  });
  it("puts the pinch point between thumb and index tips", () => {
    expect(hand.pt.x).toBeCloseTo(690); expect(hand.pt.y).toBeCloseTo(200);
  });
  it("measures pinch distance relative to hand size in screen px", () => {
    // thumb-index 20px, wrist-knuckle 100px
    expect(hand.pinchDist).toBeCloseTo(0.2);
  });
  it("uses the middle knuckle for screen side", () => {
    expect(hand.sideX).toBeCloseTo(500);
  });
});
