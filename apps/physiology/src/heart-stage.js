// The 3D stage for physiology lessons: the realistic heart, the conduction
// system drawn inside it, and tissue that changes colour as the impulse
// reaches it. Time is set from outside with stage.setTime(ms).
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import heartUrl from "../../anatomy/models/bodyparts3d-heart/heart.glb?url";
import landmarks from "../data/conduction-landmarks.json";
import { ASSUMED, LECTURE, activationTimes, computeSchedule } from "./conduction-model.js";

const MODEL_SIZE = 2.3;
const ACTIVE = new THREE.Color(0xb44cff);   // depolarised muscle (purple, as in the lecture's diagrams)
const PATH_REST = new THREE.Color(0x7a6a24), PATH_ACTIVE = new THREE.Color(0xffe14a);   // conduction system (yellow)

// Resting muscle is a neutral colour so the purple of depolarised muscle
// stands out (the lecture's slide 5 uses white for rest, purple for active).
const REST = 0xd8c3bd;
const CHAMBERS = {
  "Right atrium": { color: REST, kind: "atria" },
  "Left atrium": { color: REST, kind: "atria" },
  "Right ventricle": { color: REST, kind: "ventricles" },
  "Left ventricle": { color: REST, kind: "ventricles" },
  "Right ventricle papillary muscles": { color: REST, kind: "ventricles" },
  "Left ventricle papillary muscles": { color: REST, kind: "ventricles" },
};

/**
 * Standard material plus an activation colour. Per vertex `aAct` (ms) says
 * when that point is reached; it shows the active colour from then until
 * `uEnd`, with a brighter leading edge for the first ~18 ms.
 */
function activationMaterial(color, { opacity = 1, active = ACTIVE, basic = false } = {}) {
  const Mat = basic ? THREE.MeshBasicMaterial : THREE.MeshStandardMaterial;
  const m = new Mat({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, ...(basic ? {} : { roughness: 0.55, metalness: 0.05 }) });
  const uniforms = { uTime: { value: -1e4 }, uEnd: { value: 1e9 }, uActive: { value: active } };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aAct;\nvarying float vAct;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvAct = aAct;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uTime; uniform float uEnd; uniform vec3 uActive; varying float vAct;")
      .replace("#include <color_fragment>", `#include <color_fragment>
        float on = step(vAct, uTime) * step(uTime, uEnd);
        float front = on * (1.0 - smoothstep(0.0, 18.0, uTime - vAct));
        diffuseColor.rgb = mix(diffuseColor.rgb, uActive, on * 0.8);
        diffuseColor.rgb += vec3(front * 0.35);`);
  };
  return m;
}

/** A tube along a path whose vertices carry the path's activation times. */
function pathTube(points, times, radius) {
  const pts = points.map((p) => new THREE.Vector3(...p));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const total = cum.at(-1) || 1, segs = Math.max(8, pts.length * 4), radial = 8;
  const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segs, radius, radial, false);
  const timeAt = (u) => {   // u: 0..1 along the arc length
    const d = u * total; let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const f = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    return times[i - 1] + (times[i] - times[i - 1]) * Math.min(1, Math.max(0, f));
  };
  const act = new Float32Array(geo.attributes.position.count);
  for (let i = 0; i <= segs; i++) for (let j = 0; j <= radial; j++) act[i * (radial + 1) + j] = timeAt(i / segs);
  geo.setAttribute("aAct", new THREE.BufferAttribute(act, 1));
  return geo;
}

export async function createHeartStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 0, 3.6);
  scene.add(new THREE.HemisphereLight(0xfff3ef, 0x3a1a1c, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(2, 3, 4); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffd9d0, 0.5); fill.position.set(-3, -1, 2); scene.add(fill);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enablePan = false; orbit.enableDamping = true; orbit.minDistance = 2; orbit.maxDistance = 10;

  const schedule = computeSchedule(landmarks.paths);
  const gltf = await new GLTFLoader().loadAsync(heartUrl);
  const heart = gltf.scene;
  const box = new THREE.Box3().setFromObject(heart), size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
  const root = new THREE.Group();   // model coordinates (mm) inside, normalised outside
  const s = MODEL_SIZE / Math.max(size.x, size.y, size.z);
  root.scale.setScalar(s); root.position.copy(centre).multiplyScalar(-s);
  root.add(heart); scene.add(root);

  // ---- muscle: activation times per vertex
  const atrialSources = [], ventSources = [];
  const pushPath = (arr, pts, ts) => pts.forEach((p, i) => arr.push({ p, t: ts[i] }));
  for (const k of ["internodalAnterior", "internodalMiddle", "internodalPosterior", "bachmann"]) pushPath(atrialSources, landmarks.paths[k], schedule.times[k]);
  for (const k of ["rightBundle", "leftBundle", "leftAnterior", "leftPosterior"]) pushPath(ventSources, landmarks.paths[k], schedule.times[k]);
  landmarks.paths.purkinjeLV.forEach((p, i) => pushPath(ventSources, p, schedule.times.purkinjeLV[i]));
  landmarks.paths.purkinjeRV.forEach((p, i) => pushPath(ventSources, p, schedule.times.purkinjeRV[i]));

  const muscle = { atria: [], ventricles: [] }, other = [];
  heart.children.forEach((o) => {
    const name = o.name.replace(/_/g, " ");
    o.name = name;
    const c = CHAMBERS[name];
    if (!c) { other.push(o); return; }
    const pos = o.geometry.attributes.position.array;
    const act = c.kind === "atria"
      ? activationTimes(pos, atrialSources, LECTURE.muscleVelocity.value, ASSUMED.atrialActivationMs.value)
      : activationTimes(pos, ventSources, LECTURE.muscleVelocity.value, schedule.tLastVentricle);
    o.geometry.setAttribute("aAct", new THREE.BufferAttribute(act, 1));
    o.material = activationMaterial(c.color, { opacity: 0.35 });
    // Atria return to rest once the ventricles take over (atrial repolarisation
    // is hidden in the ventricular wave); ventricles stay active through
    // their ~0.3 s contraction (slide 13).
    o.material.userData.uniforms.uEnd.value = c.kind === "atria" ? schedule.tBranch + 20 : 1e9;
    o.renderOrder = 2;
    const g = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
    muscle[c.kind].push({ mesh: o, centre: g });
  });
  // everything else (valves, vessels, coronaries) faint, so the inside shows
  const faint = new THREE.MeshStandardMaterial({ color: 0x8a8a90, transparent: true, opacity: 0.12, depthWrite: false });
  other.forEach((o) => { o.material = faint; o.renderOrder = 3; });

  // ---- conduction system
  const conduction = new THREE.Group(); root.add(conduction);
  const pathMat = () => activationMaterial(PATH_REST, { active: PATH_ACTIVE, basic: true });
  const mats = [];
  const addPath = (pts, ts, r) => { const m = pathMat(); mats.push(m); const mesh = new THREE.Mesh(pathTube(pts, ts, r), m); mesh.renderOrder = 1; conduction.add(mesh); };
  for (const k of ["internodalAnterior", "internodalMiddle", "internodalPosterior", "bachmann"]) addPath(landmarks.paths[k], schedule.times[k], 0.8);
  addPath(landmarks.paths.his, schedule.times.his, 1.4);
  for (const k of ["rightBundle", "leftBundle", "leftAnterior", "leftPosterior"]) addPath(landmarks.paths[k], schedule.times[k], 1.1);
  landmarks.paths.purkinjeLV.forEach((p, i) => addPath(p, schedule.times.purkinjeLV[i], 0.55));
  landmarks.paths.purkinjeRV.forEach((p, i) => addPath(p, schedule.times.purkinjeRV[i], 0.55));
  // nodes: SA lights when it fires; AV glows for the whole delay
  const node = (p, r, t0, t1) => {
    const g = new THREE.SphereGeometry(r, 20, 14);
    g.setAttribute("aAct", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(t0), 1));
    const m = pathMat(); m.userData.uniforms.uEnd.value = t1; mats.push(m);
    const mesh = new THREE.Mesh(g, m); mesh.position.set(...p); mesh.renderOrder = 1; conduction.add(mesh); return mesh;
  };
  node(landmarks.landmarks.sa, 3, 0, 60);
  const avNode = node(landmarks.landmarks.av, 2.8, schedule.tAV, schedule.tHis + 10);

  // ---- labels
  const L = landmarks.paths;
  const mid = (pts) => pts[Math.floor(pts.length / 2)];
  const labelDefs = [
    ["SA node", landmarks.landmarks.sa], ["AV node", landmarks.landmarks.av], ["Bundle of His", mid(L.his)],
    ["Internodal pathways", mid(L.internodalPosterior)], ["Bachmann's bundle", L.bachmann.at(-1)],
    ["Right bundle branch", L.rightBundle[Math.floor(L.rightBundle.length * 0.75)]], ["Left bundle branch", L.leftBundle[0]],
    ["Purkinje fibres", L.purkinjeLV.reduce((b, p) => (p.at(-1)[0] > b.at(-1)[0] ? p : b)).at(-1)],   // end of the most leftward LV fibre
  ];
  const labels = labelDefs.map(([text, p]) => {
    const el = document.createElement("div"); el.className = "label"; el.textContent = text; document.body.appendChild(el);
    return { el, p: new THREE.Vector3(...p) };
  });
  let labelsOn = true;

  // ---- contraction (small squeeze, so timing is visible without distorting anatomy)
  const squeeze = (t, start, rise, hold, fall) => (t < start ? 0 : t < start + rise ? (t - start) / rise : t < start + rise + hold ? 1 : Math.max(0, 1 - (t - start - rise - hold) / fall));
  let time = -80;
  function setTime(t) {
    time = t;
    for (const k of ["atria", "ventricles"]) for (const { mesh } of muscle[k]) mesh.material.userData.uniforms.uTime.value = t;
    mats.forEach((m) => (m.userData.uniforms.uTime.value = t));
    // atria contract during the AV delay (slide 5, stage 3); ventricles after activation, for ~0.3 s (slide 13)
    const a = 0.05 * squeeze(t, schedule.tAV, 60, 30, 80);
    const v = 0.05 * squeeze(t, schedule.tLastVentricle, 60, LECTURE.ventricularContractionMs.value - 120, 60);
    for (const { mesh, centre } of muscle.atria) { mesh.scale.setScalar(1 - a); mesh.position.copy(centre).multiplyScalar(a); }
    for (const { mesh, centre } of muscle.ventricles) { mesh.scale.setScalar(1 - v); mesh.position.copy(centre).multiplyScalar(v); }
    const pulse = t >= schedule.tAV && t < schedule.tHis ? 1 + 0.25 * Math.abs(Math.sin((t - schedule.tAV) / 12)) : 1;
    avNode.scale.setScalar(pulse);
  }

  const tmp = new THREE.Vector3();
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  addEventListener("resize", resize); resize();
  function render() {
    orbit.update();
    renderer.render(scene, camera);
    const r = canvas.getBoundingClientRect();
    for (const l of labels) {
      l.el.hidden = !labelsOn;
      if (!labelsOn) continue;
      tmp.copy(l.p); root.localToWorld(tmp); tmp.project(camera);
      l.el.style.left = r.left + ((tmp.x + 1) / 2) * r.width + "px";
      l.el.style.top = r.top + ((1 - tmp.y) / 2) * r.height + "px";
    }
  }
  setTime(time);

  return {
    schedule, setTime, render,
    get time() { return time; },
    setLabels(on) { labelsOn = on; },
    setWalls(opacity) { for (const k of ["atria", "ventricles"]) for (const { mesh } of muscle[k]) { mesh.material.opacity = opacity; mesh.material.transparent = opacity < 1; mesh.material.depthWrite = opacity >= 1; mesh.material.needsUpdate = true; } },
    setVessels(on) { other.forEach((o) => (o.visible = on)); },
  };
}
