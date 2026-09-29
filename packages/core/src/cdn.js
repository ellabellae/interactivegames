// @ts-check
// Every third-party runtime dependency is loaded from a CDN at an exact,
// pinned version. This file is the only place those versions are written.
// Bumping a version here changes it for every page, in dev and in the build.

export const THREE_VERSION = "0.160.0";
export const TASKS_VISION_VERSION = "0.10.14";

const JSDELIVR = "https://cdn.jsdelivr.net/npm";

/** Bare import specifiers used in source, mapped to their pinned CDN URL. */
export const IMPORT_MAP = {
  "three": `${JSDELIVR}/three@${THREE_VERSION}/build/three.module.js`,
  "three/addons/": `${JSDELIVR}/three@${THREE_VERSION}/examples/jsm/`,
  "@mediapipe/tasks-vision": `${JSDELIVR}/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}`,
};

/** WASM runtime for MediaPipe, must match TASKS_VISION_VERSION. */
export const TASKS_VISION_WASM = `${JSDELIVR}/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;

/** Hand landmark model. The "/1/" path segment is Google's model version. */
export const HAND_LANDMARKER_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
