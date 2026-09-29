// @ts-check
// Who controls what. A "slot" is one player's input: a smoothed cursor, a
// pinch state and the hand or pointer driving it. Games read one input per
// slot per frame and don't care whether it came from a hand or a mouse.
//
// Modes:
//   split   2 slots, one per half of the screen (the original race games)
//   shared  2 slots on one board; hands keep their slot by staying nearest
//           to where that slot's cursor was (co-op)
//   solo    1 slot, any hand or pointer
//
// Behaviour in split mode follows legacy/kitchen-race.html and brick-race.html.
import { createCursor, createPinch } from "./gestures.js";

/**
 * @typedef {import("./tracking.js").Hand} Hand
 * @typedef {"split" | "shared" | "solo"} SlotMode
 * @typedef {object} SlotInput
 * @property {number | null} x        cursor position, null when there is no input
 * @property {number | null} y
 * @property {boolean} down           pinching (hand) or pressed (pointer)
 * @property {boolean} pressed        down started this frame
 * @property {boolean} released       down ended this frame (x/y may be null if the hand was lost)
 * @property {"hand" | "pointer" | null} source
 * @property {Hand | null} hand       the tracked hand this video frame, for drawing
 */

/**
 * @param {object} opts
 * @param {SlotMode} opts.mode
 * @param {import("./settings.js").Settings} opts.settings
 * @param {() => number} [opts.width]  screen width, for split mode
 */
export function createSlots({ mode, settings, width = () => innerWidth }) {
  const count = mode === "solo" ? 1 : 2;
  const slots = Array.from({ length: count }, (_, index) => ({
    index,
    pinch: createPinch(settings.pinch),
    cursor: createCursor(settings.cursor),
    lostFrames: 0,
    /** @type {Hand | null} */ hand: null,
    /** @type {{ x: number, y: number, down: boolean } | null} */ handInput: null,
    /** @type {{ id: number, x: number, y: number, down: boolean } | null} */ pointer: null,
    wasDown: false,
  }));

  /** @param {Hand[]} hands @returns {(Hand | null)[]} one entry per slot */
  function assign(hands) {
    if (mode === "split") {
      return slots.map((s) => hands.find((h) => (h.sideX < width() / 2) === (s.index === 0)) ?? null);
    }
    // shared / solo: each slot takes the hand nearest its last cursor; slots
    // with no history then take the remaining hands left to right.
    /** @type {(Hand | null)[]} */ const out = slots.map(() => null);
    const free = [...hands];
    for (const s of slots) {
      const c = s.cursor.value;
      if (!c || !free.length) continue;
      let best = 0;
      free.forEach((h, i) => { if (Math.hypot(h.pt.x - c.x, h.pt.y - c.y) < Math.hypot(free[best].pt.x - c.x, free[best].pt.y - c.y)) best = i; });
      out[s.index] = free.splice(best, 1)[0];
    }
    free.sort((a, b) => a.sideX - b.sideX);
    for (const s of slots) if (!out[s.index] && free.length) out[s.index] = /** @type {Hand} */ (free.shift());
    return out;
  }

  return {
    slots,
    count,

    /**
     * Feed the hands from one new video frame (call only when tracker.read()
     * returned non-null, as the originals did).
     * @param {Hand[]} hands
     */
    updateHands(hands) {
      const mine = assign(hands);
      for (const s of slots) {
        const h = mine[s.index];
        s.hand = h;
        if (!h) {
          if (s.handInput && ++s.lostFrames > settings.tracking.handLostFrames) { s.handInput = null; s.cursor.reset(); s.pinch.reset(); }
          continue;
        }
        s.lostFrames = 0;
        const c = s.cursor.update(h.pt);
        s.handInput = { x: c.x, y: c.y, down: s.pinch.update(h.pinchDist).down };
      }
    },

    /** Which slot a new pointer at (x, y) should drive, or -1 for none. */
    slotForPointer(/** @type {number} */ x) {
      if (mode === "split") return x < width() / 2 ? 0 : 1;
      const open = slots.filter((s) => !s.pointer);
      return (open.find((s) => !s.handInput) ?? open[0])?.index ?? -1;
    },

    /** @param {number} id @param {number} x @param {number} y @returns {number} slot index or -1 */
    pointerDown(id, x, y) {
      const i = this.slotForPointer(x);
      if (i >= 0) slots[i].pointer = { id, x, y, down: true };
      return i;
    },
    /** @param {number} id @param {number} x @param {number} y */
    pointerMove(id, x, y) {
      const s = slots.find((q) => q.pointer?.id === id && q.pointer.down);
      if (s && s.pointer) { s.pointer.x = x; s.pointer.y = y; }
    },
    /** @param {number} id @param {number} x @param {number} y */
    pointerUp(id, x, y) {
      const s = slots.find((q) => q.pointer?.id === id && q.pointer.down);
      if (s) s.pointer = { id, x, y, down: false };   // seen as a release next frame, then cleared
    },

    /**
     * Call once per render frame. A pointer that is down overrides the hand
     * on its slot. Edges (pressed/released) are computed here, per frame.
     * @returns {SlotInput[]}
     */
    frame() {
      return slots.map((s) => {
        const src = s.pointer ? "pointer" : s.handInput ? "hand" : null;
        const inp = s.pointer ?? s.handInput;
        const down = !!inp?.down;
        const out = { x: inp?.x ?? null, y: inp?.y ?? null, down, pressed: down && !s.wasDown, released: !down && s.wasDown, source: /** @type {SlotInput["source"]} */ (src), hand: s.hand };
        s.wasDown = down;
        if (s.pointer && !s.pointer.down) s.pointer = null;
        return out;
      });
    },

    /** Forget all hands and pointers (new round). */
    reset() {
      for (const s of slots) { s.pinch.reset(); s.cursor.reset(); s.hand = null; s.handInput = null; s.pointer = null; s.wasDown = false; s.lostFrames = 0; }
    },
  };
}
