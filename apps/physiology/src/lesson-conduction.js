// Lesson: excitation and conduction, one heartbeat step by step
// (lecture slides 4-5, 9-13). Drives the heart stage's clock and the
// stage list and timeline around it.
import { createHeartStage } from "./heart-stage.js";
import { stages as stageList } from "./conduction-model.js";

const $ = (id) => document.getElementById(id);
const status = $("status");

let stage;
try { stage = await createHeartStage($("scene")); }
catch (err) { console.error(err); status.textContent = "Couldn't load the heart model."; throw err; }
status.classList.add("hidden");

const s = stage.schedule;
const STAGES = stageList(s);
const T0 = STAGES[0].start, T1 = s.tLastVentricle + 160;   // show rest before, and the start of contraction after
const span = T1 - T0;

// ---- stage list
$("stages").innerHTML = STAGES.map((st, i) => `<li data-i="${i}"><strong>${st.title}</strong><span class="text">${st.text}</span></li>`).join("");
const stageAt = (t) => STAGES.reduce((cur, st, i) => (t >= st.start ? i : cur), 0);
$("stages").addEventListener("click", (e) => { const li = e.target.closest("li"); if (li) jumpTo(+li.dataset.i); });

// ---- timeline bar: one coloured segment per stage, width proportional to time
const SEG = [
  ["Rest", "rgba(255,255,255,0.05)"], ["Atria", "rgba(180,76,255,0.45)"], ["AV delay", "rgba(255,225,74,0.28)"],
  ["His / branches", "rgba(255,225,74,0.5)"], ["Purkinje → muscle", "rgba(180,76,255,0.6)"], ["Contraction", "rgba(201,56,63,0.45)"],
];
const pct = (t) => ((t - T0) / span) * 100;
$("bar").innerHTML = STAGES.map((st, i) => {
  const end = i + 1 < STAGES.length ? STAGES[i + 1].start : T1;
  return `<div class="seg" style="left:${pct(st.start)}%;width:${pct(end) - pct(st.start)}%;background:${SEG[i][1]}" title="${st.title}">${SEG[i][0]}</div>`;
}).join("") + `<div class="head" id="head"></div>`;
$("ticks").innerHTML = [0, 50, 100, 150, 200, 250, 300].filter((t) => t <= T1).map((t) => `<span style="left:${pct(t)}%">${t}</span>`).join("");

// ---- clock
let t = T0, playing = false, last = performance.now();
function show() {
  stage.setTime(t);
  $("head").style.left = `calc(${pct(t)}% - 1px)`;
  $("clock").innerHTML = `${Math.round(Math.max(0, t))} ms <small>${t < 0 ? "before the SA node fires" : "after the SA node fires"}</small>`;
  const now = stageAt(t);
  [...$("stages").children].forEach((li, i) => li.classList.toggle("now", i === now));
  $("bar").setAttribute("aria-valuenow", String(Math.round(t)));
}
function setPlaying(on) { playing = on; $("play").textContent = on ? "Pause" : "Play"; last = performance.now(); }
function jumpTo(i) { setPlaying(false); t = STAGES[Math.max(0, Math.min(STAGES.length - 1, i))].start + (i === 0 ? 0 : 0.5); show(); }

$("play").addEventListener("click", () => { if (!playing && t >= T1) t = T0; setPlaying(!playing); });
$("prev").addEventListener("click", () => { const i = stageAt(t); jumpTo(t - STAGES[i].start > 5 ? i : i - 1); });
$("next").addEventListener("click", () => jumpTo(stageAt(t) + 1));
$("labels").addEventListener("change", (e) => stage.setLabels(e.target.checked));
$("walls").addEventListener("change", (e) => stage.setWalls(e.target.checked ? 0.35 : 1));
$("vessels").addEventListener("change", (e) => stage.setVessels(e.target.checked));

// scrub by dragging on the bar, or with arrow keys (10 ms, shift = 1 ms)
const scrub = (e) => { const r = $("bar").getBoundingClientRect(); t = T0 + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * span; show(); };
$("bar").addEventListener("pointerdown", (e) => { setPlaying(false); $("bar").setPointerCapture(e.pointerId); scrub(e); });
$("bar").addEventListener("pointermove", (e) => { if (e.buttons) scrub(e); });
$("bar").addEventListener("keydown", (e) => {
  const step = e.shiftKey ? 1 : 10;
  if (e.key === "ArrowRight") { t = Math.min(T1, t + step); setPlaying(false); show(); e.preventDefault(); }
  if (e.key === "ArrowLeft") { t = Math.max(T0, t - step); setPlaying(false); show(); e.preventDefault(); }
});
addEventListener("keydown", (e) => { if (e.key === " " && e.target === document.body) { e.preventDefault(); $("play").click(); } });

function frame(now) {
  if (playing) {
    t += (now - last) * +$("speed").value;
    if (t > T1) { if ($("loop").checked) t = T0; else { t = T1; setPlaying(false); } }
    show();
  }
  last = now;
  stage.render();
  requestAnimationFrame(frame);
}
show();
requestAnimationFrame(frame);
