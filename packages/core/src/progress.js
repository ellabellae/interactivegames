// @ts-check
// Session progress log: what happened in each game session, stored only in
// this browser on this device. No accounts, no server; nothing is sent
// anywhere. For the player, a therapist, or tuning thresholds.
//
// A session has one or more slots (players). Each slot has rows: one per
// recipe step (kitchen) or per placed brick (bricks).

export const SESSIONS_KEY = "heart-hands:sessions";
export const PLAYER_KEY = "heart-hands:player";
export const MAX_SESSIONS = 2000;   // oldest are dropped past this, so storage can't fill up

/**
 * @typedef {object} Row
 * @property {"step" | "brick"} type
 * @property {string} name          step name, or brick description ("2x red")
 * @property {string} gesture       gesture used (after profile substitution), e.g. "raise"
 * @property {number} need          repetitions needed (1 for a brick)
 * @property {number} done          repetitions counted
 * @property {number} seconds       time on this step / since the previous brick
 * @property {number} pinches       pinches (or presses) started
 * @property {number} missed        drops that missed the target / wrong brick drops
 *
 * @typedef {object} SlotRecord
 * @property {number} slot
 * @property {number} handFrames
 * @property {number} pointerFrames
 * @property {Row[]} rows
 *
 * @typedef {object} Session
 * @property {string} id
 * @property {string} startedAt     ISO time with the local offset
 * @property {string} player        optional label, may be ""
 * @property {string} game
 * @property {string} mode
 * @property {string} detail        dish or set
 * @property {string} variant       e.g. "colors" / "hidden"
 * @property {string} profile
 * @property {Record<string, number>} thresholds  the values in effect (see thresholdColumns)
 * @property {boolean} completed
 * @property {number} seconds
 * @property {SlotRecord[]} slots
 */

/** Threshold values copied into every session, so logs stay meaningful after settings change. */
export function thresholdColumns(/** @type {import("./settings.js").Settings} */ s) {
  return {
    pinch_on: s.pinch.on, pinch_off: s.pinch.off, pinch_hold_frames: s.pinch.holdFrames,
    cursor_smoothing: s.cursor.smoothing, hand_lost_frames: s.tracking.handLostFrames,
    pad_px: s.targets.padPx, brick_grab_px: s.targets.brickGrabPx, snap_cells: s.targets.snapCells,
    stir_turns: s.gestures.stir.turnsPerCount, chop_px: s.gestures.chop.travelPx, shake_px: s.gestures.shake.travelPx,
    flick_px_per_s: s.gestures.flick.minSpeedPxPerS, raise_px: s.gestures.raise?.travelPx ?? 0, raise_s: s.gestures.raise?.maxS ?? 0,
    reps_scale: s.game.repsScale,
  };
}

/** Local time as ISO 8601 with the UTC offset, e.g. 2026-09-29T17:05:00-04:00. */
export function localIso(/** @type {Date} */ d) {
  const pad = (/** @type {number} */ n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${off >= 0 ? "+" : "-"}${pad(off / 60)}:${pad(off % 60)}`;
}

/**
 * Record one session while it's played.
 * @param {{ game: string, mode: string, detail: string, variant?: string, settings: import("./settings.js").Settings, slots: number, player?: string, now?: () => number }} o
 */
export function createSession(o) {
  const now = o.now ?? (() => performance.now());
  const t0 = now();
  /** @type {Session} */
  const rec = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    startedAt: localIso(new Date()), player: (o.player ?? "").slice(0, 40), game: o.game, mode: o.mode, detail: o.detail, variant: o.variant ?? "",
    profile: o.settings.id, thresholds: thresholdColumns(o.settings), completed: false, seconds: 0,
    slots: Array.from({ length: o.slots }, (_, slot) => ({ slot, handFrames: 0, pointerFrames: 0, rows: [] })),
  };
  /** open row per slot, with its start time */
  const open = rec.slots.map(() => /** @type {{ row: Row, t: number } | null} */ (null));
  const lastEnd = rec.slots.map(() => t0);
  const pending = rec.slots.map(() => ({ pinches: 0, missed: 0 }));   // counts between bricks
  let ended = false;
  return {
    record: rec,
    /** Start timing a recipe step for a slot (closes any open one as unfinished). */
    beginStep(/** @type {number} */ slot, /** @type {{ name: string, gesture: string, need: number }} */ step) {
      if (ended) return;
      this.endStep(slot);
      open[slot] = { row: { type: "step", name: step.name, gesture: step.gesture, need: step.need, done: 0, seconds: 0, pinches: 0, missed: 0 }, t: now() };
    },
    /** Close the open step. */
    endStep(/** @type {number} */ slot) {
      const o2 = open[slot]; if (!o2) return;
      o2.row.seconds = round((now() - o2.t) / 1000);
      rec.slots[slot].rows.push(o2.row); open[slot] = null; lastEnd[slot] = now();
    },
    /** A counted repetition in the open step. */
    rep(/** @type {number} */ slot) { if (open[slot]) /** @type {any} */ (open[slot]).row.done++; },
    pinch(/** @type {number} */ slot) { if (open[slot]) /** @type {any} */ (open[slot]).row.pinches++; else pending[slot].pinches++; },
    miss(/** @type {number} */ slot) { if (open[slot]) /** @type {any} */ (open[slot]).row.missed++; else pending[slot].missed++; },
    /** A brick placed by a slot: one row, timed from the previous brick (or the start). */
    brick(/** @type {number} */ slot, /** @type {string} */ name) {
      if (ended) return;
      const t = now();
      rec.slots[slot].rows.push({ type: "brick", name, gesture: "pinch-drag", need: 1, done: 1, seconds: round((t - lastEnd[slot]) / 1000), pinches: pending[slot].pinches, missed: pending[slot].missed });
      lastEnd[slot] = t; pending[slot] = { pinches: 0, missed: 0 };
    },
    /** Called once per frame with each slot's input source, to measure hand vs mouse use. */
    input(/** @type {number} */ slot, /** @type {"hand" | "pointer" | null} */ source) {
      if (source === "hand") rec.slots[slot].handFrames++;
      else if (source === "pointer") rec.slots[slot].pointerFrames++;
    },
    /** Finish: closes open steps and returns the record (completed or not). */
    end(/** @type {boolean} */ completed) {
      if (ended) return rec;
      rec.slots.forEach((_, i) => this.endStep(i));
      rec.completed = completed; rec.seconds = round((now() - t0) / 1000); ended = true;
      return rec;
    },
    get ended() { return ended; },
  };
}
const round = (/** @type {number} */ x) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------- storage

/** @typedef {Pick<Storage, "getItem" | "setItem" | "removeItem">} SessionStorageLike */
function defaultStorage() { try { return /** @type {SessionStorageLike | null} */ (globalThis.localStorage ?? null); } catch { return null; } }

/** @param {SessionStorageLike | null} [storage] @returns {Session[]} */
export function loadSessions(storage = defaultStorage()) {
  try { const v = JSON.parse(storage?.getItem(SESSIONS_KEY) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}

/**
 * Add a session. Drops the oldest past MAX_SESSIONS, and if storage is full,
 * drops the oldest 10% and tries again. Returns false if it couldn't save.
 * @param {Session} session @param {SessionStorageLike | null} [storage]
 */
export function saveSession(session, storage = defaultStorage()) {
  if (!storage) return false;
  let all = [...loadSessions(storage), session].slice(-MAX_SESSIONS);
  for (let attempt = 0; attempt < 5; attempt++) {
    try { storage.setItem(SESSIONS_KEY, JSON.stringify(all)); return true; }
    catch { if (all.length <= 1) return false; all = all.slice(Math.ceil(all.length * 0.1)); }
  }
  return false;
}

/** @param {SessionStorageLike | null} [storage] */
export function clearSessions(storage = defaultStorage()) { try { storage?.removeItem(SESSIONS_KEY); return true; } catch { return false; } }

/** The optional "who's playing" label, trimmed to 40 characters. */
export function loadPlayer(storage = defaultStorage()) { try { return (storage?.getItem(PLAYER_KEY) ?? "").slice(0, 40); } catch { return ""; } }
export function savePlayer(/** @type {string} */ name, storage = defaultStorage()) { try { storage?.setItem(PLAYER_KEY, name.trim().slice(0, 40)); } catch { /* not remembered */ } }

// ---------------------------------------------------------------- CSV

/**
 * One CSV cell. Quotes when needed, and neutralises text that a spreadsheet
 * would run as a formula (a label starting with =, +, -, @, tab or CR).
 * @param {unknown} v
 */
export function csvCell(v) {
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "yes" : "no";
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Column order for the export. Session columns repeat on every row. */
export const CSV_COLUMNS = [
  "session_id", "started_at", "player", "game", "mode", "detail", "variant", "profile", "completed", "session_seconds",
  "slot", "hand_input_percent", "row_type", "row_number", "name", "gesture", "reps_needed", "reps_done", "seconds", "pinches", "missed",
];

/**
 * Long-format CSV: one row per step or brick, session details repeated, then
 * the thresholds in effect. Sessions with no rows still get one row.
 * @param {Session[]} sessions
 */
export function toCSV(sessions) {
  const tKeys = Object.keys(sessions[0]?.thresholds ?? {});
  const header = [...CSV_COLUMNS, ...tKeys];
  const lines = [header.join(",")];
  for (const s of sessions) {
    for (const sl of s.slots) {
      const total = sl.handFrames + sl.pointerFrames;
      const handPct = total ? Math.round((100 * sl.handFrames) / total) : "";
      const base = [s.id, s.startedAt, s.player, s.game, s.mode, s.detail, s.variant, s.profile, s.completed, s.seconds, sl.slot + 1, handPct];
      const rows = sl.rows.length ? sl.rows : [null];
      rows.forEach((r, i) => {
        const cells = [...base, r?.type ?? "", r ? i + 1 : "", r?.name ?? "", r?.gesture ?? "", r?.need ?? "", r?.done ?? "", r?.seconds ?? "", r?.pinches ?? "", r?.missed ?? "", ...tKeys.map((k) => s.thresholds[k])];
        lines.push(cells.map(csvCell).join(","));
      });
    }
  }
  return lines.join("\r\n") + "\r\n";
}
