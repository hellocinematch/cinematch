/**
 * Rasterizes public/cinemastro-pwa-icon.svg to PNGs for apple-touch-icon and manifest.
 * Run after changing the master SVG: node scripts/generate-pwa-touch-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const svgPath = path.join(root, "public", "cinemastro-pwa-icon.svg");
const svg = fs.readFileSync(svgPath, "utf8");

const sizes = [
  { file: "apple-touch-icon.png", size: 180 },
  { file: "pwa-icon-192.png", size: 192 },
];

for (const { file, size } of sizes) {
  const resvg = new Resvg(svg, {
    fitTo: {
      mode: "width",
      value: size,
    },
  });
  const out = resvg.render();
  const png = out.asPng();
  const dest = path.join(root, "public", file);
  fs.writeFileSync(dest, png);
  console.log("Wrote", path.relative(root, dest), `(${size}×${size})`);
}
