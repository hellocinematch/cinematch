# Passdown for next chat (Cinematch)

**Last updated:** 2026-04-18

## For the assistant (every Cinematch session)

1. **Read this file early** when working in this repo — it’s the live handoff for CF, neighbors, cron, and recent commits.
2. **Recurring ops reminder:** as MAU grows, **`cron` chunk coverage must grow**. Staggered `compute-neighbors` jobs use `offset` steps; ensure **`(# of jobs) × (limit per job)`** covers all eligible (non-seed) users. Details: **`COMPUTE-NEIGHBORS-CRON.md`**. Audit:  
   `select jobname, schedule from cron.job where jobname like 'compute-neighbors-w%';`
3. **When the user asks to “update passdown”** or after a milestone (neighbors, cron, match, circles): **edit this file** so the next session stays accurate.

**Cursor rules:** `.cursor/rules/cinematch-handoff.mdc` + `.cursor/rules/compute-neighbors-cron.mdc` are **`alwaysApply: true`** so reminders surface in chats without relying on memory.

---

## Keep in mind every session

- **`COMPUTE-NEIGHBORS-CRON.md`** — full ops runbook: Vault, `apikey` + `x-compute-neighbors-secret`, `pg_net` timeouts, staggered schedules, scaling formula.
- **Neighbor cron:** expand **`offset`** / add **`cron.schedule`** rows when user count exceeds current weekly coverage; do **not** assume the first batch of `w00…w09` is enough forever.

## Recent work (neighbor CF + cron)

### Client (`src/App.jsx`)

- **`openDetail`**: `authedForCf = Boolean(sessionUser?.id ?? user?.id)` so `predict_cached` is not skipped when `getSession()` lags React `user` (commit **`c27f940`**).
- **`runComputeNeighborsNow`**: logs when Edge returns `data.ok === false` and when `stored === 0` for the user (HTTP 200 with failed body was previously silent) (commit **`84278a2`**).

### Edge `compute-neighbors` (`supabase/functions/compute-neighbors/index.ts`)

- **Stack overflow:** replaced `push(...hugeArray)` with loops when merging overlap rows.
- **DB check:** cosine clamped to `[0,1]`, non-finite → `0` (fixes `user_neighbors_similarity_check`).
- **Atomic swap:** staging table + RPC **`commit_user_neighbors_swap`** (migration **`20260502120000_user_neighbors_staging_atomic_swap.sql`**) so a failed run does not strand users with empty `user_neighbors` (commit **`dd07f10`**).

### Edge config

- **`supabase/config.toml`**: `[functions.compute-neighbors] verify_jwt = false` — needed for **publishable** keys (`sb_publishable_…`) with `pg_net`; **`Authorization: Bearer <publishable>`** is invalid JWT at the gateway. Keep **Dashboard** JWT setting aligned (commit **`51c0a0a`**).

### Production cron (Supabase project)

- Extensions: **`pg_cron`**, **`pg_net`** (schema **`extensions`**).
- Vault: **`project_url`**, **`supabase_anon_key`** (value = **publishable** key), **`compute_neighbors_cron_secret`** (= Edge **`COMPUTE_NEIGHBORS_CRON_SECRET`**).
- **`net.http_post`:** **`apikey`** + **`x-compute-neighbors-secret`**; optional **`timeout_milliseconds`** (e.g. `90000`); small **`limit`** (e.g. `5`) per chunk.
- **Staggered jobs:** e.g. `compute-neighbors-w00`, `w01`, … — Sunday UTC, spaced minutes, **`offset`** `0,5,10,…` — **add jobs as MAU grows.**

### Docs / commits (neighbor thread)

| Commit    | Contents |
|-----------|----------|
| `c27f940` | `openDetail` auth timing |
| `84278a2` | compute-neighbors stack/clamp + App invoke logging |
| `dd07f10` | atomic staging migration + Edge swap |
| `51c0a0a` | `COMPUTE-NEIGHBORS-CRON.md`, `.cursor/rules/compute-neighbors-cron.mdc`, `supabase/config.toml` |

## Product rules (stable)

- Blue pill / neighbor-backed CF: **`neighborCount ≥ 1`**.
- Gold Cinemastro: community avg from **`cinemastroAvgByKey`**.
- Do **not** blindly re-add: merging detail predictions into `matchData` for all strips, reordering strip badge before Cinemastro, “always keep Edge score” in `recFromMatchPrediction` (past regressions).

## Open / follow-ups

- **Cron:** audit coverage vs eligible user count after growth; see **`COMPUTE-NEIGHBORS-CRON.md`**.
- **Git:** push **`main`** if still ahead of **`origin/main`**.

---
*Replace or trim this file after the next milestone; keep “Last updated” and the assistant block current.*
