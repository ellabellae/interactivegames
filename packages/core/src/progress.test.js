// @ts-check
import { describe, expect, it } from "vitest";
import { CSV_COLUMNS, MAX_SESSIONS, SESSIONS_KEY, clearSessions, createSession, csvCell, loadPlayer, loadSessions, localIso, savePlayer, saveSession, toCSV } from "./progress.js";
import { GENTLE, STANDARD } from "./settings.js";

function memoryStorage(/** @type {number} */ quota = Infinity) {
  /** @type {Record<string, string>} */ const data = {};
  return {
    data,
    getItem: (/** @type {string} */ k) => data[k] ?? null,
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => { if (v.length > quota) throw new Error("QuotaExceededError"); data[k] = v; },
    removeItem: (/** @type {string} */ k) => { delete data[k]; },
  };
}
/** A fake clock in ms. */
const clock = () => { let t = 0; return { now: () => t, tick: (/** @type {number} */ ms) => { t += ms; } }; };

describe("createSession", () => {
  it("times recipe steps and counts reps, pinches and misses per slot", () => {
    const c = clock();
    const s = createSession({ game: "kitchen", mode: "solo", detail: "Pancakes", settings: GENTLE, slots: 1, player: "AB", now: c.now });
    s.beginStep(0, { name: "Crack eggs", gesture: "pinchdrop", need: 2 });
    s.pinch(0); s.miss(0); s.pinch(0); s.rep(0); s.pinch(0); s.rep(0); c.tick(4500);
    s.beginStep(0, { name: "Flip", gesture: "raise", need: 2 }); c.tick(2000);
    const rec = s.end(true);
    expect(rec.slots[0].rows).toEqual([
      { type: "step", name: "Crack eggs", gesture: "pinchdrop", need: 2, done: 2, seconds: 4.5, pinches: 3, missed: 1 },
      { type: "step", name: "Flip", gesture: "raise", need: 2, done: 0, seconds: 2, pinches: 0, missed: 0 },
    ]);
    expect(rec).toMatchObject({ completed: true, seconds: 6.5, profile: "gentle", player: "AB", game: "kitchen", mode: "solo" });
  });
  it("records the thresholds in effect", () => {
    const rec = createSession({ game: "kitchen", mode: "race", detail: "Sundae", settings: GENTLE, slots: 2 }).end(false);
    expect(rec.thresholds).toMatchObject({ pinch_on: 0.38, pinch_off: 0.55, cursor_smoothing: 0.25, chop_px: 12, raise_px: 60, raise_s: 3, reps_scale: 0.5 });
    expect(createSession({ game: "k", mode: "race", detail: "", settings: STANDARD, slots: 1 }).record.thresholds.raise_px).toBe(0);
  });
  it("logs one row per placed brick, timed from the previous one, with wrong drops in between", () => {
    const c = clock();
    const s = createSession({ game: "bricks", mode: "coop", detail: "Dog", variant: "colors", settings: STANDARD, slots: 2, now: c.now });
    c.tick(3000); s.pinch(0); s.miss(0); s.pinch(0); s.brick(0, "2x tan");
    c.tick(1000); s.pinch(1); s.brick(1, "1x black");
    c.tick(2000); s.pinch(0); s.brick(0, "3x tan");
    const rec = s.end(true);
    expect(rec.slots[0].rows.map((r) => [r.name, r.seconds, r.pinches, r.missed])).toEqual([["2x tan", 3, 2, 1], ["3x tan", 3, 1, 0]]);
    expect(rec.slots[1].rows.map((r) => [r.name, r.seconds])).toEqual([["1x black", 4]]);
  });
  it("measures hand vs mouse use", () => {
    const s = createSession({ game: "k", mode: "solo", detail: "", settings: STANDARD, slots: 1 });
    for (let i = 0; i < 30; i++) s.input(0, "hand");
    for (let i = 0; i < 10; i++) s.input(0, "pointer");
    s.input(0, null);
    expect(s.record.slots[0]).toMatchObject({ handFrames: 30, pointerFrames: 10 });
  });
  it("ends once; later calls change nothing", () => {
    const c = clock();
    const s = createSession({ game: "k", mode: "solo", detail: "", settings: STANDARD, slots: 1, now: c.now });
    c.tick(1000); s.end(false); c.tick(5000);
    s.beginStep(0, { name: "x", gesture: "stir", need: 1 }); s.brick(0, "b");
    expect(s.end(true)).toMatchObject({ completed: false, seconds: 1 });
    expect(s.record.slots[0].rows).toEqual([]);
  });
  it("keeps the player label short", () => {
    expect(createSession({ game: "k", mode: "solo", detail: "", settings: STANDARD, slots: 1, player: "x".repeat(100) }).record.player).toHaveLength(40);
  });
});

describe("storage", () => {
  const rec = () => createSession({ game: "k", mode: "solo", detail: "", settings: STANDARD, slots: 1 }).end(true);
  it("saves, loads and clears sessions", () => {
    const st = memoryStorage();
    saveSession(rec(), st); saveSession(rec(), st);
    expect(loadSessions(st)).toHaveLength(2);
    clearSessions(st);
    expect(loadSessions(st)).toEqual([]);
  });
  it("keeps at most MAX_SESSIONS, dropping the oldest", () => {
    const st = memoryStorage();
    st.setItem(SESSIONS_KEY, JSON.stringify(Array.from({ length: MAX_SESSIONS }, (_, i) => ({ id: String(i) }))));
    saveSession({ ...rec(), id: "new" }, st);
    const all = loadSessions(st);
    expect(all).toHaveLength(MAX_SESSIONS); expect(all[0].id).toBe("1"); expect(all.at(-1)?.id).toBe("new");
  });
  it("makes room when storage is full instead of losing the new session", () => {
    const st = memoryStorage(6000);
    for (let i = 0; i < 40; i++) saveSession({ ...rec(), id: `s${i}` }, st);
    const all = loadSessions(st);
    expect(all.at(-1)?.id).toBe("s39");
    expect(all.length).toBeLessThan(40);
  });
  it("survives corrupt or missing storage", () => {
    const st = memoryStorage(); st.setItem(SESSIONS_KEY, "{oops");
    expect(loadSessions(st)).toEqual([]);
    expect(loadSessions(null)).toEqual([]);
    expect(saveSession(rec(), null)).toBe(false);
  });
  it("remembers the optional player label", () => {
    const st = memoryStorage();
    expect(loadPlayer(st)).toBe("");
    savePlayer("  JD  ", st);
    expect(loadPlayer(st)).toBe("JD");
  });
});

describe("CSV export", () => {
  it("escapes commas, quotes and new lines", () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(csvCell(1.5)).toBe("1.5"); expect(csvCell(true)).toBe("yes"); expect(csvCell(null)).toBe("");
  });
  it("neutralises text a spreadsheet would run as a formula", () => {
    for (const bad of ["=HYPERLINK(\"x\")", "+1", "-2+3", "@SUM(A1)"]) expect(csvCell(bad).replace(/^"/, "").startsWith("'")).toBe(true);
    expect(csvCell(-2)).toBe("-2");   // real numbers are left alone
  });
  it("writes one row per step, with session details and thresholds on each", () => {
    const c = clock();
    const s = createSession({ game: "kitchen", mode: "solo", detail: "Pancakes", settings: GENTLE, slots: 1, player: "=cmd", now: c.now });
    s.beginStep(0, { name: "Crack eggs", gesture: "pinchdrop", need: 2 }); s.rep(0); s.rep(0); c.tick(3000);
    s.beginStep(0, { name: "Stir batter", gesture: "stir", need: 2 }); c.tick(1000);
    for (let i = 0; i < 3; i++) s.input(0, "hand"); s.input(0, "pointer");
    const csv = toCSV([s.end(true)]);
    const [head, ...rows] = csv.trim().split("\r\n");
    expect(head.split(",").slice(0, CSV_COLUMNS.length)).toEqual(CSV_COLUMNS);
    expect(head).toContain("pinch_on"); expect(head).toContain("raise_px");
    expect(rows).toHaveLength(2);
    const cols = rows[0].split(",");
    const at = (/** @type {string} */ name) => cols[head.split(",").indexOf(name)];
    expect(at("player")).toBe("'=cmd");
    expect(at("name")).toBe("Crack eggs"); expect(at("reps_done")).toBe("2"); expect(at("seconds")).toBe("3");
    expect(at("hand_input_percent")).toBe("75"); expect(at("profile")).toBe("gentle"); expect(at("pinch_on")).toBe("0.38");
  });
  it("still lists a session that ended before any step or brick", () => {
    const csv = toCSV([createSession({ game: "bricks", mode: "race", detail: "Robot", settings: STANDARD, slots: 2 }).end(false)]);
    expect(csv.trim().split("\r\n")).toHaveLength(3);   // header + one row per slot
  });
  it("is just a header when there are no sessions", () => {
    expect(toCSV([]).trim().split("\r\n")).toHaveLength(1);
  });
});

describe("localIso", () => {
  it("formats local time with its UTC offset", () => {
    expect(localIso(new Date(2026, 8, 29, 7, 5, 9))).toMatch(/^2026-09-29T07:05:09[+-]\d\d:\d\d$/);
  });
});
