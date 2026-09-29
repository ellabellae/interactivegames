// @ts-check
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.js", "apps/**/*.test.js"],
    environment: "node",
  },
});
