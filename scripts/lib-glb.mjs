// Minimal reader for the GLB files this repo writes (scripts/build-heart-model.mjs):
// returns { name -> { pos: Float32Array, idx: Uint32Array } } per top-level node.
import { readFileSync } from "node:fs";

export function readGlb(path) {
  const buf = readFileSync(path);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  const binStart = 20 + jsonLen + 8;
  const view = (accIdx, Type) => {
    const acc = json.accessors[accIdx], bv = json.bufferViews[acc.bufferView];
    const comps = acc.type === "VEC3" ? 3 : 1;
    return new Type(buf.buffer.slice(buf.byteOffset + binStart + (bv.byteOffset ?? 0), buf.byteOffset + binStart + (bv.byteOffset ?? 0) + acc.count * comps * Type.BYTES_PER_ELEMENT));
  };
  const parts = {};
  for (const node of json.nodes) {
    const prim = json.meshes[node.mesh].primitives[0];
    parts[node.name] = { pos: view(prim.attributes.POSITION, Float32Array), idx: view(prim.indices, Uint32Array) };
  }
  return parts;
}

/** Vertices of a part as [x, y, z] arrays. */
export const points = (part) => Array.from({ length: part.pos.length / 3 }, (_, i) => [part.pos[i * 3], part.pos[i * 3 + 1], part.pos[i * 3 + 2]]);
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const lerp = (a, b, t) => add(a, mul(sub(b, a), t));
export const centroid = (pts) => mul(pts.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / pts.length);
export const nearest = (pts, q) => pts.reduce((best, p) => (dist(p, q) < dist(best, q) ? p : best), pts[0]);
