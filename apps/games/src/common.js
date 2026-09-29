// @ts-check
// Pieces both games share that are specific to the games' look: hand and
// cursor drawing, countdown, clock, confetti and camera status. Lifted from
// legacy/kitchen-race.html and brick-race.html, where they were identical.
import { HAND_CONNECTIONS, createTracker, isCameraBlocked, startCamera } from "@heart-hands/core";

export const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
export const PLAYER_COLORS = ["#ff8a00", "#2f80ed"];

/** Size a full-screen canvas for the device pixel ratio (capped at 2). */
export function fitCanvas(/** @type {HTMLCanvasElement} */ canvas) {
  const dpr = Math.min(devicePixelRatio, 2);
  canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
}

/**
 * Draw each slot's tracked hand skeleton and cursor ring in its colour.
 * Filled ring = pinching. Only hands are drawn; a mouse needs no cursor.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof import("@heart-hands/core").createSlots>} slots
 */
export function drawHands(ctx, slots) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const dpr = Math.min(devicePixelRatio, 2); ctx.save(); ctx.scale(dpr, dpr);
  for (const s of slots.slots) {
    const h = s.hand, c = s.cursor.value; if (!h || !c) continue;
    const col = PLAYER_COLORS[s.index], pinch = s.pinch.down;
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.globalAlpha = 0.6; ctx.beginPath();
    for (const cn of HAND_CONNECTIONS) { ctx.moveTo(h.lm[cn.start].x, h.lm[cn.start].y); ctx.lineTo(h.lm[cn.end].x, h.lm[cn.end].y); }
    ctx.stroke(); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(c.x, c.y, pinch ? 10 : 16, 0, Math.PI * 2); ctx.lineWidth = 4; ctx.strokeStyle = "#fff"; ctx.stroke(); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    if (pinch) { ctx.fillStyle = col; ctx.fill(); }
  }
  ctx.restore();
}

/**
 * 3-2-1 overlay, then calls onGo. Uses #countdown and #countNum.
 * @param {{ tickMs: number, goLabel: string, tick: () => void, go: () => void, onGo: () => void }} o
 */
export function runCountdown({ tickMs, goLabel, tick, go, onGo }) {
  const ov = $("countdown"); ov.classList.add("on"); let n = 3; $("countNum").textContent = String(n); tick();
  const iv = setInterval(() => {
    n--; if (n > 0) { $("countNum").textContent = String(n); tick(); return; }
    clearInterval(iv); $("countNum").textContent = goLabel; go();
    setTimeout(() => { ov.classList.remove("on"); onGo(); }, 500);
  }, tickMs);
}

/** m:ss clock in #clock, ticking every 500 ms while running. */
export function createClock() {
  let start = 0, timer = /** @type {ReturnType<typeof setInterval> | null} */ (null);
  const tick = () => { const s = Math.floor((Date.now() - start) / 1000); $("clock").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  return {
    start() { start = Date.now(); this.stop(); timer = setInterval(tick, 500); },
    stop() { if (timer) clearInterval(timer); timer = null; tick(); },
    clear() { $("clock").textContent = "0:00"; },
    get seconds() { return (Date.now() - start) / 1000; },
    get text() { return $("clock").textContent; },
  };
}

/** Falling confetti on #confetti for ~220 frames. @param {string[]} cols */
export function confetti(cols) {
  const cv = /** @type {HTMLCanvasElement} */ ($("confetti")), ctx = /** @type {CanvasRenderingContext2D} */ (cv.getContext("2d"));
  cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio; ctx.scale(devicePixelRatio, devicePixelRatio);
  const bits = Array.from({ length: 140 }, () => ({ x: Math.random() * innerWidth, y: -20 - Math.random() * 200, vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 3, s: 6 + Math.random() * 8, c: cols[Math.floor(Math.random() * cols.length)], r: Math.random() * Math.PI }));
  let frames = 0;
  (function loop() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    bits.forEach((b) => { b.x += b.vx; b.y += b.vy; b.r += 0.08; ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r); ctx.fillStyle = b.c; ctx.fillRect(-b.s / 2, -b.s / 3, b.s, b.s * 0.66); ctx.restore(); });
    if (++frames < 220) requestAnimationFrame(loop); else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })();
}

/**
 * Start camera + tracking, showing progress in #status. Mouse and touch keep
 * working if either fails.
 * @param {HTMLVideoElement} video
 * @returns {Promise<Awaited<ReturnType<typeof createTracker>> | null>}
 */
export async function startCameraWithStatus(video) {
  const status = $("status");
  try {
    await startCamera(video); status.textContent = "Loading hand tracking…";
    const tracker = await createTracker(video); status.classList.add("hidden");
    return tracker;
  } catch (err) {
    console.error(err);
    status.textContent = isCameraBlocked(err)
      ? "Camera blocked. Allow camera access for this page and reload. Mouse and touch still work."
      : "Hand tracking didn't load. Check the internet connection and reload. Mouse and touch still work.";
    return null;
  }
}
