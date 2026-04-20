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

## Repo version & git

- **`package.json`:** **5.5.6** — **`CHANGELOG.md`** has sections **5.5.2** through **5.5.6**. Profile shows **Cinemastro v…** via **`APP_VERSION`** (from `package.json` in `src/App.jsx`).
- **`main` on origin** (recent tip): **`af9530b`** — circle detail **top bar** (back | crown | invite) + version bump; precedes **`31306ce`** (v5.5.3 Circle info names RPC), **`084cf35`** (detail backdrop `object-position: 30% top`, type pill left), **`4b64eaf`** (title detail sans on mobile, Circles hero cleanup, desktop wordmark).

## Recent work (client — `src/App.jsx`)

**Primary file:** `src/App.jsx` (inline `<style>{styles}</style>` for nav, detail, circles, etc.).

### Title detail

- **Backdrop:** `.detail-hero-backdrop img` uses **`object-position: 30% top`** so the float poster hides less of the focal area.
- **Type pill:** Movie / TV Show pill **`justify-content: flex-start`** in `.detail-hero-copy .d-type-genre` (left-aligned under hero).
- **Mobile title:** **`@media (max-width: 899px)`** — `.d-title` uses **DM Sans** (Serif hairlines break on Mobile Safari).

### Circles — `circle-detail`

- **Hero:** Full-bleed **`circle-hero--detail`**; **top bar** — **Back** (left), **circle name** centered (creator **★** before name); **one meta row** below — **members** (left), **Circle info** (center), **+ Invite more** (right when creator + active). **`src/circles.js`** unchanged for fetch helpers.
- **Circle info modal:** **`get_circle_member_names`** RPC + `profiles` fallback in **`useEffect`** when **`showCircleInfoSheet`** opens (`circleInfoNamesById`). Direct `profiles` IN-list only sees own row under RLS without RPC.

### Desktop wordmark

- **`@media (min-width: 900px)`** — slightly larger **`brand-logo--header`** and primary-nav logo height / max-width.

### Detail / nav glue (stable)

- **`"detail"`** in **`primaryNavScreens`**; **`clearDetailOverlayToNavigate()`** in **`navigatePrimarySection`** / **`onDiscover`**. **`AppPrimaryNav`**: **`onDetailBack={screen === "detail" ? goBack : undefined}`**.

## Recent work (Supabase / Circles)

- **Migration:** **`supabase/migrations/20260503120000_get_circle_member_names.sql`** — **`get_circle_member_names(p_circle_id uuid)`** → `user_id`, **`member_name`** (`profiles.name`), gated by **`is_circle_member(p_circle_id)`**, **SECURITY DEFINER**, **`authenticated`** execute. Apply on hosted DB if not already.

## Recent work (neighbor CF + cron) — unchanged thread

### Client (`src/App.jsx`)

- **`openDetail`:** `authedForCf = Boolean(sessionUser?.id ?? user?.id)` (session vs React lag).
- **`runComputeNeighborsNow`:** logs Edge `data.ok === false` and `stored === 0`.

### Edge `compute-neighbors`

- Stack overflow fix (no huge `push`), cosine clamp, atomic swap via **`commit_user_neighbors_swap`** (**`20260502120000_user_neighbors_staging_atomic_swap.sql`**).

### Config

- **`supabase/config.toml`:** **`[functions.compute-neighbors] verify_jwt = false`** for publishable + **`pg_net`**.

### Production cron

- Staggered **`compute-neighbors-w*`** jobs — scale **`offset`** / jobs as MAU grows (**`COMPUTE-NEIGHBORS-CRON.md`**).

## Product rules (stable)

- Blue pill / neighbor-backed CF: **`neighborCount ≥ 1`**.
- Gold Cinemastro: community avg from **`cinemastroAvgByKey`**.
- Do **not** blindly re-add past regressions (detail predictions into all strips, badge order, “always Edge” in **`recFromMatchPrediction`**, etc.).

## Open / follow-ups

- **Circles:** creator flow to **edit circle name** and **info** (**`circles.name`**, **`circles.description`**; vibe optional) from Circle info UI — see **`HANDOFF.md`** (“Circles — edit name & info”); align with **`circles`** UPDATE RLS and active-only rules.
- **Cron:** audit coverage vs eligible users; **`COMPUTE-NEIGHBORS-CRON.md`**.
- **Nav (optional):** **`126px`** header / scrim offsets if devices feel tight — tune together in **`App.jsx`**.
- **Lint:** possible **`react-hooks/set-state-in-effect`** on **`AppPrimaryNav`** — pre-existing.

---
*Replace or trim this file after the next milestone; keep “Last updated” and the assistant block current.*
