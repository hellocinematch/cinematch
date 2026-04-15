#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

/**
 * Merge weekly generated ratings into SeedDataWeeklyAdd/ratings-prev-loaded.csv.
 *
 * Defaults:
 *   --dir=SeedDataWeeklyAdd
 *   --weekly=<latest New_ratings_MMDDYYYY.csv in dir>
 *   --prev=ratings-prev-loaded.csv
 *
 * Behavior:
 * - Dedupe key: external_id + media_type + tmdb_id
 * - "Latest wins": weekly rows overwrite previous score on same key
 * - Output written back to --prev unless --out is provided
 *
 * Usage:
 *   node scripts/merge-weekly-ratings-into-prev-loaded.mjs
 *   node scripts/merge-weekly-ratings-into-prev-loaded.mjs --weekly=SeedDataWeeklyAdd/New_ratings_04152026.csv
 *   node scripts/merge-weekly-ratings-into-prev-loaded.mjs --out=SeedDataWeeklyAdd/ratings-prev-loaded-merged.csv
 */

const ROOT = process.cwd();

function parseArgs(argv) {
  const out = {
    dir: path.join(ROOT, "SeedDataWeeklyAdd"),
    weekly: null,
    prev: null,
    out: null,
  };
  for (const a of argv) {
    if (a.startsWith("--dir=")) out.dir = path.resolve(a.slice(6));
    else if (a.startsWith("--weekly=")) out.weekly = path.resolve(a.slice(9));
    else if (a.startsWith("--prev=")) out.prev = path.resolve(a.slice(7));
    else if (a.startsWith("--out=")) out.out = path.resolve(a.slice(6));
  }
  return out;
}

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && ch === ",") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function normalizeMediaType(v) {
  return String(v || "").trim().toLowerCase();
}

function rowKey(externalId, mediaType, tmdbId) {
  return `${externalId}|${mediaType}|${tmdbId}`;
}

function latestWeeklyFile(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => /^New_ratings_\d{8}\.csv$/i.test(f)).sort();
  if (files.length === 0) return null;
  return path.join(dir, files[files.length - 1]);
}

async function readRatingsRows(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} file not found: ${filePath}`);
  }
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let header = null;
  const rows = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    if (!header) {
      header = cols.map((h) => h.toLowerCase().replace(/\s+/g, "_"));
      const hasExternal = header.includes("external_id");
      const hasType = header.includes("media_type");
      const hasTmdb = header.includes("tmdb_id");
      const hasScore = header.includes("score");
      if (!hasExternal || !hasType || !hasTmdb || !hasScore) {
        throw new Error(
          `${path.basename(filePath)} must include header columns: external_id, media_type, tmdb_id, score`,
        );
      }
      continue;
    }

    const ext = (cols[header.indexOf("external_id")] || "").trim();
    const media = normalizeMediaType(cols[header.indexOf("media_type")]);
    const tmdb = Number(cols[header.indexOf("tmdb_id")]);
    const score = Number(cols[header.indexOf("score")]);
    if (!ext || (media !== "movie" && media !== "tv") || !Number.isFinite(tmdb) || !Number.isFinite(score)) {
      continue;
    }
    rows.push({
      external_id: ext,
      media_type: media,
      tmdb_id: tmdb,
      score,
    });
  }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prevPath = args.prev || path.join(args.dir, "ratings-prev-loaded.csv");
  const weeklyPath = args.weekly || latestWeeklyFile(args.dir);
  const outPath = args.out || prevPath;

  if (!weeklyPath) {
    throw new Error(
      `No weekly New_ratings_MMDDYYYY.csv found in ${args.dir}. Pass --weekly=<path> to specify one.`,
    );
  }

  const prevRows = await readRatingsRows(prevPath, "Previous");
  const weeklyRows = await readRatingsRows(weeklyPath, "Weekly");

  const merged = new Map();
  for (const r of prevRows) {
    merged.set(rowKey(r.external_id, r.media_type, r.tmdb_id), r);
  }
  const beforeCount = merged.size;
  for (const r of weeklyRows) {
    merged.set(rowKey(r.external_id, r.media_type, r.tmdb_id), r);
  }
  const afterCount = merged.size;
  const replacedOrAdded = weeklyRows.length;
  const netAddedKeys = afterCount - beforeCount;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const lines = ["external_id,media_type,tmdb_id,score"];
  for (const r of merged.values()) {
    lines.push(
      `${csvEscape(r.external_id)},${csvEscape(r.media_type)},${r.tmdb_id},${r.score}`,
    );
  }
  fs.writeFileSync(outPath, `${lines.join("\n")}\n`, "utf8");

  console.log(`Weekly file: ${path.relative(ROOT, weeklyPath)}`);
  console.log(`Previous file: ${path.relative(ROOT, prevPath)}`);
  console.log(`Output file: ${path.relative(ROOT, outPath)}`);
  console.log(`Previous unique keys: ${beforeCount.toLocaleString()}`);
  console.log(`Weekly rows processed: ${replacedOrAdded.toLocaleString()}`);
  console.log(`Output unique keys: ${afterCount.toLocaleString()}`);
  console.log(`Net new unique keys added: ${netAddedKeys.toLocaleString()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

