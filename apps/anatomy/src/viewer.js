// Hand-controlled heart viewer. Ported from legacy/heart-hologram.html onto
// @heart-hands/core: camera, hand tracking, pinch and cursor smoothing are
// shared; every hand threshold comes from the settings profile.
//
// The GLB / per-structure STL loading path (loadFiles, registerModel) is kept
// exactly as in the prototype: it is the route for patient-specific models
// exported from 3D Slicer.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import bodyparts3dHeartUrl from "../models/bodyparts3d-heart/heart.glb?url";
import { HAND_CONNECTIONS, createSlots, createTracker, isCameraBlocked, loadSettings, startCamera } from "@heart-hands/core";

// ---------- settings ----------
const settings = loadSettings();
const V = settings.viewer;
const MODEL_SIZE = 2.3;        // models are normalised to this many world units across
let bpm = 70, beatOn = true;
const BEAT_AMOUNT = 0.025;

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const video = $("video"), handCanvas = $("hands"), handCtx = handCanvas.getContext("2d");
const statusEl = $("status"), partsEl = $("parts"), subtitleEl = $("subtitle");
let statusTimer = null;
const setStatus = (msg) => { clearTimeout(statusTimer); statusEl.textContent = msg; statusEl.classList.toggle("hidden", !msg); };
/** A message that clears itself, so it doesn't sit over the heart. */
const flashStatus = (msg, ms = 6000) => { setStatus(msg); statusTimer = setTimeout(() => setStatus(""), ms); };

// ---------- three.js ----------
const renderer = new THREE.WebGLRenderer({ canvas: $("scene"), alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
camera.position.set(0, 0, 4.6);
// Two render looks. "hologram" is legacy/heart-hologram.html; "flat" is the
// plainer shading of legacy/heart-anatomy.html, which some students find
// clearer. Each look has its own lights, palette, material and extras.
const holoRig = new THREE.Group(), flatRig = new THREE.Group();
scene.add(holoRig, flatRig);
holoRig.add(new THREE.HemisphereLight(0xbfe4ff, 0x120a14, 0.9));
const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(2, 3, 4); holoRig.add(key);
const fill = new THREE.DirectionalLight(0x7fd4ff, 0.6); fill.position.set(-3, -1, 2); holoRig.add(fill);
const rim = new THREE.DirectionalLight(0xff5577, 0.8); rim.position.set(0, 1, -4); holoRig.add(rim);
// projection floor
const floor = new THREE.PolarGridHelper(1.7, 12, 6, 72, 0x3fa9ff, 0x3fa9ff);
floor.material.transparent = true; floor.material.opacity = 0.22; floor.position.y = -1.55; holoRig.add(floor);
// flat look lights (from heart-anatomy.html)
flatRig.add(new THREE.HemisphereLight(0xfff3ef, 0x3a1a1c, 1.1));
const flatKey = new THREE.DirectionalLight(0xffffff, 1.6); flatKey.position.set(2, 3, 4); flatRig.add(flatKey);
const flatFill = new THREE.DirectionalLight(0xffd9d0, 0.5); flatFill.position.set(-3, -1, 2); flatRig.add(flatFill);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enablePan = false; orbit.enableDamping = true; orbit.minDistance = 2; orbit.maxDistance = 12;

const group = new THREE.Group();   // hand rotation + scale
scene.add(group);
let model = null;                  // the loaded heart, child of group
let parts = [];                    // { name, object, meshes, center, offset, dir, color, visible, li, label }

// ---------- looks: colours and materials ----------
const LOOKS = {
  hologram: {
    label: "hologram", rig: holoRig, holo: true, grabGlow: 0x335566, schematicName: "Schematic model · hologram",
    red: 0xff3b5c, blue: 0x3fa9ff, palette: [0xff3b5c, 0x3fa9ff, 0xffb347, 0x9be564, 0xd07dff, 0x5ce8e0, 0xf5e663, 0xff8a5c],
    material: (color) => makeHoloMaterial(color),
  },
  flat: {
    label: "flat", rig: flatRig, holo: false, grabGlow: 0x552222, schematicName: "Schematic model",
    red: 0xc9383f, blue: 0x4d6db3, palette: [0xc9383f, 0x4d6db3, 0xd98c3a, 0x7a9e5a, 0xb35c9e, 0x5aa1a8, 0xcbb04a, 0x8e6a4f],
    material: (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 }),
  },
};
const LOOK_KEY = "heart-hands:viewer-look";
let look = LOOKS[(() => { try { return localStorage.getItem(LOOK_KEY); } catch { return null; } })()] ?? LOOKS.hologram;

function colorFor(name, i) {
  const n = name.toLowerCase();
  // Vessels by oxygenation first: pulmonary veins carry oxygenated blood (red),
  // pulmonary arteries deoxygenated (blue); other arteries red, other veins blue.
  if (/pulmonary vein/.test(n)) return look.red;
  if (/pulmonary (arter|trunk)|cava|coronary sinus|cardiac vein/.test(n)) return look.blue;
  if (/arter|circumflex/.test(n)) return look.red;
  // Valves get distinct colours so the four are easy to tell apart.
  if (/valve/.test(n)) return look.palette[i % look.palette.length];
  // Otherwise by side of the heart (the prototype's rule; abbreviations are
  // whole words so "lv" doesn't match inside "valve").
  if (/(aort|left|pulmonary vein|\blv\b|\bla\b)/.test(n)) return look.red;
  if (/(right|pulmonary (artery|trunk)|cava|\brv\b|\bra\b|svc|ivc)/.test(n)) return look.blue;
  return look.palette[i % look.palette.length];
}
function makeMaterial(color) { return look.material(color); }
function makeHoloMaterial(color) {
  const c = new THREE.Color(color);
  return new THREE.MeshPhysicalMaterial({
    color: c, roughness: 0.28, metalness: 0.15, transparent: true, opacity: 0.62,
    clearcoat: 1, clearcoatRoughness: 0.25, emissive: c.clone().multiplyScalar(0.12), side: THREE.FrontSide,
  });
}
// Rim-light shader: bright edges, translucent centre, a scan band sweeping upward.
const fresnelUniformsAll = [];
function makeRimMaterial(color) {
  const u = { glow: { value: new THREE.Color(color) }, time: { value: 0 } };
  fresnelUniformsAll.push(u);
  return new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec3 vN; varying vec3 vV; varying float vWy;
      void main() {
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = normalize(-mv.xyz);
        vWy = (modelMatrix * vec4(position, 1.0)).y;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 glow; uniform float time;
      varying vec3 vN; varying vec3 vV; varying float vWy;
      void main() {
        float f = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 2.6);
        float band = smoothstep(0.06, 0.0, abs(fract(vWy * 0.45 - time * 0.12) - 0.5) - 0.44);
        float a = f * 0.9 + band * 0.22;
        gl_FragColor = vec4(glow * a + vec3(0.6) * band * 0.15, a);
      }`,
  });
}
const pointMat = new THREE.PointsMaterial({ size: 0.014, sizeAttenuation: true, color: 0xdff4ff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
const wireMat = new THREE.MeshBasicMaterial({ color: 0x9fe3ff, wireframe: true, transparent: true, opacity: 0.06, depthWrite: false });
// Adds the rim glow, sparse point cloud and faint wireframe on top of a surface mesh.
function holographize(mesh, color) {
  if (!look.holo) return;
  mesh.add(new THREE.Mesh(mesh.geometry, makeRimMaterial(color)));
  const wf = new THREE.Mesh(mesh.geometry, wireMat); wf.raycast = () => {}; mesh.add(wf);
  const src = mesh.geometry.attributes.position;
  const stride = Math.max(1, Math.floor(src.count / 700));
  const n = Math.floor(src.count / stride);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const k = i * stride; arr[i * 3] = src.getX(k); arr[i * 3 + 1] = src.getY(k); arr[i * 3 + 2] = src.getZ(k); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
  const pts = new THREE.Points(g, pointMat); pts.raycast = () => {}; mesh.add(pts);
  mesh.children.forEach((c) => (c.raycast = () => {}));
}

// ---------- built-in schematic heart ----------
// Anterior view: the patient's right side is on the viewer's left (negative x).
// Organic chamber: a sphere with low-frequency bumps and an optional taper so ventricles narrow toward the apex.
function blob(rx, ry, rz, x, y, z, taper = 0, seed = 1) {
  const geo = new THREE.SphereGeometry(1, 72, 54);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
    const n = 0.045 * Math.sin(3.1 * vx + seed) * Math.cos(2.7 * vy - seed) + 0.035 * Math.sin(4.3 * vz + 2.0 * vy + seed * 0.7) + 0.02 * Math.cos(6.0 * vx * vz + seed);
    const r = 1 + n;
    const t = 1 + taper * vy;              // vy in [-1,1]; negative taper narrows the bottom
    p.setXYZ(i, vx * r * t, vy * r, vz * r * t);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo);
  m.scale.set(rx, ry, rz); m.position.set(x, y, z); return m;
}
function tube(pointsArr, radius) {
  const curve = new THREE.CatmullRomCurve3(pointsArr.map((p) => new THREE.Vector3(...p)));
  const geo = new THREE.TubeGeometry(curve, 96, radius, 28, false);
  const p = geo.attributes.position;                       // slight wall irregularity
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
    const k = 1 + 0.03 * Math.sin(9.0 * vy + 5.0 * vx) * Math.cos(7.0 * vz);
    p.setXYZ(i, vx * k, vy * k, vz * k);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo);
}
function buildSchematicHeart() {
  const root = new THREE.Group();
  const add = (name, ...meshes) => { const g = new THREE.Group(); g.name = name; meshes.forEach((m) => g.add(m)); root.add(g); };
  add("Right atrium",     blob(0.42, 0.40, 0.36, -0.62, 0.32, 0.18, 0, 1));
  add("Right ventricle",  blob(0.52, 0.66, 0.42, -0.30, -0.42, 0.34, 0.35, 2));
  add("Left atrium",      blob(0.42, 0.38, 0.38,  0.44, 0.38, -0.34, 0, 3));
  add("Left ventricle",   blob(0.56, 0.80, 0.50,  0.34, -0.50, -0.10, 0.42, 4));
  add("Aorta",            tube([[0.12, 0.25, -0.12], [0.06, 0.85, -0.12], [0.22, 1.30, -0.22], [0.62, 1.22, -0.36], [0.72, 0.60, -0.50], [0.68, -0.60, -0.55]], 0.14));
  add("Pulmonary trunk",  tube([[-0.28, 0.15, 0.42], [-0.18, 0.62, 0.40], [0.02, 0.92, 0.18], [0.30, 0.98, -0.02]], 0.13),
                          tube([[0.02, 0.92, 0.18], [-0.35, 1.02, 0.02], [-0.75, 0.98, -0.12]], 0.10));
  add("Superior vena cava", tube([[-0.64, 0.62, 0.10], [-0.66, 1.05, 0.06], [-0.66, 1.45, 0.02]], 0.12));
  add("Inferior vena cava", tube([[-0.66, 0.02, 0.02], [-0.70, -0.55, -0.10], [-0.72, -1.05, -0.18]], 0.12));
  add("Pulmonary veins",
      tube([[0.55, 0.45, -0.55], [0.95, 0.55, -0.75]], 0.06), tube([[0.55, 0.30, -0.60], [0.95, 0.15, -0.80]], 0.06),
      tube([[0.35, 0.50, -0.62], [0.00, 0.62, -0.85]], 0.06), tube([[0.35, 0.32, -0.66], [0.00, 0.20, -0.88]], 0.06));
  return root;
}

// ---------- part registration ----------
function clearModel() {
  if (model) group.remove(model);
  parts.forEach((p) => p.label.remove());
  parts = []; partsEl.innerHTML = ""; model = null;
}
function registerModel(root, sourceName) {
  clearModel();
  model = root;
  // Decide what counts as a "part": top-level named children if there are several, otherwise every mesh.
  let candidates = root.children.filter((c) => c.getObjectByProperty("isMesh", true));
  if (candidates.length < 2) { candidates = []; root.traverse((o) => { if (o.isMesh) candidates.push(o); }); }
  // Re-parent so every part is a direct child of the model root, keeping its world transform.
  scene.add(root);
  root.updateMatrixWorld(true);
  candidates.forEach((o) => root.attach(o));
  candidates = candidates.slice(0, 60);

  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
  const s = MODEL_SIZE / Math.max(size.x, size.y, size.z);

  candidates.forEach((o, i) => {
    const name = (o.name && o.name.trim()) || `Part ${i + 1}`;
    const meshes = []; o.traverse((m) => { if (m.isMesh) meshes.push(m); });
    const color = colorFor(name, i);
    meshes.forEach((m) => {
      const keep = m.material && m.material.map;      // keep textured materials from GLBs
      if (!keep) m.material = makeMaterial(color);
      else { m.material.transparent = true; m.material.opacity = 0.7; }
      m.userData.partIndex = i;
      holographize(m, color);
    });
    const pc = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
    const dir = pc.clone().sub(centre); if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0); dir.normalize();
    const label = document.createElement("div"); label.className = "label hidden"; label.textContent = name; document.body.appendChild(label);
    parts.push({ name, object: o, meshes, basePos: o.position.clone(), center: pc, offset: new THREE.Vector3(), dir, color, visible: true, label, radius: Math.max(size.x, size.y, size.z) });
  });

  scene.remove(root);
  root.scale.setScalar(s);
  root.position.copy(centre).multiplyScalar(-s);
  group.add(root);
  buildPartsList();
  subtitleEl.textContent = sourceName;
}
function buildPartsList() {
  parts.forEach((p, i) => {
    const li = document.createElement("li");
    const sw = document.createElement("span"); sw.className = "swatch"; sw.style.background = "#" + new THREE.Color(p.color).getHexString();
    const nm = document.createElement("span"); nm.className = "name"; nm.textContent = p.name;
    li.append(sw, nm); li.title = "Click to isolate";
    li.addEventListener("click", () => isolate(i));
    partsEl.appendChild(li); p.li = li;
  });
}
function setVisible(p, v) { p.visible = v; p.object.visible = v; p.li.classList.toggle("hidden", !v); }
function isolate(i) {
  const onlyThis = parts.every((p, k) => p.visible === (k === i));
  parts.forEach((p, k) => setVisible(p, onlyThis ? true : k === i));
}
function explodeAll() { parts.forEach((p) => p.offset.copy(p.dir).multiplyScalar(p.radius * 0.35)); }
function resetAll() { parts.forEach((p) => { p.offset.set(0, 0, 0); setVisible(p, true); }); }
let labelsOn = false;
function applyParts() {
  parts.forEach((p) => p.object.position.copy(p.basePos).add(p.offset));
}

// ---------- loading files ----------
const gltfLoader = new GLTFLoader(), stlLoader = new STLLoader();
async function loadFiles(files) {
  const list = Array.from(files);
  if (!list.length) return;
  setStatus("Loading model…");
  try {
    const stls = list.filter((f) => /\.stl$/i.test(f.name));
    const glb = list.find((f) => /\.(glb|gltf)$/i.test(f.name));
    if (glb) {
      const url = URL.createObjectURL(glb);
      const gltf = await gltfLoader.loadAsync(url);
      URL.revokeObjectURL(url);
      registerModel(gltf.scene, glb.name);
    } else if (stls.length) {
      const root = new THREE.Group();
      for (const f of stls) {
        const geo = stlLoader.parse(await f.arrayBuffer());
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo); mesh.name = f.name.replace(/\.stl$/i, "").replace(/[_-]+/g, " ");
        root.add(mesh);
      }
      registerModel(root, stls.length === 1 ? stls[0].name : `${stls.length} STL segments`);
    } else {
      setStatus("That file type isn't supported. Use .glb, .gltf or .stl."); return;
    }
    setStatus("");
  } catch (err) {
    console.error(err);
    setStatus("Couldn't read that model. Check the file and try again.");
  }
}
$("loadBtn").addEventListener("click", () => $("file").click());
$("file").addEventListener("change", (e) => loadFiles(e.target.files));
addEventListener("dragover", (e) => { e.preventDefault(); document.body.classList.add("dragging"); });
addEventListener("dragleave", () => document.body.classList.remove("dragging"));
addEventListener("drop", (e) => { e.preventDefault(); document.body.classList.remove("dragging"); loadFiles(e.dataTransfer.files); });

$("explodeBtn").addEventListener("click", explodeAll);
$("resetBtn").addEventListener("click", resetAll);
$("labelsBtn").addEventListener("click", () => (labelsOn = !labelsOn));
addEventListener("keydown", (e) => {
  if (e.key === "e" || e.key === "E") explodeAll();
  if (e.key === "r" || e.key === "R") resetAll();
  if (e.key === "l" || e.key === "L") labelsOn = !labelsOn;
  if (e.key === "b" || e.key === "B") beatOn = !beatOn;
  if (e.key === "ArrowUp") bpm = Math.min(180, bpm + 5);
  if (e.key === "ArrowDown") bpm = Math.max(30, bpm - 5);
});

// mouse click on a part isolates it
const raycaster = new THREE.Raycaster();
// A drag (to rotate) ends with a click event too; only a press that barely
// moved counts as clicking a part. Before this, every rotation hid all parts
// except whichever one the pointer ended on.
const CLICK_SLOP_PX = 5;
let pressAt = null;
renderer.domElement.addEventListener("pointerdown", (e) => { pressAt = { x: e.clientX, y: e.clientY }; });
renderer.domElement.addEventListener("click", (e) => {
  const moved = pressAt ? Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) : 0;
  pressAt = null;
  if (moved > CLICK_SLOP_PX) return;
  const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  const hit = pickPart(ndc);
  if (hit >= 0) isolate(hit);
});
function pickPart(ndc) {
  raycaster.setFromCamera(ndc, camera);
  const meshes = parts.filter((p) => p.visible).flatMap((p) => p.meshes);
  const hits = raycaster.intersectObjects(meshes, false);
  if (hits.length) return hits[0].object.userData.partIndex;
  // fall back to nearest projected centre
  let best = -1, bestD = settings.targets.partGrabPx;
  const px = ((ndc.x + 1) / 2) * innerWidth, py = ((1 - ndc.y) / 2) * innerHeight;
  parts.forEach((p, i) => {
    if (!p.visible) return;
    const w = partWorldCentre(p).project(camera);
    const d = Math.hypot(((w.x + 1) / 2) * innerWidth - px, ((1 - w.y) / 2) * innerHeight - py);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}
function partWorldCentre(p) {
  return model.localToWorld(p.center.clone().add(p.offset));
}

// ---------- hand tracking ----------
// Two slots in "shared" mode give each hand its own pinch state (hysteresis +
// hold) that follows the hand across frames. The mouse is handled by
// OrbitControls, so pointers are not fed to the slots.
let tracker = null;
const slots = createSlots({ mode: "shared", settings });
const toNDC = (x, y) => new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
function drawHands() {
  handCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);
  const dpr = Math.min(devicePixelRatio, 2);
  handCtx.save(); handCtx.scale(dpr, dpr); handCtx.lineWidth = 1;
  for (const s of slots.slots) {
    const h = s.hand; if (!h) continue;
    handCtx.strokeStyle = s.pinch.down ? "rgba(255,170,170,0.9)" : "rgba(255,255,255,0.55)";
    handCtx.beginPath();
    for (const cn of HAND_CONNECTIONS) { handCtx.moveTo(h.lm[cn.start].x, h.lm[cn.start].y); handCtx.lineTo(h.lm[cn.end].x, h.lm[cn.end].y); }
    handCtx.stroke();
    handCtx.fillStyle = handCtx.strokeStyle;
    for (const p of h.lm) { handCtx.beginPath(); handCtx.arc(p.x, p.y, 2, 0, Math.PI * 2); handCtx.fill(); }
  }
  handCtx.restore();
}

// ---------- gestures ----------
const state = { rotX: 0, rotY: 0, targetRotX: 0, targetRotY: 0, scale: 1, targetScale: 1 };
const grab = { part: -1, depth: 0, prev: null, emissive: [] };
let rotPrev = null;   // palm position last frame, for relative hand rotation
const tmpQ = new THREE.Quaternion();

function setGrabHighlight(p, on) {
  p.meshes.forEach((m, k) => {
    if (!m.material.emissive) return;
    if (on) { grab.emissive[k] = m.material.emissive.getHex(); m.material.emissive.setHex(look.grabGlow); }
    else m.material.emissive.setHex(grab.emissive[k] ?? 0x000000);   // restore the part's own glow
  });
}

function applyGestures(dt, inputs) {
  const pinching = inputs.find((inp) => inp.down && inp.x != null);
  const hands = slots.slots.filter((s) => s.hand).map((s) => s.hand);
  const open = slots.slots.filter((s) => s.hand && !s.pinch.down).map((s) => s.hand);

  // grab / drag with a pinching hand
  if (pinching && parts.length) {
    const ndc = toNDC(pinching.x, pinching.y);
    if (grab.part < 0) {
      const i = pickPart(ndc);
      if (i >= 0) {
        grab.part = i;
        grab.depth = partWorldCentre(parts[i]).project(camera).z;
        grab.prev = null;
        setGrabHighlight(parts[i], true);
        parts[i].li.classList.add("grabbed");
      }
    }
    if (grab.part >= 0) {
      const now = new THREE.Vector3(ndc.x, ndc.y, grab.depth).unproject(camera);
      if (grab.prev) {
        const delta = now.clone().sub(grab.prev);
        // world delta -> model-local delta (undo group rotation and both scales)
        group.getWorldQuaternion(tmpQ);
        delta.applyQuaternion(tmpQ.invert());
        delta.divideScalar(group.scale.x * model.scale.x);
        parts[grab.part].offset.add(delta);
      }
      grab.prev = now;
    }
  } else if (grab.part >= 0) {
    setGrabHighlight(parts[grab.part], false);
    parts[grab.part].li.classList.remove("grabbed");
    grab.part = -1; grab.prev = null;
  }

  // rotate with open hands; scale with two hands
  if (open.length) {
    let cx = open[0].palmNorm.x, cy = open[0].palmNorm.y;
    if (hands.length >= 2) {
      cx = (hands[0].palmNorm.x + hands[1].palmNorm.x) / 2; cy = (hands[0].palmNorm.y + hands[1].palmNorm.y) / 2;
      const d = Math.hypot(hands[0].palmNorm.x - hands[1].palmNorm.x, hands[0].palmNorm.y - hands[1].palmNorm.y);
      const m = V.twoHandScale;
      state.targetScale = THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(d, m.from[0], m.from[1], m.to[0], m.to[1]), m.clamp[0], m.clamp[1]);
    }
    // Rotation follows how far the hand moves, not where it is, so the heart
    // doesn't jump when a hand comes into view and stays put when it leaves.
    // Same gain as before: moving across the whole frame turns it the same amount.
    if (grab.part < 0 && rotPrev) {
      state.targetRotY += (cx - rotPrev.x) * Math.PI * V.rotateGain.y;
      state.targetRotX += (cy - rotPrev.y) * Math.PI * V.rotateGain.x;
    }
    rotPrev = grab.part < 0 ? { x: cx, y: cy } : null;
  } else {
    rotPrev = null;
  }
  state.rotX += (state.targetRotX - state.rotX) * Math.min(1, dt * V.rotateEase);
  state.rotY += (state.targetRotY - state.rotY) * Math.min(1, dt * V.rotateEase);
  state.scale += (state.targetScale - state.scale) * Math.min(1, dt * V.scaleEase);
}

function lubdub(t) {
  const period = 60 / bpm, p = (t % period) / period;
  const bump = (c, a, w) => a * Math.exp(-(((p - c) / w) ** 2));
  return bump(0, 1, 0.06) + bump(1, 1, 0.06) + bump(0.3, 0.5, 0.07);
}

function updateLabels() {
  parts.forEach((p, i) => {
    const show = p.visible && (labelsOn || i === grab.part);
    p.label.classList.toggle("hidden", !show);
    if (!show) return;
    const w = partWorldCentre(p).project(camera);
    if (w.z > 1) { p.label.classList.add("hidden"); return; }
    p.label.style.left = ((w.x + 1) / 2) * innerWidth + "px";
    p.label.style.top = ((1 - w.y) / 2) * innerHeight + "px";
  });
}

// ---------- main loop ----------
function resize() {
  const dpr = Math.min(devicePixelRatio, 2);
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  handCanvas.width = innerWidth * dpr; handCanvas.height = innerHeight * dpr;
}
addEventListener("resize", resize); resize();

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const t = now / 1000;
  const hands = handsOn ? tracker?.read() : null;
  if (hands) slots.updateHands(hands);
  const inputs = slots.frame();
  if (model) applyGestures(dt, inputs);
  applyParts();
  drawHands();
  fresnelUniformsAll.forEach((u) => (u.time.value = t));
  const beat = beatOn ? 1 + BEAT_AMOUNT * lubdub(t) : 1;
  group.rotation.set(state.rotX, state.rotY, 0);
  group.scale.setScalar(state.scale * beat);
  orbit.update();
  if (model) updateLabels();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------- built-in models ----------
// "realistic": BodyParts3D heart, bundled into the page (see
// models/bodyparts3d-heart/README.md). "schematic": the prototype's
// hand-built heart. A user's own GLB/STL files replace either.
const MODEL_KEY = "heart-hands:viewer-model";
const CREDIT = "Model: BodyParts3D, © DBCLS, CC BY-SA 2.1 JP (modified)";
let builtIn = (() => { try { return localStorage.getItem(MODEL_KEY) === "schematic" ? "schematic" : "realistic"; } catch { return "realistic"; } })();
let lastFiles = null;   // the user's own files, if they loaded some; replaces the built-in model
$("file").addEventListener("change", (e) => { if (e.target.files.length) { lastFiles = [...e.target.files]; showCredit(false); } });
addEventListener("drop", (e) => { if (e.dataTransfer.files.length) { lastFiles = [...e.dataTransfer.files]; showCredit(false); } });
function showCredit(on) { $("credit").hidden = !on; }
async function loadRealisticHeart() {
  setStatus("Loading model…");
  try {
    const gltf = await gltfLoader.loadAsync(bodyparts3dHeartUrl);
    // glTF loading turns spaces in part names into underscores; put them back.
    gltf.scene.children.forEach((o) => (o.name = o.name.replace(/_/g, " ")));
    registerModel(gltf.scene, "Realistic model · BodyParts3D");
    showCredit(true); setStatus("");
  } catch (err) {
    console.error(err);
    setStatus("Couldn't load the realistic heart. Showing the schematic model.");
    registerModel(buildSchematicHeart(), look.schematicName); showCredit(false);
  }
}
function loadBuiltIn() {
  fresnelUniformsAll.length = 0;
  if (builtIn === "realistic") return loadRealisticHeart();
  showCredit(false); registerModel(buildSchematicHeart(), look.schematicName);
}
$("modelSel").value = builtIn;
$("modelSel").addEventListener("change", () => {
  builtIn = $("modelSel").value === "schematic" ? "schematic" : "realistic";
  try { localStorage.setItem(MODEL_KEY, builtIn); } catch { /* storage blocked: choice just isn't remembered */ }
  lastFiles = null; loadBuiltIn();
});

// ---------- look switching ----------
// Rebuilding re-runs the unchanged loader on the same source, so a loaded
// GLB/STL set keeps working. Part positions and hidden parts reset.
function applyLook() {
  document.body.classList.toggle("look-flat", look === LOOKS.flat);
  holoRig.visible = look === LOOKS.hologram; flatRig.visible = look === LOOKS.flat;
  $("lookBtn").textContent = `Look: ${look.label}`;
}
function setLook(next) {
  look = next;
  try { localStorage.setItem(LOOK_KEY, look.label); } catch { /* storage blocked: look just isn't remembered */ }
  applyLook();
  fresnelUniformsAll.length = 0;
  if (lastFiles) loadFiles(lastFiles); else loadBuiltIn();
}
const toggleLook = () => setLook(look === LOOKS.hologram ? LOOKS.flat : LOOKS.hologram);
$("lookBtn").addEventListener("click", toggleLook);
addEventListener("keydown", (e) => { if (e.key === "v" || e.key === "V") toggleLook(); });

applyLook();
$("credit").textContent = CREDIT;
loadBuiltIn();
requestAnimationFrame(frame);

// ---------- hand control (opt-in) ----------
// Off by default: the mouse is the main way to study the model, and the
// camera isn't requested until the student turns hand control on.
const HANDS_KEY = "heart-hands:viewer-hands";
let handsOn = false;
function showHandsState() {
  $("handsBtn").textContent = `Hand control: ${handsOn ? "on" : "off"}`;
  $("handsBtn").setAttribute("aria-pressed", String(handsOn));
  document.body.classList.toggle("hands-off", !handsOn);
}
function saveHands() { try { localStorage.setItem(HANDS_KEY, handsOn ? "on" : "off"); } catch { /* not remembered */ } }
async function enableHands() {
  handsOn = true; showHandsState();
  try {
    setStatus("Starting camera…");
    await startCamera(video);
    setStatus("Loading hand tracking…");
    tracker = tracker ?? await createTracker(video);
    setStatus(""); saveHands();
  } catch (err) {
    console.error(err);
    disableHands();
    if (isCameraBlocked(err)) {
      flashStatus("Camera blocked. Allow camera access for this page in the address bar, then turn hand control on again. Mouse controls still work.");
    } else {
      flashStatus("Couldn't load hand tracking. Check your internet connection and try again. Mouse controls still work.");
    }
  }
}
function disableHands() {
  handsOn = false; showHandsState();
  const stream = video.srcObject;
  if (stream) { stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; }
  slots.reset(); saveHands();
}
$("handsBtn").addEventListener("click", () => { if (handsOn) disableHands(); else enableHands(); });
setStatus("");
showHandsState();
if ((() => { try { return localStorage.getItem(HANDS_KEY) === "on"; } catch { return false; } })()) enableHands();
