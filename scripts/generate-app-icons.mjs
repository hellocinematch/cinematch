/**
 * Native app icons from public/cinemastro-pwa-icon.svg (same master as PWA).
 * Writes assets/icon-only.png then runs @capacitor/assets for iOS + Android.
 */
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const svgPath = path.join(root, "public", "cinemastro-pwa-icon.svg");
const assetsDir = path.join(root, "assets");
const iconOnlyPath = path.join(assetsDir, "icon-only.png");
const ICON_PX = 1024;
const BG = "#0a0a0a";

const svg = readFileSync(svgPath, "utf8");
mkdirSync(assetsDir, { recursive: true });

const resvg = new Resvg(svg, {
  fitTo: { mode: "width", value: ICON_PX },
});
writeFileSync(iconOnlyPath, resvg.render().asPng());
console.log("Wrote", path.relative(root, iconOnlyPath), `(${ICON_PX}×${ICON_PX})`);

const args = [
  "@capacitor/assets",
  "generate",
  "--ios",
  "--android",
  `--iconBackgroundColor=${BG}`,
  `--iconBackgroundColorDark=${BG}`,
];
const run = spawnSync("npx", args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
if (run.status !== 0) {
  process.exit(run.status ?? 1);
}

/** Adaptive icons (API 26+) use foreground + background; sync foreground from full icon. */
const androidRes = path.join(root, "android", "app", "src", "main", "res");
for (const dir of readdirSync(androidRes)) {
  if (!dir.startsWith("mipmap-")) continue;
  const launcher = path.join(androidRes, dir, "ic_launcher.png");
  const foreground = path.join(androidRes, dir, "ic_launcher_foreground.png");
  try {
    copyFileSync(launcher, foreground);
  } catch {
    /* density may omit foreground */
  }
}

console.log("Capacitor iOS + Android icon assets updated.");
