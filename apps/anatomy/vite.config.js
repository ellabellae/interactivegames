// @ts-check
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { cdnPlugin } from "@heart-hands/core/build/cdn-plugin.js";

// Relative base so the output works on GitHub Pages under /<repo>/ and as file://.
// Pages are built one at a time by scripts/build.mjs; each becomes one self-contained HTML file.
export default defineConfig({
  base: "./",
  build: { modulePreload: { polyfill: false } },
  plugins: [cdnPlugin(), viteSingleFile({ removeViteModuleLoader: true })],
});
