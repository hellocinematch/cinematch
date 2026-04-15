#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

/**
 * Unified flow for new seed ratings:
 * 1) Read input titles CSV (title + type)
 * 2) Resolve TMDB id + vote average + vote count
 * 3) Skip titles already present in a previous ratings CSV
 * 4) Generate synthetic ratings across random seed users (capped at 5k/title)
 * 5) Write output CSV ready for external-ratings transform + ingest
 *
 * Usage:
 *   node scripts/generate-seed-ratings-from-titles.mjs \
 *     --input=./SeedDataWeeklyAdd/NewTitlesRatingsToAdd.csv \
 *     --existing=./SeedDataWeeklyAdd/ratings-prev-loaded.csv \
 *     --out=./SeedDataWeeklyAdd/New_ratings_MMDDYYYY.csv
 *
 * Optional:
 *   --users=./SeedDataWeeklyAdd/users.csv
 *   --meta-out=./SeedDataWeeklyAdd/New_titles_resolved.csv
 *   --max-users-per-title=5000
 *   --batch=8
 *   --delay-ms=350
 *   --rng-seed=42
 *
 * Input title CSV accepted headers (case-insensitive):
 *   - title/name
 *   - type/media_type  (movie|tv, also accepts show/series)
 *   - tmdb_id (optional, skips search and goes to details)
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_WEEKLY_DIR = path.join(REPO_ROOT, "SeedDataWeeklyAdd");
const DEFAULT_INPUT_CSV = path.join(DEFAULT_WEEKLY_DIR, "NewTitlesRatingsToAdd.csv");
const DEFAULT_EXISTING_CSV = path.join(DEFAULT_WEEKLY_DIR, "ratings-prev-loaded.csv");
const DEFAULT_USERS_CSV = path.join(DEFAULT_WEEKLY_DIR, "users.csv");
const DEFAULT_META_OUT = path.join(DEFAULT_WEEKLY_DIR, "New_titles_resolved.csv");

const MIN_SCORE = 1;
const MAX_SCORE = 10;

function parseArgs(argv) {
  const out = {
    input: DEFAULT_INPUT_CSV,
    existing: DEFAULT_EXISTING_CSV,
    out: null,
    users: DEFAULT_USERS_CSV,
    metaOut: DEFAULT_META_OUT,
    batch: 8,
    delayMs: 350,
    maxUsersPerTitle: 5000,
    rngSeed: null,
  };

  for (const a of argv) {
    if (a.startsWith("--input=")) out.input = a.slice(8);
    else if (a.startsWith("--existing=")) out.existing = a.slice(11);
    else if (a.startsWith("--out=")) out.out = a.slice(6);
    else if (a.startsWith("--users=")) out.users = a.slice(8);
    else if (a.startsWith("--meta-out=")) out.metaOut = a.slice(11);
    else if (a.startsWith("--batch=")) out.batch = Math.max(1, Number(a.slice(8)) || 8);
    else if (a.startsWith("--delay-ms=")) out.delayMs = Math.max(0, Number(a.slice(11)) || 0);
    else if (a.startsWith("--max-users-per-title=")) {
      out.maxUsersPerTitle = Math.max(1, Number(a.slice(22)) || 5000);
    } else if (a.startsWith("--rng-seed=")) {
      const n = Number(a.slice(11));
      out.rngSeed = Number.isFinite(n) ? n : null;
    }
  }
  return out;
}

function tokenFromAppJs() {
  try {
    const s = fs.readFileSync(path.join(REPO_ROOT, "src", "App.jsx"), "utf8");
    const m = s.match(/const TMDB_TOKEN = "([^"]+)"/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
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

function normalizeMediaType(raw) {
  const t = String(raw || "").trim().toLowerCase();
  if (t === "movie" || t === "film") return "movie";
  if (t === "tv" || t === "show" || t === "series") return "tv";
  return null;
}

function normalizeTitle(raw) {
  return String(raw || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function mediaIdKey(mediaType, tmdbId) {
  return `${mediaType}-${Number(tmdbId)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mmddyyyy(d = new Date()) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${mm}${dd}${yyyy}`;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function createRng(seedOrNull) {
  if (seedOrNull == null) return Math.random;
  // Linear congruential generator for reproducible runs.
  let state = (Math.floor(seedOrNull) >>> 0) || 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function gaussian(rng, mean, stdDev) {
  // Box-Muller transform.
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + z * stdDev;
}

function deriveRatingsCount(voteCount, maxUsersPerTitle) {
  const raw = Number(voteCount);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return clamp(Math.round(raw), 1, maxUsersPerTitle);
}

function scoreFromTmdbVoteAverage(voteAverage, rng) {
  const mu = clamp(Number(voteAverage) || 7, MIN_SCORE, MAX_SCORE);
  const sigma = 1.25;
  const sampled = gaussian(rng, mu, sigma);
  return Math.round(clamp(sampled, MIN_SCORE, MAX_SCORE));
}

async function readTitleInput(inputPath) {
  const rows = [];
  const seen = new Set();
  const rl = readline.createInterface({
    input: fs.createReadStream(inputPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let header = null;
  let lineNo = 0;
  for await (const line of rl) {
    lineNo += 1;
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    if (!header) {
      header = cols.map((h) => h.toLowerCase().replace(/\s+/g, "_"));
      continue;
    }
    const titleIdx = header.findIndex((h) => h === "title" || h === "name");
    const typeIdx = header.findIndex((h) => h === "type" || h === "media_type");
    const tmdbIdx = header.findIndex((h) => h === "tmdb_id");
    if (titleIdx < 0 || typeIdx < 0) {
      throw new Error("Input CSV must include title (or name) and type (or media_type) columns.");
    }
    const title = (cols[titleIdx] || "").trim();
    const mediaType = normalizeMediaType(cols[typeIdx]);
    const tmdbIdRaw = tmdbIdx >= 0 ? Number(cols[tmdbIdx]) : null;
    const tmdbId = Number.isFinite(tmdbIdRaw) ? tmdbIdRaw : null;
    if (!title || !mediaType) continue;

    const key = tmdbId != null
      ? mediaIdKey(mediaType, tmdbId)
      : `${mediaType}|${normalizeTitle(title)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({ title, media_type: mediaType, tmdb_id: tmdbId });
  }
  return rows;
}

async function readExistingRatings(existingPath) {
  if (!existingPath || !fs.existsSync(existingPath)) {
    return { existingMediaIds: new Set(), existingTitleKeys: new Set() };
  }

  const existingMediaIds = new Set();
  const existingTitleKeys = new Set();
  const rl = readline.createInterface({
    input: fs.createReadStream(existingPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let header = null;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    if (!header) {
      header = cols.map((h) => h.toLowerCase().replace(/\s+/g, "_"));
      continue;
    }
    const tmdbIdx = header.indexOf("tmdb_id");
    const typeIdx = header.findIndex((h) => h === "media_type" || h === "type");
    const titleIdx = header.findIndex((h) => h === "title" || h === "name");
    const mediaType = typeIdx >= 0 ? normalizeMediaType(cols[typeIdx]) : null;
    const tmdbId = tmdbIdx >= 0 ? Number(cols[tmdbIdx]) : NaN;
    if (mediaType && Number.isFinite(tmdbId)) {
      existingMediaIds.add(mediaIdKey(mediaType, tmdbId));
    }
    if (mediaType && titleIdx >= 0) {
      const t = normalizeTitle(cols[titleIdx]);
      if (t) existingTitleKeys.add(`${mediaType}|${t}`);
    }
  }
  return { existingMediaIds, existingTitleKeys };
}

async function readUserPool(usersPath) {
  if (!fs.existsSync(usersPath)) {
    throw new Error(`Users CSV not found: ${usersPath}`);
  }
  const out = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(usersPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let header = null;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    if (!header) {
      header = cols.map((h) => h.toLowerCase().replace(/\s+/g, "_"));
      continue;
    }
    const extIdx = header.indexOf("external_id");
    if (extIdx < 0) throw new Error("Users CSV must include external_id column.");
    const ext = (cols[extIdx] || "").trim();
    if (ext) out.push(ext);
  }
  return out;
}

async function tmdbRequest(token, url) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TMDB ${res.status}: ${text.slice(0, 180)}`);
  }
  return res.json();
}

async function resolveTmdbRow(token, row) {
  const kind = row.media_type === "tv" ? "tv" : "movie";
  let tmdbId = row.tmdb_id;

  if (!tmdbId) {
    const q = encodeURIComponent(row.title);
    const searchUrl = `https://api.themoviedb.org/3/search/${kind}?query=${q}&include_adult=false&language=en-US&page=1`;
    const search = await tmdbRequest(token, searchUrl);
    const first = Array.isArray(search.results) ? search.results[0] : null;
    if (!first?.id) {
      return { ...row, error: "No TMDB search result", resolved: false };
    }
    tmdbId = Number(first.id);
  }

  const detailUrl = `https://api.themoviedb.org/3/${kind}/${tmdbId}?language=en-US`;
  const detail = await tmdbRequest(token, detailUrl);
  return {
    ...row,
    tmdb_id: Number(tmdbId),
    resolved_title: detail.title || detail.name || row.title,
    vote_average: Number(detail.vote_average ?? 0),
    vote_count: Number(detail.vote_count ?? 0),
    popularity: Number(detail.popularity ?? 0),
    resolved: true,
    error: "",
  };
}

function pickUniqueUsers(userPool, count, rng) {
  if (count >= userPool.length) return [...userPool];
  const picked = new Set();
  while (picked.size < count) {
    const idx = Math.floor(rng() * userPool.length);
    picked.add(userPool[idx]);
  }
  return [...picked];
}

async function main() {
  const defaultOut = path.join(DEFAULT_WEEKLY_DIR, `New_ratings_${mmddyyyy()}.csv`);
  const args = parseArgs(process.argv.slice(2));
  const tmdbToken =
    process.env.TMDB_BEARER_TOKEN || process.env.TMDB_READ_ACCESS_TOKEN || tokenFromAppJs();
  if (!tmdbToken) {
    console.error("Set TMDB_BEARER_TOKEN or TMDB_READ_ACCESS_TOKEN, or keep TMDB token in src/App.jsx");
    process.exit(1);
  }

  const inputPath = path.resolve(args.input);
  const existingPath = path.resolve(args.existing);
  const outPath = path.resolve(args.out || defaultOut);
  const usersPath = path.resolve(args.users);
  const metaPath = path.resolve(args.metaOut);

  if (!fs.existsSync(inputPath)) {
    throw new Error(
      `Input not found: ${inputPath}. Expected default file at SeedDataWeeklyAdd/NewTitlesRatingsToAdd.csv or pass --input=...`,
    );
  }
  if (!fs.existsSync(existingPath)) {
    throw new Error(
      `Existing ratings file not found: ${existingPath}. Expected default file at SeedDataWeeklyAdd/ratings-prev-loaded.csv or pass --existing=...`,
    );
  }

  const userPoolRaw = await readUserPool(usersPath);
  const userPool = userPoolRaw.slice(0, Math.min(args.maxUsersPerTitle, userPoolRaw.length));
  if (userPool.length === 0) throw new Error("No users found in users CSV.");
  const rng = createRng(args.rngSeed);

  const inputRows = await readTitleInput(inputPath);
  const { existingMediaIds, existingTitleKeys } = await readExistingRatings(existingPath);

  console.log(`Input titles: ${inputRows.length}`);
  console.log(`Existing media keys: ${existingMediaIds.size}`);
  console.log(`User pool: ${userPool.length}`);

  const resolved = [];
  const batch = args.batch;
  for (let i = 0; i < inputRows.length; i += batch) {
    const chunk = inputRows.slice(i, i + batch);
    const settled = await Promise.allSettled(chunk.map((row) => resolveTmdbRow(tmdbToken, row)));
    for (const s of settled) {
      if (s.status === "fulfilled") resolved.push(s.value);
      else resolved.push({ resolved: false, error: String(s.reason?.message || s.reason) });
    }
    if (i + batch < inputRows.length && args.delayMs > 0) await sleep(args.delayMs);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.mkdirSync(path.dirname(metaPath), { recursive: true });

  const out = fs.createWriteStream(outPath, { encoding: "utf8" });
  out.write("external_id,media_type,tmdb_id,score\n");

  const meta = fs.createWriteStream(metaPath, { encoding: "utf8" });
  meta.write("input_title,media_type,tmdb_id,resolved_title,vote_average,vote_count,target_user_count,status,error\n");

  let titlesGenerated = 0;
  let titlesSkippedExisting = 0;
  let titlesUnresolved = 0;
  let ratingsWritten = 0;

  for (const row of resolved) {
    if (!row?.resolved) {
      titlesUnresolved += 1;
      meta.write([
        csvEscape(row?.title || ""),
        csvEscape(row?.media_type || ""),
        "",
        "",
        "",
        "",
        "",
        "unresolved",
        csvEscape(row?.error || "Unknown"),
      ].join(",") + "\n");
      continue;
    }

    const keyById = mediaIdKey(row.media_type, row.tmdb_id);
    const keyByTitle = `${row.media_type}|${normalizeTitle(row.resolved_title || row.title)}`;
    const alreadyExists = existingMediaIds.has(keyById) || existingTitleKeys.has(keyByTitle);
    if (alreadyExists) {
      titlesSkippedExisting += 1;
      meta.write([
        csvEscape(row.title),
        csvEscape(row.media_type),
        row.tmdb_id,
        csvEscape(row.resolved_title),
        Number(row.vote_average || 0).toFixed(2),
        Number(row.vote_count || 0),
        "",
        "skipped_existing",
        "",
      ].join(",") + "\n");
      continue;
    }

    const targetCount = Math.min(
      deriveRatingsCount(row.vote_count, args.maxUsersPerTitle),
      userPool.length,
    );
    const selectedUsers = pickUniqueUsers(userPool, targetCount, rng);
    const mu = clamp(Number(row.vote_average) || 7, MIN_SCORE, MAX_SCORE);
    for (const externalId of selectedUsers) {
      const score = scoreFromTmdbVoteAverage(mu, rng);
      out.write(`${csvEscape(externalId)},${csvEscape(row.media_type)},${row.tmdb_id},${score}\n`);
      ratingsWritten += 1;
    }
    titlesGenerated += 1;
    existingMediaIds.add(keyById);
    existingTitleKeys.add(keyByTitle);

    meta.write([
      csvEscape(row.title),
      csvEscape(row.media_type),
      row.tmdb_id,
      csvEscape(row.resolved_title),
      Number(row.vote_average || 0).toFixed(2),
      Number(row.vote_count || 0),
      targetCount,
      "generated",
      "",
    ].join(",") + "\n");
  }

  out.end();
  meta.end();
  await Promise.all([
    new Promise((resolve, reject) => {
      out.on("finish", resolve);
      out.on("error", reject);
    }),
    new Promise((resolve, reject) => {
      meta.on("finish", resolve);
      meta.on("error", reject);
    }),
  ]);

  console.log("Done.");
  console.log(`Generated titles: ${titlesGenerated}`);
  console.log(`Skipped existing titles: ${titlesSkippedExisting}`);
  console.log(`Unresolved titles: ${titlesUnresolved}`);
  console.log(`Ratings rows written: ${ratingsWritten.toLocaleString()}`);
  console.log(`Output ratings: ${outPath}`);
  console.log(`Output metadata: ${metaPath}`);
  console.log(`Next step: RATINGS_CSV=${outPath} npm run seed:external-ratings-transform`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
