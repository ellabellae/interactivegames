// Kitchen race: two cooks, one webcam. Each recipe step is a gesture
// mini-game. Ported from legacy/kitchen-race.html onto @heart-hands/core:
// thresholds come from the settings profile, gestures from the shared
// detectors, input from player slots (hand or mouse/touch).
import { createAudio, createDetector, createLoop, createSession, createSlots, gestureFor, isNear, loadPlayer, loadSettings, saveSession } from "@heart-hands/core";
import { $, confetti, createClock, drawHands, fitCanvas, mmss, mountProfilePicker, recordBest, remembered, runCountdown, startCameraWithStatus } from "./common.js";

const settings = loadSettings();

// =============== sound: effects and a little looping tune, all synthesised ===============
const audio = createAudio({ defaultGain: 0.22 });
const { sfx } = audio;
let musicOn = true;

// 16-step tune in C major. 0 = rest. Kitchen-timer bouncy.
const MELODY = [523, 0, 659, 784, 0, 659, 523, 0, 587, 0, 698, 880, 0, 784, 659, 0,
                523, 0, 659, 784, 0, 880, 1046, 0, 988, 0, 784, 659, 0, 587, 523, 0];
const BASS   = [131, 0, 131, 0, 175, 0, 175, 0, 196, 0, 196, 0, 175, 0, 131, 0,
                131, 0, 131, 0, 175, 0, 175, 0, 196, 0, 220, 0, 196, 0, 131, 0];
const tempo = settings.game.tempo;
const music = createLoop(audio, { melody: MELODY, bass: BASS, bpm: tempo.startBpm });

// =============== recipes: each step is a gesture mini-game ===============
// Gesture kinds: pinchdrop (pinch, move over a spot, release), stir (circles), chop (up and down), flick (fast upward swipe), shake (pinch and wiggle), drag (pinch item, carry to target).
const RECIPES = {
  "Pancakes": [
    { name: "Crack eggs", kind: "pinchdrop", need: 3, from: "🥚", into: "🥣", hint: "Pinch an egg and let go over the bowl", sfx: sfx.crack },
    { name: "Stir batter", kind: "stir", need: 4, at: "🥣", hint: "Make big circles over the bowl", sfx: sfx.swish },
    { name: "Pour", kind: "drag", need: 1, from: "🥣", into: "🍳", hint: "Pinch the bowl and carry it to the pan", sfx: sfx.sizzle },
    { name: "Flip", kind: "flick", need: 3, at: "🍳", hint: "Flick your hand straight up, fast", raiseHint: "Lift your hand slowly up from the pan", sfx: sfx.sizzle },
    { name: "Plate up", kind: "drag", need: 1, from: "🥞", into: "🍽️", hint: "Pinch the pancakes and carry them to the plate", sfx: sfx.dingdong },
  ],
  "Stir-fry": [
    { name: "Chop veggies", kind: "chop", need: 14, at: "🥕", hint: "Chop! Move your hand up and down over the board", sfx: sfx.chop },
    { name: "Into the wok", kind: "drag", need: 1, from: "🥕", into: "🥘", hint: "Pinch the veggies and carry them to the wok", sfx: sfx.sizzle },
    { name: "Season", kind: "shake", need: 10, from: "🧂", at: "🥘", hint: "Pinch the shaker and wiggle it side to side", sfx: sfx.shake },
    { name: "Toss", kind: "stir", need: 4, at: "🥘", hint: "Big circles over the wok", sfx: sfx.swish },
    { name: "Plate up", kind: "drag", need: 1, from: "🍜", into: "🍽️", hint: "Pinch the stir-fry and carry it to the plate", sfx: sfx.dingdong },
  ],
  "Sundae": [
    { name: "Scoop", kind: "pinchdrop", need: 3, from: "🍨", into: "🍧", hint: "Pinch a scoop and let go over the cup", sfx: sfx.crack },
    { name: "Chop banana", kind: "chop", need: 10, at: "🍌", hint: "Chop! Up and down over the banana", sfx: sfx.chop },
    { name: "Add banana", kind: "drag", need: 1, from: "🍌", into: "🍧", hint: "Pinch the banana and carry it to the cup", sfx: sfx.swish },
    { name: "Sprinkles", kind: "shake", need: 10, from: "🧁", at: "🍧", hint: "Pinch the sprinkles and wiggle side to side", sfx: sfx.shake },
    { name: "Cherry on top", kind: "flick", need: 2, at: "🍒", hint: "Flick your hand up to toss the cherry", raiseHint: "Lift your hand slowly up from the cherry", sfx: sfx.dingdong },
  ],
};
/** Repetitions for a step under the current profile (never below 1). */
const needFor = (step) => Math.max(1, Math.round(step.need * settings.game.repsScale));
const DETECTED = new Set(["stir", "chop", "flick", "raise", "shake"]);
/** The gesture a step uses under this profile (gentle: flick becomes a slow raise). */
const kindOf = (step) => gestureFor(step.kind, settings.gestures);

// =============== game state ===============
let running = false;
const clock = createClock();
// Race: two cooks, one per half. Solo: one station in the middle, any hand, against your best time.
const mode = remembered("kitchen-mode", "race", ["race", "solo"]);
const solo = () => mode.get() === "solo";
let slots = createSlots({ mode: solo() ? "solo" : "split", settings });
const players = [0, 1].map((p) => ({
  p, station: $(`station${p + 1}`), stepsEl: $(`steps${p + 1}`), recipe: [], si: 0, count: 0,
  held: null, src: null, dst: null, detector: null,
}));

function layoutStation(pl) {
  const st = pl.station, step = pl.recipe[pl.si];
  st.innerHTML = `<div class="counter"></div><div class="meter"><div></div></div>`;
  pl.detector = step && DETECTED.has(kindOf(step)) ? createDetector(kindOf(step), settings.gestures) : null;
  if (!step) return;
  const put = (emoji, x, y, cls = "") => { const d = document.createElement("div"); d.className = "item " + cls; d.textContent = emoji; d.style.left = x + "%"; d.style.top = y + "%"; st.appendChild(d); return d; };
  if (step.kind === "pinchdrop" || step.kind === "drag") { pl.src = put(step.from, 24, 52, "small zone-ring"); pl.dst = put(step.into, 72, 52, "zone-ring hot"); }
  else if (step.kind === "shake") { pl.src = put(step.from, 24, 52, "small zone-ring"); pl.dst = put(step.at, 72, 52, ""); }
  else { pl.src = null; pl.dst = put(step.at, 50, 52, "zone-ring hot"); }
  const need = needFor(step);
  const hint = kindOf(step) === "raise" && step.raiseHint ? step.raiseHint : step.hint;
  const h = document.createElement("div"); h.className = "hint"; h.innerHTML = `${hint}<span>${need > 1 ? `${need} times` : ""}</span>`; st.appendChild(h);
  pl.stepsEl.innerHTML = pl.recipe.map((s, i) => `<div class="step ${i < pl.si ? "done" : i === pl.si ? "now" : ""}">${i < pl.si ? "✓ " : ""}${s.name}</div>`).join("");
}
function setup() {
  const r = RECIPES[$("recipeSel").value];
  slots.reset();
  players.forEach((pl) => { pl.recipe = r; pl.si = 0; pl.count = 0; dropHeld(pl); layoutStation(pl); });
  clock.clear(); music.bpm = tempo.startBpm;
}
/** An element's hit circle: its centre, radius = half its larger side + the profile's padding. */
function targetOf(el) { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: Math.max(r.width, r.height) / 2 + settings.targets.padPx }; }
const near = (pt, el) => isNear(pt, targetOf(el));
// =============== progress log (this device only; see the Progress page) ===============
let session = null;
function beginLoggedStep(pl) { const st = pl.recipe[pl.si]; if (st) session?.beginStep(pl.p, { name: st.name, gesture: kindOf(st), need: needFor(st) }); }
function startSession() {
  endSession(false);
  session = createSession({ game: "kitchen", mode: mode.get(), detail: $("recipeSel").value, settings, slots: activePlayers().length, player: loadPlayer() });
  activePlayers().forEach(beginLoggedStep);
}
/** Save the session: completed, or abandoned (restart, mode change, leaving the page). */
function endSession(completed) { if (session && !session.ended) saveSession(session.end(completed)); session = null; }
addEventListener("pagehide", () => endSession(false));

function progress(pl) {
  const step = pl.recipe[pl.si], need = needFor(step); pl.count++;
  session?.rep(pl.p);
  pl.station.querySelector(".meter div").style.width = (100 * pl.count / need) + "%";
  step.sfx();
  if (pl.count >= need) {
    pl.count = 0; pl.si++; dropHeld(pl); sfx.bing(); pop(pl, "Bing!");
    music.bpm = Math.min(tempo.maxBpm, tempo.startBpm + tempo.bpmPerStep * Math.max(...players.map((q) => q.si)));
    if (pl.si >= pl.recipe.length) { session?.endStep(pl.p); finish(pl); }
    else { layoutStation(pl); beginLoggedStep(pl); }
  }
}
function pop(pl, text) { const t = document.createElement("div"); t.className = "bing"; t.textContent = text; pl.station.appendChild(t); setTimeout(() => t.remove(), 850); }
function puff(pl, emoji, pt) { const r = pl.station.getBoundingClientRect(), d = document.createElement("div"); d.className = "puff"; d.textContent = emoji; d.style.left = (pt.x - r.left) + "px"; d.style.top = (pt.y - r.top) + "px"; pl.station.appendChild(d); setTimeout(() => d.remove(), 650); }
function hold(pl, emoji) { dropHeld(pl); const d = document.createElement("div"); d.className = "held"; d.textContent = emoji; document.body.appendChild(d); pl.held = d; }
function dropHeld(pl) { if (pl.held) { pl.held.remove(); pl.held = null; } }

// the gesture logic: runs every frame with the player's current input
function updateGesture(pl, inp, dt) {
  const step = pl.recipe[pl.si]; if (!step || !running) return;
  const pt = inp.x != null ? { x: inp.x, y: inp.y } : null;
  if (inp.pressed) session?.pinch(pl.p);
  if (pl.held && pt) { pl.held.style.left = pt.x + "px"; pl.held.style.top = pt.y + "px"; }

  switch (kindOf(step)) {
    case "pinchdrop":
      if (inp.pressed && near(pt, pl.src)) hold(pl, step.from);
      if (inp.released && pl.held) { if (near(pt, pl.dst)) { puff(pl, step.from, pt); progress(pl); } else session?.miss(pl.p); dropHeld(pl); }
      break;
    case "drag":
      if (inp.pressed && near(pt, pl.src)) { hold(pl, step.from); pl.src.style.opacity = 0.25; }
      if (inp.released && pl.held) { dropHeld(pl); if (near(pt, pl.dst)) progress(pl); else { pl.src.style.opacity = 1; session?.miss(pl.p); } }
      break;
    case "stir":
      if (pl.detector.update(pt, targetOf(pl.dst), dt)) { progress(pl); puff(pl, "✨", pt); }
      else if (near(pt, pl.dst) && Math.random() < 0.08) sfx.swish();
      break;
    case "chop":
      if (pl.detector.update(pt, targetOf(pl.dst), dt)) { progress(pl); puff(pl, "🔪", pt); }
      break;
    case "flick":
    case "raise":
      if (pl.detector.update(pt, targetOf(pl.dst), dt)) { progress(pl); puff(pl, step.at === "🍒" ? "🍒" : "🥞", pt); }
      break;
    case "shake":
      if (inp.pressed && near(pt, pl.src)) hold(pl, step.from);
      if (inp.released) dropHeld(pl);
      if (pl.detector.update(pl.held ? pt : null, targetOf(pl.dst), dt)) { progress(pl); if (Math.random() < 0.5) puff(pl, "✨", pt); }
      break;
  }
}

// =============== input: hands by half of the screen, pointer as fallback ===============
document.addEventListener("pointerdown", (e) => { if (e.target.closest("button, select, label, a")) return; audio.ensure(); slots.pointerDown(e.pointerId, e.clientX, e.clientY); e.preventDefault(); });
document.addEventListener("pointermove", (e) => slots.pointerMove(e.pointerId, e.clientX, e.clientY));
const endPtr = (e) => slots.pointerUp(e.pointerId, e.clientX, e.clientY);
document.addEventListener("pointerup", endPtr); document.addEventListener("pointercancel", endPtr);

const video = $("video"), handCanvas = $("hands"), hctx = handCanvas.getContext("2d");
let tracker = null;
let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  const hands = tracker?.read();
  if (hands) slots.updateHands(hands);
  const inputs = slots.frame();
  activePlayers().forEach((pl) => updateGesture(pl, inputs[pl.p], dt));
  if (running) activePlayers().forEach((pl) => session?.input(pl.p, inputs[pl.p].source));
  drawHands(hctx, slots);
  requestAnimationFrame(frame);
}

// =============== race flow ===============
function startRace() {
  endSession(false); audio.ensure(); setup(); running = false; if (musicOn) music.start();
  runCountdown({ tickMs: settings.game.countdownMs, goLabel: "Cook!", tick: sfx.tick, go: sfx.go, onGo: () => { running = true; clock.start(); startSession(); } });
}
function finish(winner) {
  endSession(true);
  running = false; clock.stop(); music.stop(); sfx.fanfare(); confetti(["#ff8a00", "#2f80ed", "#ffcf3f", "#2ecc71", "#ff6fa8", "#fff"]);
  if (solo()) {
    const dish = $("recipeSel").value, r = recordBest(`kitchen:${dish}:${settings.id}`, clock.seconds);
    $("winTitle").textContent = r.isNew && r.previous !== null ? "New personal best!" : "Done!";
    $("winText").textContent = `${dish} cooked in ${clock.text}. ` + (r.previous === null ? "That's your first time on this dish." : r.isNew ? `Your previous best was ${mmss(r.previous)}.` : `Your best is ${mmss(r.best)}.`);
    setTimeout(() => $("winner").classList.add("on"), 900); return;
  }
  const other = players[1 - winner.p];
  $("winTitle").textContent = `Player ${winner.p + 1} serves first!`;
  $("winText").textContent = `${$("recipeSel").value} done in ${clock.text}. Player ${other.p + 1} was on step ${Math.min(other.si + 1, other.recipe.length)} of ${other.recipe.length}: ${other.recipe[Math.min(other.si, other.recipe.length - 1)].name}.`;
  setTimeout(() => $("winner").classList.add("on"), 900);
}

/** The players taking part: both in the race, only the first in solo. */
const activePlayers = () => (solo() ? [players[0]] : players);
function applyMode() {
  document.body.classList.toggle("solo", solo());
  $("modeSel").value = mode.get();
  document.querySelector(".zone.p1 .who").childNodes[1].textContent = solo() ? "You" : "Player 1";
  $("countHint").textContent = solo() ? "Get ready. Use either hand, and take your time." : "Aprons on. One cook on each side of the screen.";
}

// =============== wiring ===============
mountProfilePicker(/** @type {HTMLSelectElement} */ ($("profileSel")));
$("modeSel").addEventListener("change", () => {
  mode.set($("modeSel").value === "solo" ? "solo" : "race");
  endSession(false); running = false; clock.stop(); music.stop();
  slots = createSlots({ mode: solo() ? "solo" : "split", settings });
  applyMode(); setup();
});
applyMode();
Object.keys(RECIPES).forEach((k) => { const o = document.createElement("option"); o.textContent = k; $("recipeSel").appendChild(o); });
$("recipeSel").addEventListener("change", () => { if (!running) setup(); });
$("start").addEventListener("click", startRace);
$("again").addEventListener("click", () => { $("winner").classList.remove("on"); const s = $("recipeSel"); s.selectedIndex = (s.selectedIndex + 1) % s.options.length; startRace(); });
$("music").addEventListener("click", () => { musicOn = !musicOn; $("music").textContent = musicOn ? "Music on" : "Music off"; $("music").setAttribute("aria-pressed", musicOn); if (musicOn && running) music.start(); if (!musicOn) music.stop(); });
addEventListener("resize", () => fitCanvas(handCanvas)); fitCanvas(handCanvas); setup(); requestAnimationFrame(frame);
startCameraWithStatus(video).then((t) => { tracker = t; });
