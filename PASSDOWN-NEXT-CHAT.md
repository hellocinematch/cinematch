# Passdown for next chat (Cinematch)

**Last updated:** 2026-04-19

## For the assistant (every Cinematch session)

1. **Read this file early** when working in this repo — it’s the live handoff for CF, neighbors, cron, UI chrome, and recent commits.
2. **Recurring ops reminder:** as MAU grows, **`cron` chunk coverage must grow**. Staggered `compute-neighbors` jobs use `offset` steps; ensure **`(# of jobs) × (limit per job)`** covers all eligible (non-seed) users. Details: **`COMPUTE-NEIGHBORS-CRON.md`**. Audit:  
   `select jobname, schedule from cron.job where jobname like 'compute-neighbors-w%';`
3. **When the user asks to “update passdown”** or after a milestone (neighbors, cron, match, circles, nav): **edit this file** so the next session stays accurate.

**Cursor rules:** `.cursor/rules/cinematch-handoff.mdc` + `.cursor/rules/compute-neighbors-cron.mdc` are **`alwaysApply: true`** so reminders surface in chats without relying on memory.

---

## Keep in mind every session

- **`COMPUTE-NEIGHBORS-CRON.md`** — full ops runbook: Vault, `apikey` + `x-compute-neighbors-secret`, `pg_net` timeouts, staggered schedules, scaling formula.
- **Neighbor cron:** expand **`offset`** / add **`cron.schedule`** rows when user count exceeds current weekly coverage; do **not** assume the first batch of `w00…w09` is enough forever.

## Repo version & git (client milestone)

- **`package.json`:** **5.5.2** — detail + nav polish; **`CHANGELOG.md`** has a **5.5.2** section. Profile shows **Cinemastro v…** via **`APP_VERSION`** (sourced from `package.json` in `src/App.jsx`).
- **`main` on origin** includes through **`f93ad60`** (pushed 2026-04-19): detail commit **`0798345`**, nav commit **`3a07d72`**, version/changelog **`f93ad60`**.

## Recent work (client — primary nav & title detail)

**Primary file:** `src/App.jsx` (large inline `<style>{styles}</style>` for `.app-primary-nav*`, detail hero, scores, facts bar, rating block).

| Commit    | Contents |
|-----------|----------|
| `f93ad60` | **v5.5.2:** bump `package.json`, **`CHANGELOG.md`** entry for detail + nav recap. |
| `0798345` | **Title detail (TMDB-style):** Centered hero title (smaller title + smaller year in parens); poster vertically centered on backdrop (right, TMDB-like); compact **two-column scores** with divider; stacked range/confidence beside “For you”; Cinemastro column with TMDB-based line + vote meter; **facts bar** (certification, US release date, runtime, genres) from enriched TMDB fetch (`append_to_response` release dates / TV content ratings); tagline under facts, then overview; **Where to watch** in a subtle panel. **Rating UX:** slider default **5**, bubble tracks value; **`detailTouched`** / submit flow so default 5 is submittable when unrated; centered **“Select your rating and submit”** (`.d-rate-label--sentence`). |
| `3a07d72` | **Nav:** Mobile **title detail** — back on first row, **no hamburger** on that screen; **Discover** — drop redundant top row; **bottom bar** — **public stats** between Mood and **Profile (👤)**; Profile opens **Profile / Sign out** consistently. |
| `d7df773` | **Mobile primary nav layout:** grid **hamburger \| brand \| Discover**; detail **second row** circular back; classes **`app-primary-nav--with-detail-back`**, **`app--primary-nav-detail-back`**; scrim/drawer `top` / `max-height` **`calc(126px + env(safe-area-inset-top))`** on detail mobile. Desktop **≥900px:** single row, back via flex **`order`**. |
| `5639fc1` | **v5.5.1 Your Picks:** catalogue **`predict_cached`**, match body guards (see commit message). |

**Detail / navigation glue (still relevant):** `"detail"` in **`primaryNavScreens`**; **`clearDetailOverlayToNavigate()`** at start of **`navigatePrimarySection`** and in **`onDiscover`** so URL/selection clear without **`history.back()`**. **`AppPrimaryNav`** receives **`onDetailBack={screen === "detail" ? goBack : undefined}`**.

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
- **Nav (optional):** If **`126px`** header offset feels tight on some devices, tune **`padding-top`** / scrim **`top`** together in `App.jsx` styles (keep them in sync).
- **Lint:** `npm run lint` may still report **`react-hooks/set-state-in-effect`** on **`AppPrimaryNav`** (`setMobileOpen` inside `useEffect` when `onDetailBack`) — pre-existing; fix by deriving closed state from props or closing in the navigation handler instead of syncing in an effect.

---
*Replace or trim this file after the next milestone; keep “Last updated” and the assistant block current.*
