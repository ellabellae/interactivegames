// Brick race: copy a picture brick by brick. Ported from
// legacy/brick-race.html onto @heart-hands/core: thresholds come from the
// settings profile, input from player slots (hand or mouse/touch).
//
// A "board" is one blueprint + tray. A "slot" is one player's input; every
// slot can hold one brick at a time.
//   race   two boards, one per half of the screen (the original game)
//   co-op  one board in the middle; both players' hands (or mice, or a mix)
//          build it together. Useful for playing alongside a therapist or
//          family member.
import { createAudio, createSlots, loadSettings } from "@heart-hands/core";
import { $, confetti, createClock, drawHands, fitCanvas, runCountdown, startCameraWithStatus } from "./common.js";

const settings = loadSettings();

// ---------- pieces ----------
const C = { red: "#e0332b", blue: "#2d6cdf", yellow: "#f6c324", green: "#3aa655", white: "#f4f4f2", black: "#3a3a3c", orange: "#ff8a00", gray: "#9aa5b1", tan: "#e5c79a", pink: "#ff6fa8" };
const SETS = {
  "Rocket": [[5,0,2,"red"],[4,1,4,"red"],[4,2,4,"white"],[4,3,2,"blue"],[6,3,2,"white"],[4,4,4,"white"],[4,5,2,"white"],[6,5,2,"blue"],[4,6,4,"white"],[3,7,1,"red"],[4,7,4,"red"],[8,7,1,"red"],[2,8,2,"red"],[4,8,4,"gray"],[8,8,2,"red"],[4,9,1,"orange"],[5,9,2,"yellow"],[7,9,1,"orange"]],
  "House": [[5,0,2,"red"],[4,1,4,"red"],[3,2,6,"red"],[2,3,8,"red"],[1,4,10,"red"],[2,5,2,"tan"],[4,5,2,"blue"],[6,5,2,"tan"],[8,5,2,"blue"],[2,6,8,"tan"],[2,7,2,"tan"],[4,7,2,"blue"],[6,7,2,"tan"],[8,7,2,"tan"],[2,8,3,"tan"],[5,8,2,"orange"],[7,8,3,"tan"],[0,9,3,"green"],[3,9,2,"tan"],[5,9,2,"orange"],[7,9,2,"tan"],[9,9,3,"green"]],
  "Robot": [[5,0,1,"yellow"],[6,0,1,"yellow"],[4,1,4,"gray"],[4,2,1,"gray"],[5,2,1,"blue"],[6,2,1,"blue"],[7,2,1,"gray"],[4,3,4,"gray"],[5,4,2,"black"],[2,5,2,"gray"],[4,5,4,"blue"],[8,5,2,"gray"],[2,6,1,"gray"],[4,6,1,"blue"],[5,6,2,"red"],[7,6,1,"blue"],[9,6,1,"gray"],[2,7,1,"yellow"],[4,7,4,"blue"],[9,7,1,"yellow"],[4,8,2,"gray"],[6,8,2,"gray"],[3,9,3,"black"],[6,9,3,"black"]],
  "Dog": [[1,1,1,"tan"],[2,2,3,"tan"],[1,3,1,"black"],[2,3,2,"tan"],[4,3,1,"black"],[2,4,3,"tan"],[10,3,1,"tan"],[9,4,2,"tan"],[3,5,6,"tan"],[3,6,2,"tan"],[5,6,2,"pink"],[7,6,2,"tan"],[3,7,6,"tan"],[3,8,1,"tan"],[8,8,1,"tan"],[3,9,1,"black"],[8,9,1,"black"],[5,9,2,"green"]],
};
const COLS = 12, ROWS = 10;

// ---------- sound ----------
const audio = createAudio({ defaultGain: 0.25 });
const { sfx } = audio;
function wrongDropSound() { if (settings.game.wrongDrop === "bonk") sfx.bonk(); }

// ---------- game ----------
const MODE_KEY = "heart-hands:bricks-mode";
let mode = (() => { try { return localStorage.getItem(MODE_KEY) === "coop" ? "coop" : "race"; } catch { return "race"; } })();
let cell = 34, running = false;
const clock = createClock();
let slots = createSlots({ mode: mode === "coop" ? "shared" : "split", settings });
const boards = [0, 1].map((b) => ({ b, board: $(`board${b + 1}`), tray: $(`tray${b + 1}`), blueprint: [], placed: 0 }));
/** Which board a slot builds on: its own in the race, the shared one in co-op. */
const boardOf = (slotIndex) => boards[mode === "coop" ? 0 : slotIndex];
/** Bricks placed by each slot this round (shown at the end of co-op). */
const placedBy = [0, 0];
/** Brick currently held by each slot: { el, ph, offX, offY, board } or null. */
const grabs = [null, null];

function brickEl(b) {
  const el = document.createElement("div"); el.className = "brick";
  el.style.setProperty("--w", b[2]); el.style.setProperty("--c", C[b[3]]);
  el.innerHTML = `<div class="studs">${"<i></i>".repeat(b[2])}</div>`;
  el.dataset.w = b[2]; el.dataset.color = b[3]; return el;
}
function setup() {
  const bricks = SETS[$("setSel").value], [minCell, maxCell] = settings.targets.brickCellPx;
  const width = mode === "coop" ? innerWidth : innerWidth / 2;
  cell = Math.max(minCell, Math.min(maxCell, Math.floor((width - 40) / COLS)));
  document.documentElement.style.setProperty("--cell", cell + "px");
  grabs.fill(null); placedBy.fill(0);
  boards.forEach((bd) => {
    bd.board.innerHTML = ""; bd.tray.innerHTML = ""; bd.placed = 0;
    bd.board.style.width = COLS * cell + "px"; bd.board.style.height = ROWS * cell + "px";
    bd.blueprint = bricks.map((b) => ({ x: b[0], y: b[1], w: b[2], color: b[3], done: false }));
    bd.blueprint.forEach((b) => {
      const g = document.createElement("div"); g.className = "ghost" + ($("hard").checked ? " hidecolor" : ""); g.style.setProperty("--c", C[b.color]);
      g.style.left = b.x * cell + "px"; g.style.top = b.y * cell + "px"; g.style.width = b.w * cell + "px"; g.style.height = cell + "px";
      b.ghost = g; bd.board.appendChild(g);
    });
    const deck = bricks.slice(); for (let i = deck.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [deck[i], deck[k]] = [deck[k], deck[i]]; }
    deck.forEach((b) => { const s = document.createElement("div"); s.className = "slot"; const el = brickEl(b); el.dataset.board = bd.b; s.appendChild(el); bd.tray.appendChild(s); });
  });
  updateScores(); clock.clear();
}
function applyMode() {
  document.body.classList.toggle("coop", mode === "coop");
  $("modeSel").value = mode;
  document.querySelector(".zone.p1 .who").childNodes[1].textContent = mode === "coop" ? "Together " : "Player 1 ";
  $("countHint").textContent = mode === "coop" ? "Get your hands up. One board, build it together." : "Get your hands up, one player on each side.";
}
function updateScores() { boards.forEach((bd) => ($(`s${bd.b + 1}`).textContent = `${bd.placed} / ${bd.blueprint.length}`)); }

// pick up a brick (from a hand or a pointer)
function pickUp(si, el, cx, cy) {
  const bd = boardOf(si);
  if (!running || grabs[si] || !el || el.classList.contains("set") || +el.dataset.board !== bd.b) return;
  const r = el.getBoundingClientRect();
  const ph = document.createElement("div"); ph.className = "brick"; ph.style.setProperty("--w", el.dataset.w); ph.style.visibility = "hidden";
  el.parentNode.insertBefore(ph, el); el.classList.add("dragging"); document.body.appendChild(el);
  grabs[si] = { el, ph, offX: cx - r.left, offY: cy - r.top, board: bd }; moveGrab(si, cx, cy);
}
function moveGrab(si, cx, cy) { const g = grabs[si]; g.el.style.left = (cx - g.offX) + "px"; g.el.style.top = (cy - g.offY) + "px"; }
function dropGrab(si, cx, cy) {
  const g = grabs[si]; if (!g) return; grabs[si] = null;
  const el = g.el, bd = g.board, br = bd.board.getBoundingClientRect();
  const left = cx - g.offX - br.left, top = cy - g.offY - br.top;
  const fx = left / cell, fy = top / cell, w = +el.dataset.w, color = el.dataset.color, snap = settings.targets.snapCells;
  const target = bd.blueprint.find((b) => !b.done && Math.abs(fx - b.x) <= snap && Math.abs(fy - b.y) <= snap && b.w === w && b.color === color);
  el.classList.remove("dragging"); el.style.left = ""; el.style.top = "";
  if (target) {
    const { x, y } = target;
    target.done = true; target.ghost.classList.add("done"); g.ph.remove();
    el.classList.add("set", "pop"); el.style.left = x * cell + "px"; el.style.top = y * cell + "px"; bd.board.appendChild(el);
    bd.placed++; placedBy[si]++; updateScores(); sfx.bing();
    const t = document.createElement("div"); t.className = "bing"; t.textContent = "Bing!"; t.style.left = (x + w / 2) * cell + "px"; t.style.top = y * cell - 6 + "px";
    bd.board.appendChild(t); setTimeout(() => t.remove(), 750);
    if (bd.placed === bd.blueprint.length) finish(bd);
  } else {
    g.ph.replaceWith(el); el.classList.add("nope"); setTimeout(() => el.classList.remove("nope"), 300);
    if (left > -cell && top > -cell && left < br.width && top < br.height) wrongDropSound();
  }
}
function brickAt(si, cx, cy) {
  let best = null, bestD = settings.targets.brickGrabPx;   // generous: a pinch near a brick counts
  for (const el of boardOf(si).tray.querySelectorAll(".brick")) {
    if (el.style.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    const dx = Math.max(r.left - cx, 0, cx - r.right), dy = Math.max(r.top - cy, 0, cy - r.bottom), d = Math.hypot(dx, dy);
    if (d < bestD) { bestD = d; best = el; }
  }
  return best;
}
/** Return any bricks still in players' hands to their trays. */
function releaseAll() {
  grabs.forEach((g, si) => { if (!g) return; grabs[si] = null; g.el.classList.remove("dragging"); g.el.style.left = ""; g.el.style.top = ""; g.ph.replaceWith(g.el); });
}

// ---------- input: one slot per player, hand or pointer ----------
function applyInput(si, inp) {
  if (inp.pressed && inp.x != null) pickUp(si, brickAt(si, inp.x, inp.y), inp.x, inp.y);
  if (inp.released) dropGrab(si, inp.x ?? -999, inp.y ?? -999);   // hand lost: drop off-board, brick goes back
  if (grabs[si] && inp.down && inp.x != null) moveGrab(si, inp.x, inp.y);
}
document.addEventListener("pointerdown", (e) => {
  if (e.target.closest("button, select, label, a, input")) return;
  audio.ensure(); if (slots.pointerDown(e.pointerId, e.clientX, e.clientY) >= 0) e.preventDefault();
});
document.addEventListener("pointermove", (e) => slots.pointerMove(e.pointerId, e.clientX, e.clientY));
const endPointer = (e) => slots.pointerUp(e.pointerId, e.clientX, e.clientY);
document.addEventListener("pointerup", endPointer); document.addEventListener("pointercancel", endPointer);

// ---------- race flow ----------
function startRace() {
  audio.ensure(); setup(); slots.reset(); running = false;
  runCountdown({ tickMs: settings.game.countdownMs, goLabel: "Go!", tick: sfx.tick, go: sfx.go, onGo: () => { running = true; clock.start(); } });
}
function finish(winner) {
  running = false; clock.stop(); sfx.fanfare(); confetti(Object.values(C));
  if (mode === "coop") {
    $("winTitle").textContent = "Built together!";
    $("winText").textContent = `${$("setSel").value} built in ${clock.text}. Player 1 placed ${placedBy[0]}, Player 2 placed ${placedBy[1]}.`;
    releaseAll(); setTimeout(() => $("winner").classList.add("on"), 900); return;
  }
  const other = boards[1 - winner.b];
  $("winTitle").textContent = `Player ${winner.b + 1} wins!`;
  $("winText").textContent = `${$("setSel").value} built in ${clock.text}. Player ${other.b + 1} had ${other.placed} of ${other.blueprint.length} bricks placed.`;
  releaseAll();
  setTimeout(() => $("winner").classList.add("on"), 900);
}

// ---------- frame loop: hands by half of the screen, pointer as fallback ----------
const video = $("video"), handCanvas = $("hands"), hctx = handCanvas.getContext("2d");
let tracker = null;
function frame() {
  const hands = tracker?.read();
  if (hands) slots.updateHands(hands);
  slots.frame().forEach((inp, si) => applyInput(si, inp));
  drawHands(hctx, slots);
  requestAnimationFrame(frame);
}
function resize() { fitCanvas(handCanvas); if (!running) setup(); }
addEventListener("resize", resize);

// ---------- wiring ----------
Object.keys(SETS).forEach((k) => { const o = document.createElement("option"); o.textContent = k; $("setSel").appendChild(o); });
$("setSel").addEventListener("change", () => { if (!running) setup(); });
$("start").addEventListener("click", startRace);
$("again").addEventListener("click", () => { $("winner").classList.remove("on"); const s = $("setSel"); s.selectedIndex = (s.selectedIndex + 1) % s.options.length; startRace(); });
$("modeSel").addEventListener("change", () => {
  mode = $("modeSel").value === "coop" ? "coop" : "race";
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* storage blocked: mode just isn't remembered */ }
  releaseAll(); running = false; clock.stop(); clock.clear();
  slots = createSlots({ mode: mode === "coop" ? "shared" : "split", settings });
  applyMode(); setup();
});
$("hard").addEventListener("change", () => boards.forEach((bd) => bd.blueprint.forEach((b) => b.ghost.classList.toggle("hidecolor", $("hard").checked))));
applyMode(); resize(); requestAnimationFrame(frame);
startCameraWithStatus(video).then((t) => { tracker = t; });
