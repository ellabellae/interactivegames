// @ts-check
// Scaffold smoke test: proves three.js and a three.js addon both load from the
// pinned CDN through the import map, in dev, in the build, and from file://.
// Replaced by the real viewer when heart-hologram.html is ported.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { THREE_VERSION } from "@heart-hands/core";

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("scene"));
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
camera.position.set(0, 0, 4.6);
new OrbitControls(camera, renderer.domElement);
const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshBasicMaterial({ color: 0x3fa9ff, wireframe: true }));
scene.add(mesh);

function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener("resize", resize); resize();
renderer.setAnimationLoop((t) => { mesh.rotation.y = t / 2000; renderer.render(scene, camera); });

document.documentElement.dataset.three = THREE.REVISION;
console.info(`three r${THREE.REVISION} loaded (pinned ${THREE_VERSION})`);
