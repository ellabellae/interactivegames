// @ts-check
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { LECTURE, activationTimes, computeSchedule, cumulative, stages } from "./conduction-model.js";

const data = JSON.parse(readFileSync(new URL("../data/conduction-landmarks.json", import.meta.url), "utf8"));
const s = computeSchedule(data.paths);
const allPurkinjeEnds = [...s.times.purkinjeLV, ...s.times.purkinjeRV].map((t) => /** @type {number[]} */ (t).at(-1) ?? 0);

describe("one beat, lecture timings", () => {
  it("starts at the SA node at 0 ms", () => {
    expect(/** @type {number[]} */ (s.times.internodalMiddle)[0]).toBe(0);
  });
  it("reaches the AV node along the internodal pathways at 1 m/s (derived from path length)", () => {
    const shortest = Math.min(...["internodalAnterior", "internodalMiddle", "internodalPosterior"].map((k) => cumulative(data.paths[k]).at(-1) ?? 0));
    expect(s.tAV).toBeCloseTo(shortest / 1.0, 6);
    expect(s.tAV).toBeGreaterThan(20); expect(s.tAV).toBeLessThan(120);   // plausible for a 5 cm route
  });
  it("holds the impulse 100 ms at the AV node (slides 5, 11)", () => {
    expect(s.tHis - s.tAV).toBeCloseTo(LECTURE.avDelayMs.value, 6);
  });
  it("reaches the last Purkinje ending about 30 ms after the bundle branches start (slide 12)", () => {
    // "about 0.03 s": within 25-40 ms, with the speed held inside 1.5-4 m/s
    expect(s.tLastPurkinje - s.tBranch).toBeGreaterThanOrEqual(25);
    expect(s.tLastPurkinje - s.tBranch).toBeLessThanOrEqual(40);
    expect(Math.max(...allPurkinjeEnds)).toBeCloseTo(s.tLastPurkinje, 6);
  });
  it("uses a fast-system speed inside the lecture's Purkinje range, 1.5-4 m/s (slide 12)", () => {
    expect(s.vFast).toBeGreaterThanOrEqual(1.5); expect(s.vFast).toBeLessThanOrEqual(4);
  });
  it("finishes the ventricles 60 ms after the bundle branches start, after the last Purkinje ending (slide 13)", () => {
    expect(s.tLastVentricle - s.tBranch).toBe(60);
    expect(s.tLastVentricle).toBeGreaterThan(s.tLastPurkinje);
  });
  it("never goes backwards along any path", () => {
    for (const t of Object.values(s.times)) {
      const rows = Array.isArray(t[0]) ? /** @type {number[][]} */ (t) : [/** @type {number[]} */ (t)];
      for (const row of rows) for (let i = 1; i < row.length; i++) expect(row[i]).toBeGreaterThanOrEqual(row[i - 1]);
    }
  });
  it("activates the ventricles only after the AV delay (one-way conduction, slide 14)", () => {
    for (const t of [...s.times.purkinjeLV, ...s.times.purkinjeRV]) expect(/** @type {number[]} */ (t)[0]).toBeGreaterThanOrEqual(s.tHis);
  });
  it("lists the six stages of slide 5 in time order", () => {
    const st = stages(s);
    expect(st.map((x) => x.id)).toEqual(["rest", "atria", "av", "bundle", "purkinje", "contract"]);
    for (let i = 1; i < st.length; i++) expect(st[i].start).toBeGreaterThanOrEqual(st[i - 1].start);
  });
});

describe("activationTimes (muscle spread)", () => {
  it("spreads from the nearest source at the given speed", () => {
    const t = activationTimes([0, 0, 0, 10, 0, 0], [{ p: [0, 0, 0], t: 5 }], 0.5);
    expect([...t]).toEqual([5, 25]);
  });
  it("takes the earliest of several sources", () => {
    const t = activationTimes([10, 0, 0], [{ p: [0, 0, 0], t: 0 }, { p: [12, 0, 0], t: 1 }], 1);
    expect(t[0]).toBeCloseTo(3);
  });
  it("scaled spread never passes the set time, even with later sources (stretching)", () => {
    // early source far away, late source close by: stretching to 160 ms must not push the close point past 160
    const t = activationTimes([0, 0, 0, 2, 0, 0, 50, 0, 0], [{ p: [0, 0, 0], t: 100 }, { p: [50, 0, 0], t: 150 }], 1, 160);
    expect(Math.max(...t)).toBeCloseTo(160, 6);
  });
  it("can be scaled so the last point activates at a set time", () => {
    const t = activationTimes([0, 0, 0, 10, 0, 0, 20, 0, 0], [{ p: [0, 0, 0], t: 100 }], 1, 160);
    expect(t[2]).toBeCloseTo(160); expect(t[1]).toBeCloseTo(130); expect(t[0]).toBe(100);
  });
});
