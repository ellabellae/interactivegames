// Builds apps/anatomy/models/bodyparts3d-heart/heart.glb from BodyParts3D.
//
// Source: BodyParts3D 4.0, PART-OF tree, polygon mesh (OBJ) set
//   https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/partof_BP3D_4.0_obj_99.zip
//   © The Database Center for Life Science (DBCLS), CC BY-SA 2.1 Japan.
// Neither file is stored in this repo. Download both into one folder:
//   partof_BP3D_4.0_obj_99.zip  (unzip it there)
//   https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/partof_element_parts.txt
// then run:
//
//   node scripts/build-heart-model.mjs <that folder>/partof_BP3D_4.0_obj_99
//
// What this script changes (required by the licence to be stated):
// - selects the heart pieces listed in PARTS and groups them into named parts
// - trims the great vessels to a box around the heart (they continue into the
//   lungs and abdomen in the source)
// - rotates from BodyParts3D axes (x = patient's left, y = posterior,
//   z = superior, millimetres) to three.js axes (y up, z toward the viewer),
//   a pure rotation with no mirroring
// - welds shared vertices per part and adds smooth normals
// - writes one GLB whose top-level nodes are the named parts, which the
//   viewer's existing GLB loader lists as separate, grabbable parts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

// Display name -> BodyParts3D element files (FJ ids), from partof_element_parts.txt.
// Names are chosen so the viewer colours them correctly: see colorFor() in viewer.js.
const PARTS = {
  // chambers. Atria: wall surface. Ventricles: BodyParts3D models these as the
  // chamber cavity surface (there is no separate ventricular wall piece in this set).
  "Right atrium": ["FJ2439"],
  "Left atrium": ["FJ2438"],
  "Right ventricle": ["FJ2423"],
  "Left ventricle": ["FJ2422"],
  // valves (each cusp / leaflet is a separate source piece)
  "Tricuspid valve": ["FJ2421", "FJ2433", "FJ2436"],
  "Mitral valve": ["FJ2420", "FJ2432"],
  "Pulmonary valve": ["FJ2417", "FJ2427", "FJ2434"],
  "Aortic valve": ["FJ2426", "FJ2431", "FJ2435"],
  // papillary muscles
  "Right ventricle papillary muscles": ["FJ2419", "FJ2430", "FJ2437"],
  "Left ventricle papillary muscles": ["FJ2418", "FJ2429"],
  // coronary arteries
  "Right coronary artery": ["FJ2723", "FJ2670", "FJ2676", "FJ2671", "FJ2673", "FJ2677", "FJ2714", "FJ2715", "FJ2716", "FJ2717", "FJ2718", "FJ2719", "FJ2720", "FJ2721", "FJ2722"],
  "Right marginal artery": ["FJ2667", "FJ2668", "FJ2672", "FJ2674", "FJ2675"],
  "Posterior descending artery": ["FJ2692", "FJ2693", "FJ2694", "FJ2695", "FJ2696", "FJ2697", "FJ2698", "FJ2699", "FJ2700"],
  "Left main coronary artery": ["FJ2737"],
  "Left anterior descending artery": ["FJ2631", "FJ2632", "FJ2633", "FJ2634", "FJ2635", "FJ2636", "FJ2637", "FJ2638", "FJ2639", "FJ2640", "FJ2641", "FJ2642", "FJ2643", "FJ2644", "FJ2645", "FJ2646", "FJ2647", "FJ2648"],
  "Circumflex artery": ["FJ2649", "FJ2650", "FJ2651", "FJ2652", "FJ2653", "FJ2654"],
  // cardiac veins
  "Coronary sinus and cardiac veins": ["FJ2655", "FJ2656", "FJ2724", "FJ2731", "FJ2727", "FJ2728", "FJ2729"],
  // great vessels (trimmed to the box around the heart)
  "Ascending aorta": ["FJ3413"],
  "Aortic arch": ["FJ3411"],
  "Descending aorta": ["FJ1931"],
  "Superior vena cava": ["FJ3645"],
  "Inferior vena cava": ["FJ3441"],
  "Pulmonary trunk": ["FJ2966"],
};
// Pulmonary artery and vein pieces are chosen automatically: those touching the
// heart's bounding box, from these BodyParts3D concepts.
const AUTO = {
  "Pulmonary arteries": ["FMA50873", "FMA50872"],   // left, right pulmonary artery
  "Pulmonary veins": ["FMA49911", "FMA49913", "FMA49914", "FMA49916"],
};
const VESSELS = new Set(["Ascending aorta", "Aortic arch", "Descending aorta", "Superior vena cava", "Inferior vena cava", "Pulmonary trunk"]);
const HEART_PIECES = Object.entries(PARTS).filter(([n]) => !VESSELS.has(n)).flatMap(([, v]) => v);
const MARGIN_MM = 25;          // how far past the heart the great vessels are kept
const PULMONARY_MARGIN_MM = 12; // pulmonary arteries/veins branch into the lungs: keep only their roots

const src = resolve(process.argv[2] ?? "");
const out = resolve(import.meta.dirname, "../apps/anatomy/models/bodyparts3d-heart");
if (!process.argv[2]) { console.error("usage: node scripts/build-heart-model.mjs <partof_BP3D_4.0_obj_99 folder>"); process.exit(1); }

/** Parse an OBJ into { v: [[x,y,z]], f: [[a,b,c]] } (0-based, triangles). */
function readObj(fj) {
  const v = [], f = [];
  for (const line of readFileSync(join(src, `${fj}.obj`), "utf8").split("\n")) {
    if (line.startsWith("v ")) v.push(line.trim().split(/\s+/).slice(1, 4).map(Number));
    else if (line.startsWith("f ")) {
      const idx = line.trim().split(/\s+/).slice(1).map((t) => parseInt(t, 10) - 1);
      for (let k = 1; k + 1 < idx.length; k++) f.push([idx[0], idx[k], idx[k + 1]]);
    }
  }
  return { v, f };
}
const bbox = (pieces) => {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const { v } of pieces) for (const p of v) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], p[i]); mx[i] = Math.max(mx[i], p[i]); }
  return { mn, mx };
};

// Heart box, expanded by the margin: vessels are trimmed to it.
const heart = bbox(HEART_PIECES.map(readObj));
const boxFor = (m) => ({ mn: heart.mn.map((x) => x - m), mx: heart.mx.map((x) => x + m) });
const inBox = (p, box) => p.every((x, i) => x >= box.mn[i] && x <= box.mx[i]);

// Resolve AUTO groups from the BodyParts3D element list next to the OBJ folder.
const elementList = readFileSync(resolve(src, "../partof_element_parts.txt"), "utf8");
for (const [name, concepts] of Object.entries(AUTO)) {
  const fjs = new Set(elementList.split("\n").map((l) => l.split("\t")).filter((c) => concepts.includes(c[0])).map((c) => c[2]?.trim()));
  PARTS[name] = [...fjs].filter((fj) => {
    const b = bbox([readObj(fj)]);
    return b.mn.every((x, i) => x <= heart.mx[i] + 10) && b.mx.every((x, i) => x >= heart.mn[i] - 10);
  }).sort();
}

/** Merge pieces into one welded, trimmed, rotated, indexed mesh with normals. */
function buildPart(fjs, box) {
  const pos = [], idx = [], key = new Map();
  for (const fj of fjs) {
    const { v, f } = readObj(fj);
    for (const tri of f) {
      if (box) { const c = [0, 1, 2].map((i) => (v[tri[0]][i] + v[tri[1]][i] + v[tri[2]][i]) / 3); if (!inBox(c, box)) continue; }
      for (const vi of tri) {
        const [x, y, z] = v[vi];
        const k = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;   // weld identical positions
        let n = key.get(k);
        if (n === undefined) { n = pos.length / 3; key.set(k, n); pos.push(x, z, -y); }   // rotate: (x, y, z) -> (x, z, -y)
        idx.push(n);
      }
    }
  }
  // smooth normals, area-weighted
  const nrm = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
    const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]], e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const o of [a, b, c]) for (let i = 0; i < 3; i++) nrm[o + i] += n[i];
  }
  for (let i = 0; i < nrm.length; i += 3) { const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1; nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l; }
  return { pos: new Float32Array(pos), nrm, idx: new Uint32Array(idx) };
}

// ---- write GLB
const chunks = [], json = {
  asset: {
    version: "2.0", generator: "heart-hands scripts/build-heart-model.mjs",
    copyright: "BodyParts3D, © The Database Center for Life Science, licensed under CC Attribution-Share Alike 2.1 Japan. Modified: selected, grouped, trimmed, rotated, welded; normals added.",
  },
  scene: 0, scenes: [{ name: "BodyParts3D heart", nodes: [] }], nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [],
};
let offset = 0;
const view = (arr, target) => {
  const bytes = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  chunks.push(bytes); const pad = (4 - (bytes.length % 4)) % 4; if (pad) chunks.push(Buffer.alloc(pad));
  json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
  offset += bytes.length + pad; return json.bufferViews.length - 1;
};
const manifest = { source: "BodyParts3D 4.0, partof_BP3D_4.0_obj_99.zip", marginMm: MARGIN_MM, pulmonaryMarginMm: PULMONARY_MARGIN_MM, parts: {} };
let totalTris = 0;
for (const [name, fjs] of Object.entries(PARTS)) {
  const trim = !HEART_PIECES.includes(fjs[0]);
  const m = buildPart(fjs, trim ? boxFor(name in AUTO ? PULMONARY_MARGIN_MM : MARGIN_MM) : null);
  if (!m.idx.length) continue;
  const mn = [0, 1, 2].map((i) => Math.min(...m.pos.filter((_, k) => k % 3 === i)));
  const mx = [0, 1, 2].map((i) => Math.max(...m.pos.filter((_, k) => k % 3 === i)));
  const a = json.accessors.length;
  json.accessors.push(
    { bufferView: view(m.pos, 34962), componentType: 5126, count: m.pos.length / 3, type: "VEC3", min: mn, max: mx },
    { bufferView: view(m.nrm, 34962), componentType: 5126, count: m.nrm.length / 3, type: "VEC3" },
    { bufferView: view(m.idx, 34963), componentType: 5125, count: m.idx.length, type: "SCALAR" },
  );
  json.meshes.push({ name, primitives: [{ attributes: { POSITION: a, NORMAL: a + 1 }, indices: a + 2 }] });
  json.nodes.push({ name, mesh: json.meshes.length - 1 });
  json.scenes[0].nodes.push(json.nodes.length - 1);
  manifest.parts[name] = { elements: fjs, trimmed: trim, triangles: m.idx.length / 3 };
  totalTris += m.idx.length / 3;
}
const bin = Buffer.concat(chunks);
json.buffers.push({ byteLength: bin.length });
let jsonBuf = Buffer.from(JSON.stringify(json));
jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
jh.writeUInt32LE(jsonBuf.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "heart.glb"), Buffer.concat([header, jh, jsonBuf, bh, bin]));
manifest.totalTriangles = totalTris;
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`wrote ${Object.keys(manifest.parts).length} parts, ${totalTris} triangles, ${(12 + 16 + jsonBuf.length + bin.length) / 1e6} MB`);
