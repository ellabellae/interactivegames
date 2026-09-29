// @ts-check
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { IMPORT_MAP, TASKS_VISION_VERSION, TASKS_VISION_WASM, THREE_VERSION } from "./cdn.js";

const rootPkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));

describe("CDN pins", () => {
  it("are exact versions, not ranges", () => {
    expect(THREE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(TASKS_VISION_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("use the pinned version in every URL", () => {
    expect(IMPORT_MAP["three"]).toContain(`three@${THREE_VERSION}/`);
    expect(IMPORT_MAP["three/addons/"]).toContain(`three@${THREE_VERSION}/`);
    expect(IMPORT_MAP["@mediapipe/tasks-vision"]).toContain(`tasks-vision@${TASKS_VISION_VERSION}`);
    expect(TASKS_VISION_WASM).toContain(`tasks-vision@${TASKS_VISION_VERSION}/`);
  });

  // The npm packages are installed for editor types only. If someone bumps a
  // CDN version without bumping its types (or the reverse), this fails.
  it("match the type-only devDependencies", () => {
    expect(rootPkg.devDependencies["@types/three"]).toBe(THREE_VERSION);
    expect(rootPkg.devDependencies["@mediapipe/tasks-vision"]).toBe(TASKS_VISION_VERSION);
  });
});
