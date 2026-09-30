// @ts-check
// Progress page: list the sessions stored on this device, show each one's
// steps or bricks, export them as CSV, or delete them all.
import { clearSessions, loadSessions, toCSV } from "@heart-hands/core";
import { $, mmss } from "./common.js";

/** Escape text for insertion into HTML (player labels are free text). */
const esc = (/** @type {unknown} */ v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
// Select values: "all", or "p:" + the player label (so no label can collide with "all").
const ALL = "all";
const valueFor = (/** @type {string} */ player) => `p:${player}`;
const matches = (/** @type {string} */ value, /** @type {string} */ player) => value === ALL || value === valueFor(player);

function render() {
  const all = loadSessions();
  const players = [...new Set(all.map((s) => s.player))].sort();
  const sel = /** @type {HTMLSelectElement} */ ($("playerSel"));
  const keep = sel.value || ALL;
  sel.innerHTML = `<option value="${ALL}">Everyone</option>` + players.map((p) => `<option value="${esc(valueFor(p))}">${p ? esc(p) : "(no name)"}</option>`).join("");
  sel.value = players.some((p) => valueFor(p) === keep) ? keep : ALL;
  const shown = all.filter((s) => matches(sel.value, s.player)).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));   // newest first

  $("summary").textContent = shown.length ? `${shown.length} session${shown.length === 1 ? "" : "s"}` : "No sessions yet. Play a game and it will show up here.";
  /** @type {HTMLButtonElement} */ ($("exportBtn")).disabled = !shown.length;
  if (!shown.length) { $("sessions").innerHTML = ""; return; }

  const handPct = (/** @type {import("@heart-hands/core").Session} */ s) => {
    const h = s.slots.reduce((n, x) => n + x.handFrames, 0), p = s.slots.reduce((n, x) => n + x.pointerFrames, 0);
    return h + p ? `${Math.round((100 * h) / (h + p))}%` : "–";
  };
  $("sessions").innerHTML = `<thead><tr><th>When</th><th>Player</th><th>Game</th><th>Mode</th><th>Dish / set</th><th>Profile</th><th>Time</th><th>Finished</th><th>Hand input</th></tr></thead><tbody>` +
    shown.map((s, i) => `<tr class="session" tabindex="0" data-i="${i}" aria-expanded="false">
      <td>${esc(new Date(s.startedAt).toLocaleString())}</td><td>${esc(s.player) || '<span class="muted">–</span>'}</td>
      <td>${esc(s.game)}</td><td>${esc(s.mode)}</td><td>${esc(s.detail)}${s.variant === "hidden" ? " (colours hidden)" : ""}</td>
      <td>${esc(s.profile)}</td><td>${mmss(s.seconds)}</td><td>${s.completed ? '<span class="yes">yes</span>' : '<span class="no">stopped</span>'}</td><td>${handPct(s)}</td></tr>`).join("") + "</tbody>";

  // click (or Enter) a session to show its steps / bricks underneath
  $("sessions").querySelectorAll("tr.session").forEach((tr) => {
    const toggle = () => {
      const open = tr.nextElementSibling?.classList.contains("detail");
      if (open) { tr.nextElementSibling?.remove(); tr.setAttribute("aria-expanded", "false"); return; }
      const s = shown[+(/** @type {HTMLElement} */ (tr).dataset.i ?? 0)];
      const rows = s.slots.flatMap((sl) => sl.rows.map((r) => ({ slot: sl.slot + 1, ...r })));
      const det = document.createElement("tr"); det.className = "detail";
      det.innerHTML = `<td colspan="9">${rows.length ? `<table><thead><tr>${s.slots.length > 1 ? "<th>Player</th>" : ""}<th>${s.game === "bricks" ? "Brick" : "Step"}</th><th>Gesture</th><th>Done</th><th>Seconds</th><th>Pinches</th><th>Missed</th></tr></thead><tbody>` +
        rows.map((r) => `<tr>${s.slots.length > 1 ? `<td>${r.slot}</td>` : ""}<td>${esc(r.name)}</td><td>${esc(r.gesture)}</td><td>${r.done} / ${r.need}</td><td>${r.seconds}</td><td>${r.pinches}</td><td>${r.missed}</td></tr>`).join("") +
        "</tbody></table>" : '<span class="muted">Stopped before the first step was finished.</span>'}</td>`;
      tr.after(det); tr.setAttribute("aria-expanded", "true");
    };
    tr.addEventListener("click", toggle);
    tr.addEventListener("keydown", (e) => { if (/** @type {KeyboardEvent} */ (e).key === "Enter") toggle(); });
  });
}

$("playerSel").addEventListener("change", render);
$("exportBtn").addEventListener("click", () => {
  const sel = /** @type {HTMLSelectElement} */ ($("playerSel")).value;
  const rows = loadSessions().filter((s) => matches(sel, s.player));
  const blob = new Blob([toCSV(rows)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `heart-hands-sessions-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$("clearBtn").addEventListener("click", () => {
  const n = loadSessions().length;
  if (!n) return;
  if (confirm(`Delete all ${n} sessions stored on this device? This can't be undone. Export a CSV first if you want a copy.`)) { clearSessions(); render(); }
});
render();
