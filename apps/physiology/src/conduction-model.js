// @ts-check
// Timing of one heartbeat's electrical activation, for teaching.
//
// The intervals come from the lecture "Excitation and Conduction System of
// the Heart" (slide numbers below). Where the lecture gives no number, the
// value is derived from the anatomy (distance / a velocity the lecture gives)
// and marked "derived". Spatial order (which tissue is reached first) comes
// from the placed conduction paths; the lecture's intervals are then enforced
// exactly. This is a simplified teaching model, not a clinical simulation.

/** @typedef {[number, number, number]} Vec3 */

/** Lecture values. Each has a source so a teacher can check or change it. */
export const LECTURE = {
  saRateBpm: { value: 75, source: "slide 20: SA node discharges 70-80 bpm (midpoint)" },
  avRateBpm: { value: 50, source: "slide 20: AV nodal fibres 40-60 bpm without SA input (midpoint)" },
  purkinjeRateBpm: { value: 28, source: "slide 20: Purkinje fibres 15-40 bpm without AV input (midpoint)" },
  internodalVelocity: { value: 1.0, source: "slide 10: internodal pathways about 1 m/s" },
  muscleVelocity: { value: 0.4, source: "slide 13: atrial and ventricular muscle 0.3-0.5 m/s (midpoint)" },
  avDelayMs: { value: 100, source: "slides 5 and 11: delay of about 100 ms in the AV node" },
  purkinjeMs: { value: 30, source: "slide 12: total time in Purkinje fibres 0.03 s" },
  purkinjeVelocityMin: { value: 1.5, source: "slide 12: Purkinje conduction 1.5 to 4 m/s" },
  purkinjeVelocityMax: { value: 4, source: "slide 12: Purkinje conduction 1.5 to 4 m/s" },
  branchesToLastMuscleMs: { value: 60, source: "slide 13: initial bundle branches to final ventricular fibre about 0.06 s" },
  ventricularContractionMs: { value: 300, source: "slide 13: contraction continues for 0.3 s" },
};

const dist = (/** @type {Vec3} */ a, /** @type {Vec3} */ b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** Cumulative length (mm) at each point of a path. */
export function cumulative(/** @type {Vec3[]} */ path) {
  const out = [0];
  for (let i = 1; i < path.length; i++) out.push(out[i - 1] + dist(path[i - 1], path[i]));
  return out;
}

/**
 * @typedef {object} ConductionPaths
 * @property {Vec3[]} internodalAnterior
 * @property {Vec3[]} internodalMiddle
 * @property {Vec3[]} internodalPosterior
 * @property {Vec3[]} bachmann
 * @property {Vec3[]} his
 * @property {Vec3[]} rightBundle
 * @property {Vec3[]} leftBundle
 * @property {Vec3[]} leftAnterior
 * @property {Vec3[]} leftPosterior
 * @property {Vec3[][]} purkinjeLV
 * @property {Vec3[][]} purkinjeRV
 */

/**
 * Activation time (ms after the SA node fires) at every point of every path.
 * @param {ConductionPaths} paths  mm, from data/conduction-landmarks.json
 * @param {{ avDelayMs?: number, internodalVelocity?: number }} [opts]
 */
export function computeSchedule(paths, opts = {}) {
  const vIntern = opts.internodalVelocity ?? LECTURE.internodalVelocity.value;   // m/s = mm/ms
  const avDelay = opts.avDelayMs ?? LECTURE.avDelayMs.value;
  /** @type {Record<string, number[] | number[][]>} */
  const times = {};

  // Atria: SA -> AV node along the three internodal routes (1 m/s).
  const intern = ["internodalAnterior", "internodalMiddle", "internodalPosterior"];
  for (const k of intern) times[k] = cumulative(/** @type {any} */ (paths)[k]).map((d) => d / vIntern);
  const tAV = Math.min(...intern.map((k) => /** @type {number[]} */ (times[k]).at(-1) ?? 0));   // derived: first route to arrive
  // Bachmann's bundle leaves the anterior route where it starts, also at 1 m/s.
  const bStart = paths.internodalAnterior.reduce((bi, p, i) => (dist(p, paths.bachmann[0]) < dist(paths.internodalAnterior[bi], paths.bachmann[0]) ? i : bi), 0);
  const tB0 = /** @type {number[]} */ (times.internodalAnterior)[bStart];
  times.bachmann = cumulative(paths.bachmann).map((d) => tB0 + d / vIntern);

  // AV node delay, then the fast ventricular conduction system (His bundle,
  // bundle branches, Purkinje fibres). First measure every point's distance
  // (mm) from the start of the bundle branches along the system...
  const tHis = tAV + avDelay;
  /** @type {Record<string, number[] | number[][]>} */
  const d = {};
  const hisLen = cumulative(paths.his), hisTotal = hisLen.at(-1) ?? 0;
  d.his = hisLen.map((x) => x - hisTotal);                      // negative: before the branches
  d.rightBundle = cumulative(paths.rightBundle);
  d.leftBundle = cumulative(paths.leftBundle);
  const dSplit = /** @type {number[]} */ (d.leftBundle).at(-1) ?? 0;
  d.leftAnterior = cumulative(paths.leftAnterior).map((x) => dSplit + x);
  d.leftPosterior = cumulative(paths.leftPosterior).map((x) => dSplit + x);
  const fastPts = /** @type {{ p: Vec3, d: number }[]} */ ([]);
  for (const k of ["rightBundle", "leftBundle", "leftAnterior", "leftPosterior"]) {
    /** @type {any} */ (paths)[k].forEach((/** @type {Vec3} */ p, /** @type {number} */ i) => fastPts.push({ p, d: /** @type {number[]} */ (d[k])[i] }));
  }
  // Purkinje fibres start wherever the branches pass nearest their origin.
  const startD = (/** @type {Vec3} */ p) => fastPts.reduce((b, s) => (dist(s.p, p) < dist(b.p, p) ? s : b)).d;
  d.purkinjeLV = paths.purkinjeLV.map((path) => { const d0 = startD(path[0]); return cumulative(path).map((x) => d0 + x); });
  d.purkinjeRV = paths.purkinjeRV.map((path) => { const d0 = startD(path[0]); return cumulative(path).map((x) => d0 + x); });
  // ...then pick the speed that makes the farthest Purkinje ending arrive
  // purkinjeMs (about 30 ms, slide 12) after the branches start, kept inside
  // the lecture's 1.5-4 m/s range. Both lecture figures are approximate; if
  // they can't both hold for this heart's path lengths, the speed range wins
  // and the Purkinje time comes out "about" 30 ms instead. Derived speed.
  const farthest = Math.max(...[...d.purkinjeLV, ...d.purkinjeRV].map((x) => /** @type {number[]} */ (x).at(-1) ?? 0));
  const vFast = Math.min(LECTURE.purkinjeVelocityMax.value, Math.max(LECTURE.purkinjeVelocityMin.value, farthest / LECTURE.purkinjeMs.value));   // mm/ms = m/s
  const tBranch = tHis + hisTotal / vFast;
  for (const k of ["his", "rightBundle", "leftBundle", "leftAnterior", "leftPosterior"]) times[k] = /** @type {number[]} */ (d[k]).map((x) => tBranch + x / vFast);
  times.purkinjeLV = /** @type {number[][]} */ (d.purkinjeLV).map((row) => row.map((x) => tBranch + x / vFast));
  times.purkinjeRV = /** @type {number[][]} */ (d.purkinjeRV).map((row) => row.map((x) => tBranch + x / vFast));

  const tLastPurkinje = Math.max(...[...times.purkinjeLV, ...times.purkinjeRV].map((t) => /** @type {number[]} */ (t).at(-1) ?? 0));
  return {
    times, tAV, tHis, tBranch, tLastPurkinje,
    tLastVentricle: tBranch + LECTURE.branchesToLastMuscleMs.value,
    vFast,
  };
}

/**
 * Activation time for each surface point: the earliest a wave can arrive from
 * any source point travelling through muscle at `velocity` (mm/ms).
 * If `lastMs` is given, the muscle part is scaled so the last point activates
 * exactly then (used to enforce the lecture's ventricular timing).
 * @param {Float32Array | number[]} positions  flat xyz
 * @param {{ p: Vec3, t: number }[]} sources
 * @param {number} velocity
 * @param {number} [lastMs]
 * @returns {Float32Array}
 */
export function activationTimes(positions, sources, velocity, lastMs) {
  const n = positions.length / 3, base = new Float32Array(n), extra = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = /** @type {Vec3} */ ([positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]);
    let best = Infinity, bestBase = 0;
    for (const s of sources) {
      const t = s.t + dist(v, s.p) / velocity;
      if (t < best) { best = t; bestBase = s.t; }
    }
    base[i] = bestBase; extra[i] = best - bestBase;
  }
  const out = new Float32Array(n);
  let k = 1;
  if (lastMs !== undefined) {
    let maxT = -Infinity, iMax = 0;
    for (let i = 0; i < n; i++) if (base[i] + extra[i] > maxT) { maxT = base[i] + extra[i]; iMax = i; }
    k = extra[iMax] > 0 ? (lastMs - base[iMax]) / extra[iMax] : 1;
  }
  for (let i = 0; i < n; i++) out[i] = base[i] + extra[i] * k;
  return out;
}

/**
 * The six stages of one beat, as on slide 5, with start times (ms).
 * @param {ReturnType<typeof computeSchedule>} s
 */
export function stages(s) {
  return [
    { id: "rest", start: -80, title: "At rest", text: "The SA node and the rest of the conduction system are at rest, waiting for the next beat." },
    { id: "atria", start: 0, title: "SA node fires", text: "The SA node starts an action potential. It spreads across both atria, and along the internodal pathways to the AV node." },
    { id: "av", start: s.tAV, title: "Delay at the AV node", text: "The impulse reaches the AV node and is held for about 100 ms, so the atria can finish pushing blood into the ventricles." },
    { id: "bundle", start: s.tHis, title: "Bundle of His and bundle branches", text: "After the delay the impulse runs through the AV bundle (bundle of His) and down the left and right bundle branches to the Purkinje fibres." },
    { id: "purkinje", start: s.tBranch, title: "Purkinje fibres and ventricular muscle", text: "The fast Purkinje fibres spread the impulse over the inside of both ventricles, and it passes into the ventricular muscle." },
    { id: "contract", start: s.tLastVentricle, title: "Ventricles contract", text: "All of the ventricular muscle is excited within a few hundredths of a second, so the ventricles contract together." },
  ];
}
