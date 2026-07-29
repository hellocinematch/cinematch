#!/usr/bin/env node
/**
 * Writes /.well-known files for iOS Universal Links + Android App Links (/join/:token).
 *
 * Env (Vercel build or local before deploy):
 *   APPLE_TEAM_ID              — 10-char Apple Developer Team ID (required for iOS verify)
 *   ANDROID_SHA256_FINGERPRINT — release keystore SHA-256 (colon-free or with colons)
 *
 * Optional extra Android fingerprints (debug + release): comma-separated in
 *   ANDROID_SHA256_FINGERPRINTS
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "public", ".well-known");

const BUNDLE_ID = "com.cinemastro.app";
const teamId = (process.env.APPLE_TEAM_ID || "").trim();
const singleFp = (process.env.ANDROID_SHA256_FINGERPRINT || "").trim();
const multiFp = (process.env.ANDROID_SHA256_FINGERPRINTS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function normalizeSha256(fp) {
  return fp.replace(/:/g, "").toUpperCase();
}

const androidFps = [...new Set([singleFp, ...multiFp].filter(Boolean).map(normalizeSha256))];

const aasa = {
  applinks: {
    apps: [],
    details: [
      {
        appIDs: teamId ? [`${teamId}.${BUNDLE_ID}`] : [],
        components: [{ "/": "/join/*" }],
      },
    ],
  },
};

const assetlinks =
  androidFps.length > 0
    ? [
        {
          relation: ["delegate_permission/common.handle_all_urls"],
          target: {
            namespace: "android_app",
            package_name: BUNDLE_ID,
            sha256_cert_fingerprints: androidFps,
          },
        },
      ]
    : [];

await mkdir(outDir, { recursive: true });
await writeFile(
  path.join(outDir, "apple-app-site-association"),
  `${JSON.stringify(aasa, null, 2)}\n`,
  "utf8",
);
await writeFile(
  path.join(outDir, "assetlinks.json"),
  `${JSON.stringify(assetlinks, null, 2)}\n`,
  "utf8",
);

if (!teamId) {
  console.warn(
    "generate-universal-link-files: APPLE_TEAM_ID unset — iOS Universal Links will not verify until Vercel env is set.",
  );
}
if (androidFps.length === 0) {
  console.warn(
    "generate-universal-link-files: ANDROID_SHA256_FINGERPRINT unset — Android App Links will not verify until set.",
  );
}
console.log("Wrote public/.well-known/apple-app-site-association and assetlinks.json");
