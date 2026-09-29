// @ts-check
// Vite plugin that keeps CDN dependencies external instead of bundling them.
//
// Source files import bare specifiers ("three", "three/addons/...",
// "@mediapipe/tasks-vision") so editors and the type checker can find types
// in node_modules. At dev and build time this plugin:
//   1. resolves those specifiers to the pinned CDN URLs and marks them
//      external, so nothing from them is bundled, and
//   2. injects a matching <script type="importmap"> into every page, which
//      the three.js addon files need because they import "three" themselves.
// The result works from the dev server, from GitHub Pages, and opened
// directly as a file in Chrome.
import { IMPORT_MAP } from "../src/cdn.js";

/** @returns {import("vite").Plugin} */
export function cdnPlugin() {
  const prefixes = Object.entries(IMPORT_MAP).filter(([k]) => k.endsWith("/"));
  return {
    name: "heart-hands:cdn",
    enforce: "pre",
    resolveId(id) {
      if (id in IMPORT_MAP && !id.endsWith("/")) return { id: IMPORT_MAP[/** @type {keyof typeof IMPORT_MAP} */ (id)], external: true };
      for (const [prefix, url] of prefixes) {
        if (id.startsWith(prefix)) return { id: url + id.slice(prefix.length), external: true };
      }
      return null;
    },
    transformIndexHtml: {
      order: "pre",
      handler: () => [
        { tag: "script", attrs: { type: "importmap" }, children: JSON.stringify({ imports: IMPORT_MAP }, null, 2), injectTo: "head-prepend" },
      ],
    },
  };
}
