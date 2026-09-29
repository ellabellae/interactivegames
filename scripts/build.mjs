// Builds every page of every app into dist/ as one self-contained HTML file.
//
//   dist/index.html            site/index.html (links to both apps)
//   dist/anatomy/<page>.html   one file per apps/anatomy/*.html
//   dist/games/<page>.html     one file per apps/games/*.html
//
// Vite is run once per page because inlining everything into one file only
// works with a single entry point.
import { build } from "vite";
import { readdir, rm, mkdir, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");
const apps = ["anatomy", "games"];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await copyFile(join(root, "site/index.html"), join(dist, "index.html"));

for (const app of apps) {
  const appRoot = join(root, "apps", app);
  const pages = (await readdir(appRoot)).filter((f) => f.endsWith(".html")).sort();
  for (const page of pages) {
    console.log(`\n▶ ${app}/${page}`);
    await build({
      root: appRoot,
      configFile: join(appRoot, "vite.config.js"),
      logLevel: "warn",
      build: {
        outDir: join(dist, app),
        emptyOutDir: false,
        rollupOptions: { input: join(appRoot, page) },
      },
    });
  }
}
console.log(`\nBuilt into ${dist}`);
