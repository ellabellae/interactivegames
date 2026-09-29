// Synthetic hand paths for gesture tests. Each path is a list of frames
// { pt: {x,y} | null, dt } sampled at 60 fps unless stated. A seeded random
// generator keeps "random" paths identical on every run.

/** Mulberry32: tiny deterministic PRNG. */
export function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const DT = 1 / 60;

/** Circles of radius r around (cx, cy). */
export function circles({ cx = 200, cy = 200, r = 40, turns = 1, framesPerTurn = 60 }) {
  const n = Math.round(turns * framesPerTurn);
  return Array.from({ length: n + 1 }, (_, i) => ({ pt: { x: cx + r * Math.cos((2 * Math.PI * i) / framesPerTurn), y: cy + r * Math.sin((2 * Math.PI * i) / framesPerTurn) }, dt: DT }));
}

/** Oscillation along one axis with amplitude amp (peak to centre). */
export function oscillate({ axis = "y", cx = 200, cy = 200, amp = 20, cycles = 5, framesPerCycle = 30 }) {
  const n = cycles * framesPerCycle;
  return Array.from({ length: n + 1 }, (_, i) => {
    const off = amp * Math.sin((2 * Math.PI * i) / framesPerCycle);
    return { pt: axis === "y" ? { x: cx, y: cy + off } : { x: cx + off, y: cy }, dt: DT };
  });
}

/** Straight vertical move from y0 to y1 over `frames`, then hold still. */
export function sweep({ x = 200, y0 = 260, y1 = 120, frames = 6, hold = 30 }) {
  const out = [];
  for (let i = 0; i <= frames; i++) out.push({ pt: { x, y: y0 + ((y1 - y0) * i) / frames }, dt: DT });
  for (let i = 0; i < hold; i++) out.push({ pt: { x, y: y1 }, dt: DT });
  return out;
}

/** Random walk with occasional dropouts (hand lost) and jittery frame times. */
export function randomWalk({ seed = 1, frames = 2000, cx = 200, cy = 200, step = 18, dropout = 0.03 }) {
  const r = rng(seed), out = [];
  let x = cx, y = cy, vx = 0, vy = 0;
  for (let i = 0; i < frames; i++) {
    vx = vx * 0.8 + (r() - 0.5) * step; vy = vy * 0.8 + (r() - 0.5) * step;
    x += vx; y += vy; x += (cx - x) * 0.05; y += (cy - y) * 0.05;
    out.push({ pt: r() < dropout ? null : { x, y }, dt: Math.min(0.05, DT * (0.5 + r())) });
  }
  return out;
}

/** Hold still between frames (camera slower than render): repeat each point k times. */
export function atVideoRate(path, k = 2) {
  return path.flatMap((f) => Array.from({ length: k }, () => ({ ...f })));
}
