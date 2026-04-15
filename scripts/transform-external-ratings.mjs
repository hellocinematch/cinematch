import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

/**
 * Join ratings CSVs or TSVs (external_id, media_type, tmdb_id, score) with user_mapping.csv
 * → ratings_for_ingest.csv (user_id, media_type, tmdb_id, score) for ml:ingest-ratings.
 *
 * Default inputs (when RATINGS_CSV / RATINGS_CSV_LIST unset): New_ratings.csv then
 * ratings-deduped.csv (also accepts new_ratings.csv / ratings_deduped.csv) under
 * SEED_DATA_DIR — deduped rows come second so they win on the same upsert key at ingest.
 * media_type is normalized to lowercase (e.g. Movie → movie).
 *
 * Env:
 *   SEED_DATA_DIR — default: SeedDataWeeklyAdd if present, else seed-data-final, else SeedDataNew2023…
 *   RATINGS_CSV — single file (overrides default pair). Tab- or comma-separated (auto from header row).
 *   RATINGS_CSV_LIST — comma-separated paths (overrides default pair)
 *   MAPPING_CSV — default $SEED_DATA_DIR/user_mapping.csv
 *   OUTPUT_CSV — default $SEED_DATA_DIR/ratings_for_ingest.csv
 */

const ROOT = process.cwd();

function resolveDefaultSeedDataDir() {
  const weekly = path.join(ROOT, "SeedDataWeeklyAdd");
  const final = path.join(ROOT, "SeedData", "seed-data-final");
  const legacy = path.join(ROOT, "SeedDataNew2023andAbovewith5000newTempSeedUsers");
  const weeklySignals =
    fs.existsSync(path.join(weekly, "NewTitlesRatingsToAdd.csv")) ||
    fs.existsSync(path.join(weekly, "ratings-prev-loaded.csv")) ||
    fs.existsSync(path.join(weekly, "users.csv"));
  if (weeklySignals) return weekly;
  const finalSignals =
    fs.existsSync(path.join(final, "New_ratings.csv")) ||
    fs.existsSync(path.join(final, "ratings-deduped.csv")) ||
    fs.existsSync(path.join(final, "ratings_deduped.csv"));
  if (finalSignals) return final;
  if (fs.existsSync(path.join(legacy, "ratings.csv"))) return legacy;
  return final;
}

function pickFirstExisting(dir, basenames) {
  for (const b of basenames) {
    if (!b) continue;
    const p = path.join(dir, b);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function pickLatestDatedNewRatings(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((f) => /^New_ratings_\d{8}\.csv$/i.test(f))
    .sort();
  if (files.length === 0) return null;
  return path.join(dir, files[files.length - 1]);
}

function resolveRatingInputFiles(seedDataDir) {
  if (process.env.RATINGS_CSV) {
    const p = path.resolve(process.env.RATINGS_CSV);
    if (!fs.existsSync(p)) throw new Error(`RATINGS_CSV not found: ${p}`);
    return [p];
  }
  if (process.env.RATINGS_CSV_LIST) {
    const files = process.env.RATINGS_CSV_LIST.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    const out = [];
    for (const f of files) {
      const p = path.resolve(f);
      if (!fs.existsSync(p)) throw new Error(`RATINGS_CSV_LIST entry not found: ${p}`);
      out.push(p);
    }
    if (out.length === 0) throw new Error("RATINGS_CSV_LIST is empty");
    return out;
  }

  const latestDated = pickLatestDatedNewRatings(seedDataDir);
  const newRatings = latestDated || pickFirstExisting(seedDataDir, [
    "New_ratings.csv",
    "new_ratings.csv",
  ]);
  const deduped = pickFirstExisting(seedDataDir, [
    "ratings-deduped.csv",
    "ratings_deduped.csv",
  ]);

  if (newRatings && deduped) return [newRatings, deduped];
  if (newRatings && !deduped) {
    console.warn(
      `Only New_ratings found under ${seedDataDir}; missing ratings-deduped.csv (or ratings_deduped.csv).`,
    );
    return [newRatings];
  }
  if (!newRatings && deduped) {
    console.warn(
      `Only ratings-deduped found under ${seedDataDir}; missing New_ratings.csv (or new_ratings.csv).`,
    );
    return [deduped];
  }

  const single = pickFirstExisting(seedDataDir, ["ratings.csv"]);
  if (single) {
    console.warn(
      `Using single ${path.basename(single)}; add New_ratings.csv + ratings-deduped.csv for the two-file flow.`,
    );
    return [single];
  }

  throw new Error(
    `No ratings CSV under ${seedDataDir}. Expected New_ratings.csv + ratings-deduped.csv, or ratings.csv, or set RATINGS_CSV / RATINGS_CSV_LIST.`,
  );
}

const SEED_DATA_DIR = process.env.SEED_DATA_DIR
  ? path.resolve(process.env.SEED_DATA_DIR)
  : resolveDefaultSeedDataDir();
const MAPPING_CSV =
  process.env.MAPPING_CSV || path.join(SEED_DATA_DIR, "user_mapping.csv");
const OUTPUT_CSV =
  process.env.OUTPUT_CSV || path.join(SEED_DATA_DIR, "ratings_for_ingest.csv");

function loadMapping() {
  if (!fs.existsSync(MAPPING_CSV)) {
    throw new Error(`Mapping not found: ${MAPPING_CSV} (run seed:external-users first)`);
  }
  const map = new Map();
  const lines = fs.readFileSync(MAPPING_CSV, "utf8").split(/\r?\n/).filter(Boolean);
  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split(",");
    const externalId = (parts[0] || "").trim();
    const authUserId = (parts[2] || "").trim();
    const status = (parts[3] || "").trim();
    if (externalId && authUserId && status === "created") {
      map.set(externalId, authUserId);
    }
  }
  return map;
}

/**
 * @param {string} ratingsPath
 * @param {Map<string,string>} idMap
 * @param {import('node:fs').WriteStream} out
 * @param {{ written: number, skippedNoUser: number }} stats
 */
function detectDelimiter(headerLine) {
  const t = headerLine.includes("\t");
  const c = headerLine.includes(",");
  if (t && !c) return "\t";
  if (c && !t) return ",";
  if (t && c) {
    const tabCols = headerLine.split("\t").length;
    const commaCols = headerLine.split(",").length;
    return tabCols >= commaCols ? "\t" : ",";
  }
  return ",";
}

async function streamRatingsFile(ratingsPath, idMap, out, stats) {
  const rl = readline.createInterface({
    input: fs.createReadStream(ratingsPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let lineNo = 0;
  let delim = ",";
  let extIdx = 0;
  let mediaIdx = 1;
  let tmdbIdx = 2;
  let scoreIdx = 3;

  for await (const line of rl) {
    lineNo += 1;
    if (lineNo === 1) {
      delim = detectDelimiter(line);
      const h = line.split(delim).map((c) => c.trim());
      extIdx = h.indexOf("external_id");
      mediaIdx = h.indexOf("media_type");
      tmdbIdx = h.indexOf("tmdb_id");
      scoreIdx = h.indexOf("score");
      if (extIdx < 0 || mediaIdx < 0 || tmdbIdx < 0 || scoreIdx < 0) {
        throw new Error(
          `${path.basename(ratingsPath)} must include: external_id, media_type, tmdb_id, score`,
        );
      }
      continue;
    }
    const cols = line.split(delim);
    const externalId = (cols[extIdx] || "").trim();
    const mediaTypeRaw = (cols[mediaIdx] || "").trim();
    const mediaType = mediaTypeRaw.toLowerCase();
    const tmdbId = (cols[tmdbIdx] || "").trim();
    const score = (cols[scoreIdx] || "").trim();
    const userId = idMap.get(externalId);
    if (!userId) {
      stats.skippedNoUser += 1;
      continue;
    }
    out.write(`${userId},${mediaType},${tmdbId},${score}\n`);
    stats.written += 1;
    if (stats.written % 200_000 === 0) {
      console.log(`… ${stats.written.toLocaleString()} rows written`);
    }
  }
}

async function main() {
  const idMap = loadMapping();
  console.log(`Mapped external_ids: ${idMap.size}`);
  console.log(`SEED_DATA_DIR: ${SEED_DATA_DIR}`);

  const inputFiles = resolveRatingInputFiles(SEED_DATA_DIR);
  console.log(`Input file(s): ${inputFiles.map((p) => path.relative(ROOT, p)).join(", ")}`);

  const out = fs.createWriteStream(OUTPUT_CSV, { encoding: "utf8" });
  out.write("user_id,media_type,tmdb_id,score\n");

  const stats = { written: 0, skippedNoUser: 0 };
  for (const fp of inputFiles) {
    console.log(`--- ${path.basename(fp)}`);
    await streamRatingsFile(fp, idMap, out, stats);
  }

  out.end();
  await new Promise((resolve, reject) => {
    out.on("finish", resolve);
    out.on("error", reject);
  });

  console.log(`Wrote ${stats.written.toLocaleString()} rows → ${OUTPUT_CSV}`);
  if (stats.skippedNoUser > 0) {
    console.warn(
      `Skipped ${stats.skippedNoUser.toLocaleString()} rows (external_id not in mapping or not status=created)`,
    );
  }
  console.log(`Ingest: INPUT_FILE=${OUTPUT_CSV} npm run ml:ingest-ratings`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
