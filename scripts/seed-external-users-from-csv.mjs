import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createClient } from "@supabase/supabase-js";

/**
 * Create Supabase Auth users + profiles from a CSV:
 *   external_id,email,display_name
 *
 * Writes:
 *   user_mapping.csv — external_id,email,auth_user_id,status
 *   user_mapping_failed.csv — failures
 *
 * Env:
 *   SUPABASE_SERVICE_ROLE_KEY (required), SUPABASE_URL optional (or supabase/.temp/project-ref)
 *   SEED_DATA_DIR — default: SeedData/seed-data-final if New_users.csv / New_ratings
 *     live there, else SeedDataNew2023andAbovewith5000newTempSeedUsers
 *   USERS_CSV — default first existing: New_users.csv, users.csv
 *   MAPPING_CSV — default $SEED_DATA_DIR/user_mapping.csv
 *   FAILED_CSV — default $SEED_DATA_DIR/user_mapping_failed.csv
 *   SEED_USER_LIMIT — max new users to create this run (0 = all not already in mapping)
 */

const ROOT = process.cwd();

function resolveDefaultSeedDataDir() {
  const final = path.join(ROOT, "SeedData", "seed-data-final");
  const legacy = path.join(ROOT, "SeedDataNew2023andAbovewith5000newTempSeedUsers");
  const finalSignals =
    fs.existsSync(path.join(final, "New_users.csv")) ||
    fs.existsSync(path.join(final, "New_ratings.csv")) ||
    fs.existsSync(path.join(final, "ratings-deduped.csv"));
  if (finalSignals) return final;
  if (fs.existsSync(path.join(legacy, "users.csv"))) return legacy;
  return final;
}

function pickFirstExistingCsv(dir, basenames) {
  for (const b of basenames) {
    const p = path.join(dir, b);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const PROJECT_REF_PATH = path.join(ROOT, "supabase", ".temp", "project-ref");
const projectRef = fs.existsSync(PROJECT_REF_PATH)
  ? fs.readFileSync(PROJECT_REF_PATH, "utf8").trim()
  : "";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  (projectRef ? `https://${projectRef}.supabase.co` : "");
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SEED_DATA_DIR = process.env.SEED_DATA_DIR
  ? path.resolve(process.env.SEED_DATA_DIR)
  : resolveDefaultSeedDataDir();
const USERS_CSV =
  process.env.USERS_CSV ||
  pickFirstExistingCsv(SEED_DATA_DIR, ["New_users.csv", "users.csv"]) ||
  path.join(SEED_DATA_DIR, "New_users.csv");
const MAPPING_CSV =
  process.env.MAPPING_CSV || path.join(SEED_DATA_DIR, "user_mapping.csv");
const FAILED_CSV =
  process.env.FAILED_CSV || path.join(SEED_DATA_DIR, "user_mapping_failed.csv");
const LIMIT = Number(process.env.SEED_USER_LIMIT || "0");
const MAX_RETRIES = Number(process.env.SEED_RETRY_MAX || "5");
const RETRY_BASE_MS = Number(process.env.SEED_RETRY_BASE_MS || "750");

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error(
    "Missing env. Set SUPABASE_SERVICE_ROLE_KEY and optionally SUPABASE_URL.",
  );
  process.exit(1);
}
if (!fs.existsSync(USERS_CSV)) {
  console.error(`users.csv not found: ${USERS_CSV}`);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeErrorReason(errorOrValue) {
  if (!errorOrValue) return "Unknown error";
  if (typeof errorOrValue === "string") return errorOrValue;
  if (typeof errorOrValue.message === "string" && errorOrValue.message.trim()) {
    return errorOrValue.message;
  }
  try {
    const serialized = JSON.stringify(errorOrValue);
    return serialized && serialized !== "{}" ? serialized : "Unknown error";
  } catch {
    return String(errorOrValue);
  }
}

function isTransientReason(reason) {
  const s = String(reason || "").toLowerCase();
  return (
    s.includes("fetch failed") ||
    s.includes("bad gateway") ||
    s.includes("502") ||
    s.includes("internal server error") ||
    s.includes("unexpected token") ||
    s.includes("timeout") ||
    s.includes("network")
  );
}

function isDuplicateEmailError(reason) {
  const s = String(reason || "").toLowerCase();
  return (
    s.includes("already been registered") ||
    s.includes("already registered") ||
    s.includes("user already registered") ||
    s.includes("email address has already been registered")
  );
}

async function fetchAuthUserIdByEmail(email) {
  const base = `${SUPABASE_URL.replace(/\/$/, "")}/auth/v1/admin/users`;
  const urls = [
    `${base}?filter=${encodeURIComponent(email)}`,
    `${base}?email=${encodeURIComponent(email)}`,
  ];
  let lastErr = null;
  for (const url of urls) {
    const res = await fetch(url, {
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
    });
    const text = await res.text();
    if (!res.ok) {
      lastErr = new Error(`HTTP ${res.status}: ${text.slice(0, 240)}`);
      continue;
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      lastErr = e;
      continue;
    }
    const id = json.users?.[0]?.id;
    if (id) return id;
    lastErr = new Error("Empty users[] for email lookup");
  }
  throw lastErr || new Error("Could not resolve auth user id for email");
}

async function retryTransient(label, fn) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const reason = normalizeErrorReason(error);
      if (!isTransientReason(reason) || attempt === MAX_RETRIES) {
        throw error;
      }
      const delay = RETRY_BASE_MS * attempt;
      console.warn(
        `[retry] ${label} attempt ${attempt}/${MAX_RETRIES} failed (${reason}). Retrying in ${delay}ms...`,
      );
      await sleep(delay);
    }
  }
  throw lastError || new Error(`${label} failed`);
}

async function ensureProfileRow(authUserId, displayName) {
  const { error } = await supabase.from("profiles").upsert(
    { id: authUserId, name: displayName },
    { onConflict: "id" },
  );
  if (error) throw error;
}

async function createSeedUser({ externalId, email, displayName }) {
  const password = `SeedExt_${externalId}_DoNotLogin!`;

  let createResult = null;
  try {
    createResult = await retryTransient(`createUser:${externalId}`, async () => {
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          name: displayName,
          seed_user: true,
          external_id: externalId,
        },
      });
      if (error) {
        const reason = normalizeErrorReason(error);
        if (isTransientReason(reason)) throw new Error(reason);
        return { data: null, errorReason: reason };
      }
      return { data, errorReason: null };
    });
  } catch (error) {
    return {
      ok: false,
      email,
      externalId,
      reason: normalizeErrorReason(error),
    };
  }

  if (createResult.errorReason) {
    if (!isDuplicateEmailError(createResult.errorReason)) {
      return {
        ok: false,
        email,
        externalId,
        reason: createResult.errorReason,
      };
    }

    let authUserId = null;
    try {
      authUserId = await retryTransient(`resolveDuplicate:${externalId}`, () =>
        fetchAuthUserIdByEmail(email),
      );
    } catch (e) {
      return {
        ok: false,
        email,
        externalId,
        reason: `Duplicate email but lookup failed: ${normalizeErrorReason(e)}`,
      };
    }

    try {
      await retryTransient(`profileUpsert:${externalId}`, async () => {
        await ensureProfileRow(authUserId, displayName);
      });
    } catch (e) {
      return {
        ok: false,
        email,
        externalId,
        authUserId,
        reason: `Profile upsert failed: ${normalizeErrorReason(e)}`,
      };
    }

    return { ok: true, email, externalId, authUserId };
  }

  const authUserId = createResult.data?.user?.id;
  if (!authUserId) {
    return {
      ok: false,
      email,
      externalId,
      reason: "Missing user id from createUser",
    };
  }

  try {
    await retryTransient(`profileUpsert:${externalId}`, async () => {
      await ensureProfileRow(authUserId, displayName);
    });
  } catch (e) {
    return {
      ok: false,
      email,
      externalId,
      authUserId,
      reason: `Profile upsert failed: ${normalizeErrorReason(e)}`,
    };
  }

  return { ok: true, email, externalId, authUserId };
}

function loadExistingMapping() {
  const existingMap = new Map();
  if (!fs.existsSync(MAPPING_CSV)) return existingMap;
  const lines = fs.readFileSync(MAPPING_CSV, "utf8").split(/\r?\n/).filter(Boolean);
  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split(",");
    const externalId = (parts[0] || "").trim();
    const seedEmail = (parts[1] || "").trim();
    const authUserId = (parts[2] || "").trim();
    const status = (parts[3] || "").trim();
    if (externalId && authUserId && status === "created") {
      existingMap.set(externalId, { externalId, seedEmail, authUserId, status });
    }
  }
  return existingMap;
}

async function readUserRows() {
  const rows = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(USERS_CSV, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let lineNo = 0;
  let extIdx = 0;
  let emailIdx = 1;
  let nameIdx = 2;
  for await (const line of rl) {
    lineNo += 1;
    if (lineNo === 1) {
      const h = line.split(",").map((c) => c.trim());
      extIdx = h.indexOf("external_id");
      emailIdx = h.indexOf("email");
      nameIdx = h.indexOf("display_name");
      if (extIdx < 0 || emailIdx < 0 || nameIdx < 0) {
        throw new Error(
          "users.csv must include columns: external_id, email, display_name",
        );
      }
      continue;
    }
    const cols = line.split(",");
    const externalId = (cols[extIdx] || "").trim();
    const email = (cols[emailIdx] || "").trim();
    const displayName = (cols[nameIdx] || "").trim();
    if (!externalId || !email) continue;
    rows.push({ externalId, email, displayName: displayName || externalId });
  }
  return rows;
}

async function main() {
  console.log(`Using ${SUPABASE_URL}`);
  console.log(`Users CSV: ${USERS_CSV}`);

  const userRows = await readUserRows();
  console.log(`Rows in users.csv: ${userRows.length}`);

  const existingMap = loadExistingMapping();
  console.log(`Already mapped (created): ${existingMap.size}`);

  const created = [];
  const failed = [];
  let reused = 0;
  let createdThisRun = 0;

  for (const row of userRows) {
    if (existingMap.has(row.externalId)) {
      reused += 1;
      continue;
    }
    if (LIMIT > 0 && createdThisRun >= LIMIT) {
      console.log(`SEED_USER_LIMIT=${LIMIT} reached; stopping before ${row.externalId}`);
      break;
    }
    const result = await createSeedUser(row);
    if (result.ok) {
      created.push(result);
      existingMap.set(row.externalId, {
        externalId: row.externalId,
        seedEmail: row.email,
        authUserId: result.authUserId,
        status: "created",
      });
      createdThisRun += 1;
    } else {
      failed.push(result);
    }

    if ((created.length + failed.length) % 500 === 0 && created.length + failed.length > 0) {
      console.log(
        `Processed ${created.length + failed.length} new attempts (created: ${created.length}, failed: ${failed.length})`,
      );
    }
  }

  const mappingRows = [
    "external_id,email,auth_user_id,status",
    ...[...existingMap.values()].map((r) =>
      `${csvEscape(r.externalId)},${csvEscape(r.seedEmail)},${csvEscape(r.authUserId)},${csvEscape(r.status)}`,
    ),
  ];
  fs.mkdirSync(path.dirname(MAPPING_CSV), { recursive: true });
  fs.writeFileSync(MAPPING_CSV, mappingRows.join("\n") + "\n", "utf8");

  const failedRows = [
    "external_id,email,reason,auth_user_id",
    ...failed.map(
      (r) =>
        `${csvEscape(r.externalId)},${csvEscape(r.email)},${csvEscape(r.reason)},${csvEscape(r.authUserId || "")}`,
    ),
  ];
  fs.writeFileSync(FAILED_CSV, failedRows.join("\n") + "\n", "utf8");

  console.log("Done.");
  console.log(`Skipped (already in mapping): ${reused}`);
  console.log(`Created this run: ${created.length}`);
  console.log(`Failed this run: ${failed.length}`);
  console.log(`Mapping: ${MAPPING_CSV}`);
  console.log(`Failures: ${FAILED_CSV}`);
  console.log(
    "Next: npm run seed:external-ratings-transform  then  INPUT_FILE=.../ratings_for_ingest.csv npm run ml:ingest-ratings",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
