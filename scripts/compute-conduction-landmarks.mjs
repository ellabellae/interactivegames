// Places the cardiac conduction system on the realistic heart.
//
// BodyParts3D has no conduction-system structures, so they are placed here
// from anatomical landmarks that ARE in the model, using the textbook
// descriptions of where each lies. Every rule is written next to the code so
// a teacher can check the reasoning, not just the picture.
//
//   node scripts/compute-conduction-landmarks.mjs
//
// Reads  apps/anatomy/models/bodyparts3d-heart/heart.glb
// Writes apps/physiology/data/conduction-landmarks.json (model coordinates, mm)
//
// Axes (from build-heart-model.mjs): x = patient's left, y = superior,
// z = anterior (toward the viewer in the default view).
//
// THIS IS AN APPROXIMATION FOR TEACHING. It shows where the structures are
// and the order the impulse reaches them, not their exact microscopic course.
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { readGlb, points, centroid, dist, nearest, lerp, add, sub, mul } from "./lib-glb.mjs";

const root = resolve(import.meta.dirname, "..");
const P = readGlb(resolve(root, "apps/anatomy/models/bodyparts3d-heart/heart.glb"));
const V = (name) => points(P[name]);
const RA = V("Right atrium"), LA = V("Left atrium"), RV = V("Right ventricle"), LV = V("Left ventricle");
const SVC = V("Superior vena cava"), CS = V("Coronary sinus"), TV = V("Tricuspid valve"), MV = V("Mitral valve"), AoV = V("Aortic valve");
const RVpap = V("Right ventricle papillary muscles"), LVpap = V("Left ventricle papillary muscles");
const round = (p) => p.map((x) => Math.round(x * 10) / 10);
const norm = (v) => mul(v, 1 / (Math.hypot(...v) || 1));

/**
 * Resample a path into points about `step` mm apart, each snapped onto a
 * surface, then smoothed. The surfaces are coarse (vertices several mm apart),
 * so snapping alone makes a zigzag about twice the real length; smoothing
 * (ends fixed) takes out the zigzag while keeping the path on the wall.
 */
function onSurface(ctrl, surface, step = 3) {
  let out = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const n = Math.max(1, Math.ceil(dist(ctrl[i], ctrl[i + 1]) / step));
    for (let k = 0; k < n; k++) out.push(nearest(surface, lerp(ctrl[i], ctrl[i + 1], k / n)));
  }
  out.push(nearest(surface, ctrl[ctrl.length - 1]));
  out = out.filter((p, i) => i === 0 || dist(p, out[i - 1]) > 0.01);
  for (let it = 0; it < 6; it++) out = out.map((p, i) => (i === 0 || i === out.length - 1 ? p : mul(add(add(out[i - 1], mul(p, 2)), out[i + 1]), 0.25)));
  return out.map(round);
}
/** Split points into k clusters (k-means, fixed start = spread along an axis). */
function kmeans(pts, k, axis) {
  let c = [...pts].sort((a, b) => a[axis] - b[axis]).filter((_, i, arr) => i % Math.floor(arr.length / k) === 0).slice(0, k);
  for (let it = 0; it < 20; it++) {
    const groups = c.map(() => []);
    for (const p of pts) groups[c.reduce((bi, q, i) => (dist(p, q) < dist(p, c[bi]) ? i : bi), 0)].push(p);
    c = groups.map((g, i) => (g.length ? centroid(g) : c[i]));
  }
  return c;
}

const rule = {};

// SA node: in the wall of the right atrium where the superior vena cava joins
// it, on the lateral (patient's right) and anterior side (sulcus terminalis).
const svcLow = Math.min(...SVC.map((p) => p[1]));
const svcMouth = centroid(SVC.filter((p) => p[1] < svcLow + 4));
const sa = nearest(RA, add(svcMouth, [-8, -4, 4]));
rule.sa = "Right atrial wall nearest a point 8 mm lateral, 4 mm below and 4 mm anterior to the centre of the SVC's opening (SVC-RA junction, sulcus terminalis).";

// Coronary sinus opening: the end of the coronary sinus nearest the tricuspid valve.
const tvC = centroid(TV);
const csTip = nearest(CS, tvC);
const csOstium = centroid(CS.filter((p) => dist(p, csTip) < 5));
rule.csOstium = "End of the coronary sinus nearest the tricuspid valve (where it opens into the right atrium).";

// AV node: apex of the triangle of Koch, in the atrial septum between the
// coronary sinus opening and the septal leaflet of the tricuspid valve, toward
// the central fibrous body (next to the aortic valve).
const tvSeptal = nearest(TV, centroid(AoV));
const av = nearest(RA, lerp(csOstium, tvSeptal, 0.6));
rule.av = "Right atrial wall 60% of the way from the coronary sinus opening to the part of the tricuspid valve nearest the aortic valve (apex of the triangle of Koch).";

// Interventricular septum: where the left and right ventricular cavities face
// each other, taken as midpoints of close LV-RV vertex pairs.
const septum = [];
for (const p of LV) { const q = nearest(RV, p); if (dist(p, q) < 14) septum.push(lerp(p, q, 0.5)); }
const mvC = centroid(MV);
const apex = LV.reduce((a, p) => (dist(p, mvC) > dist(a, mvC) ? p : a), LV[0]);
rule.apex = "Point of the left ventricle farthest from the mitral valve.";
const axis = norm(sub(apex, mvC));
const along = (p) => (p[0] - mvC[0]) * axis[0] + (p[1] - mvC[1]) * axis[1] + (p[2] - mvC[2]) * axis[2];
const septumSorted = septum.sort((a, b) => along(a) - along(b));
const crest = centroid(septumSorted.slice(0, Math.max(3, Math.floor(septumSorted.length * 0.1))));
rule.septum = `Midpoints of left/right ventricular cavity points less than 14 mm apart (${septum.length} points). Crest = the 10% of those nearest the base.`;

// Bundle of His: from the AV node through the central fibrous body to the
// crest of the interventricular septum, just below the aortic valve.
const his = [av, lerp(av, centroid(AoV), 0.35), crest].map(round);
rule.his = "AV node -> toward the aortic valve (central fibrous body) -> crest of the septum.";

// Right bundle branch: down the right side of the septum toward the apex, then
// through the moderator band to the anterior papillary muscle of the RV.
const rvPapTargets = kmeans(RVpap, 3, 2);
const rvAnteriorPap = rvPapTargets.reduce((a, p) => (p[2] > a[2] ? p : a));
const septalMid = (t) => centroid(septumSorted.filter((p) => { const a = along(p) / along(apex); return a > t - 0.1 && a < t + 0.1; }));
const rightBundle = onSurface([crest, septalMid(0.4), septalMid(0.7), rvAnteriorPap], RV);
rule.rightBundle = "Along the RV side of the septum (snapped to the RV cavity surface) to the most anterior RV papillary muscle (moderator band).";

// Left bundle branch: down the left side of the septum, splitting into an
// anterior fascicle (to the anterolateral papillary muscle) and a posterior
// fascicle (to the posteromedial papillary muscle).
const [lvPapA, lvPapB] = kmeans(LVpap, 2, 2);
const lvAnt = lvPapA[2] > lvPapB[2] ? lvPapA : lvPapB, lvPost = lvPapA[2] > lvPapB[2] ? lvPapB : lvPapA;
const lbSplit = septalMid(0.3);
const leftBundle = onSurface([crest, lbSplit], LV);
const leftAnterior = onSurface([lbSplit, septalMid(0.6), lvAnt], LV);
const leftPosterior = onSurface([lbSplit, lerp(septalMid(0.6), lvPost, 0.5), lvPost], LV);
rule.leftBundle = "Along the LV side of the septum; splits a third of the way down into anterior and posterior fascicles running to the two LV papillary muscle groups.";

// Purkinje fibres: spread from the ends of the bundle branches over the inner
// (endocardial) surface of each ventricle, from the apex up toward the base.
function purkinje(cavity, starts, n) {
  const c = centroid(cavity), paths = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    // target: a cavity point around the long axis, two thirds of the way to the base
    const ring = cavity.filter((p) => { const t = along(p) / along(apex); return t > 0.2 && t < 0.45; });
    const dir = [Math.cos(a), 0, Math.sin(a)];
    const target = ring.reduce((b, p) => { const d = sub(p, c); return d[0] * dir[0] + d[2] * dir[2] > sub(b, c)[0] * dir[0] + sub(b, c)[2] * dir[2] ? p : b; }, ring[0]);
    const start = starts.reduce((b, s) => (dist(s, target) < dist(b, target) ? s : b));
    paths.push(onSurface([start, lerp(start, target, 0.5), target], cavity, 4));
  }
  return paths;
}
const purkinjeLV = purkinje(LV, [leftAnterior.at(-1), leftPosterior.at(-1), round(apex)], 10);
const purkinjeRV = purkinje(RV, [rightBundle.at(-1), round(nearest(RV, apex))], 8);
rule.purkinje = "From the nearest bundle-branch end or the apex, over the ventricular cavity (endocardial) surface toward the base, spread around the long axis.";

// Internodal pathways: three routes across the right atrium from the SA node
// to the AV node (anterior, middle, posterior), plus Bachmann's bundle from
// the anterior route across to the left atrium.
const mid = lerp(sa, av, 0.5);
const internodal = {
  anterior: onSurface([sa, add(mid, [4, 4, 14]), av], RA),
  middle: onSurface([sa, mid, av], RA),
  posterior: onSurface([sa, add(mid, [-6, -4, -14]), av], RA),
};
const laTarget = LA.filter((p) => p[1] > centroid(LA)[1]).reduce((b, p) => (dist(p, sa) < dist(b, sa) ? p : b));
const bachmann = onSurface([internodal.anterior[Math.floor(internodal.anterior.length / 3)], laTarget, add(laTarget, [15, 0, -5])], [...RA, ...LA]);
rule.internodal = "Anterior, middle and posterior routes from SA to AV node over the right atrial wall; Bachmann's bundle branches from the anterior route across the roof to the left atrium.";

const out = {
  note: "Computed by scripts/compute-conduction-landmarks.mjs from the BodyParts3D heart. Approximate positions for teaching; not an exact anatomical course.",
  units: "mm, model coordinates (x = patient's left, y = superior, z = anterior)",
  landmarks: { sa: round(sa), av: round(av), csOstium: round(csOstium), hisEnd: round(crest), apex: round(apex) },
  paths: {
    internodalAnterior: internodal.anterior, internodalMiddle: internodal.middle, internodalPosterior: internodal.posterior, bachmann,
    his, rightBundle, leftBundle, leftAnterior, leftPosterior, purkinjeLV, purkinjeRV,
  },
  rules: rule,
};
mkdirSync(resolve(root, "apps/physiology/data"), { recursive: true });
writeFileSync(resolve(root, "apps/physiology/data/conduction-landmarks.json"), JSON.stringify(out, null, 1) + "\n");
const len = (pts) => pts.reduce((s, p, i) => (i ? s + dist(p, pts[i - 1]) : 0), 0);
console.log("landmarks", out.landmarks);
console.log("SA->AV", dist(sa, av).toFixed(1), "mm | internodal lengths", Object.values(internodal).map((p) => len(p).toFixed(0)).join("/"), "mm | septum pts", septum.length);
console.log("his", len(his).toFixed(0), "mm | RBB", len(rightBundle).toFixed(0), "| LBB", len(leftBundle).toFixed(0), "+", len(leftAnterior).toFixed(0), "/", len(leftPosterior).toFixed(0), "mm | purkinje LV", purkinjeLV.length, "RV", purkinjeRV.length);
