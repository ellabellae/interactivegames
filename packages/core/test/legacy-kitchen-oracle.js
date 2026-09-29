// Reference copy of the gesture logic from legacy/kitchen-race.html
// (updateGesture, lines 206-225), used only by tests to prove the new
// detectors count exactly the same as the original.
//
// Edits from the original, and nothing else:
// - near(pt, el) takes a { x, y, r } target instead of a DOM element
// - progress(pl) / puff() calls replaced by `count++`
// - Math.random() swish sounds removed (no effect on counting)
// - the hard-coded thresholds 22, 1100, 0.6, 14 and 2π are kept as literals
//   on purpose: this file is the "before".

const near = (pt, t) => { if (!pt || !t) return false; return Math.hypot(pt.x - t.x, pt.y - t.y) < t.r; };

/** Returns a stepper: (kind, pt|null, target, dt, held) -> counts this frame. */
export function legacyKitchen() {
  const g = {};
  return function step(kind, pt, dst, dt, held = false) {
    let count = 0;
    switch (kind) {
      case "stir": {
        if (!pt || !near(pt, dst)) { g.lastAng = null; break; }
        const c = dst, ang = Math.atan2(pt.y - c.y, pt.x - c.x);
        if (g.lastAng != null) { let d = ang - g.lastAng; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; g.acc = (g.acc || 0) + Math.abs(d);
          if (g.acc > 2 * Math.PI) { g.acc = 0; count++; } }
        g.lastAng = ang; break; }
      case "chop": {
        if (!pt || !near(pt, dst)) { g.prevY = null; break; }
        if (g.prevY != null) { const dir = Math.sign(pt.y - g.prevY); if (dir && g.dir && dir !== g.dir && Math.abs(pt.y - (g.extY ?? pt.y)) > 22) { g.extY = pt.y; if (dir > 0) { count++; } } if (dir) g.dir = dir; if (g.extY == null) g.extY = pt.y; }
        g.prevY = pt.y; break; }
      case "flick": {
        if (!pt) { g.prevY = null; break; }
        if (g.prevY != null && dt > 0) { const vy = (g.prevY - pt.y) / dt; g.cool = Math.max(0, (g.cool || 0) - dt);
          if (vy > 1100 && g.cool === 0 && near({ x: pt.x, y: g.prevY }, dst)) { g.cool = 0.6; count++; } }
        g.prevY = pt.y; break; }
      case "shake": {
        if (held && pt && near(pt, dst)) { if (g.prevX != null) { const dir = Math.sign(pt.x - g.prevX); if (dir && g.dir && dir !== g.dir && Math.abs(pt.x - (g.extX ?? pt.x)) > 14) { g.extX = pt.x; count++; } if (dir) g.dir = dir; if (g.extX == null) g.extX = pt.x; } g.prevX = pt.x; } else g.prevX = null;
        break; }
    }
    return count;
  };
}
