// @ts-check
// Scaffold smoke test: proves the MediaPipe tasks-vision module loads from the
// pinned CDN (no camera is opened). Replaced when the games are ported.
import { FilesetResolver } from "@mediapipe/tasks-vision";
import { TASKS_VISION_VERSION } from "@heart-hands/core";

const ok = typeof FilesetResolver.forVisionTasks === "function";
document.documentElement.dataset.mediapipe = String(ok);
console.info(`@mediapipe/tasks-vision ${TASKS_VISION_VERSION} loaded: ${ok}`);
