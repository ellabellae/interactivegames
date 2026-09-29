// @ts-check
// Camera + MediaPipe HandLandmarker, shared by every page. Previously copied
// into each of the five prototypes with the same URLs and options.
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { HAND_LANDMARKER_MODEL, TASKS_VISION_WASM } from "./cdn.js";

/** Landmark pairs to draw a hand skeleton. */
export const HAND_CONNECTIONS = HandLandmarker.HAND_CONNECTIONS;

/**
 * @typedef {import("./gestures.js").Point} ScreenPoint
 * @typedef {object} Hand
 * @property {ScreenPoint[]} lm        21 landmarks in screen px, mirrored to match the video
 * @property {ScreenPoint[]} lmNorm    same, in mirrored 0..1 video coordinates
 * @property {ScreenPoint} pt          pinch point (midway between thumb and index tips), px
 * @property {ScreenPoint} palm        centre of wrist + four knuckles, px
 * @property {ScreenPoint} palmNorm    same, 0..1 video coordinates (heart viewer rotation)
 * @property {number} sideX      x of the middle knuckle, px (which half of the screen the hand is on)
 * @property {number} pinchDist  thumb-index distance / hand size (wrist to middle knuckle)
 */

const PALM = [0, 5, 9, 13, 17];

/**
 * Where the video is drawn on screen with object-fit: cover.
 * @param {number} vw video width  @param {number} vh video height
 * @param {number} ww window width @param {number} wh window height
 */
export function coverRect(vw, vh, ww, wh) {
  const s = Math.max(ww / vw, wh / vh), dw = vw * s, dh = vh * s;
  return { ox: (ww - dw) / 2, oy: (wh - dh) / 2, dw, dh };
}

/**
 * Turn one MediaPipe landmark list into a Hand in screen coordinates.
 * Pure function; exported for tests.
 * @param {{ x: number, y: number }[]} raw  MediaPipe landmarks (0..1, unmirrored)
 * @param {{ ox: number, oy: number, dw: number, dh: number }} rect  from coverRect
 * @returns {Hand}
 */
export function toHand(raw, rect) {
  const lmNorm = raw.map((p) => ({ x: 1 - p.x, y: p.y }));
  const lm = lmNorm.map((p) => ({ x: rect.ox + p.x * rect.dw, y: rect.oy + p.y * rect.dh }));
  const avg = (/** @type {ScreenPoint[]} */ pts) => ({ x: PALM.reduce((s, k) => s + pts[k].x, 0) / PALM.length, y: PALM.reduce((s, k) => s + pts[k].y, 0) / PALM.length });
  const size = Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y) || 1;
  return {
    lm, lmNorm,
    pt: { x: (lm[4].x + lm[8].x) / 2, y: (lm[4].y + lm[8].y) / 2 },
    palm: avg(lm), palmNorm: avg(lmNorm),
    sideX: lm[9].x,
    pinchDist: Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y) / size,
  };
}

/**
 * Ask for the front camera and play it into `video`.
 * Throws the browser's error (NotAllowedError, NotFoundError, ...) unchanged.
 * @param {HTMLVideoElement} video
 */
export async function startCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 1280, height: 720 }, audio: false });
  video.srcObject = stream;
  await new Promise((r) => (video.onloadedmetadata = r));
  await video.play();
}

/**
 * Load the hand model and return a reader for `video`.
 * @param {HTMLVideoElement} video
 * @param {{ numHands?: number }} [opts]
 */
export async function createTracker(video, { numHands = 2 } = {}) {
  const vision = await FilesetResolver.forVisionTasks(TASKS_VISION_WASM);
  const landmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: HAND_LANDMARKER_MODEL, delegate: "GPU" },
    runningMode: "VIDEO", numHands,
  });
  let lastVideoTime = -1;
  return {
    /**
     * Hands in the newest video frame, or null if there is no new frame yet
     * (callers keep their previous state in that case, as the originals did).
     * @returns {Hand[] | null}
     */
    read() {
      if (video.readyState < 2 || video.currentTime === lastVideoTime) return null;
      lastVideoTime = video.currentTime;
      const rect = coverRect(video.videoWidth || 16, video.videoHeight || 9, innerWidth, innerHeight);
      return (landmarker.detectForVideo(video, performance.now()).landmarks || []).map((lm) => toHand(lm, rect));
    },
  };
}

/**
 * Start camera and tracking. Returns the tracker, or throws with the
 * browser error so the page can show its own message.
 * @param {HTMLVideoElement} video
 * @param {(msg: string) => void} [onStatus]
 */
export async function startTracking(video, onStatus = () => {}) {
  await startCamera(video);
  onStatus("Loading hand tracking…");
  return createTracker(video);
}

/** True if the error means the camera was refused or is missing. */
export const isCameraBlocked = (/** @type {any} */ err) => !!err && (err.name === "NotAllowedError" || err.name === "NotFoundError");
