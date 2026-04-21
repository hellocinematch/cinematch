# Passdown for next chat (Cinematch)

**Last updated:** 2026-04-20

---

## How the user wants to work (read first)

**Unless they clearly ask for code in the same message**, treat messages as **discussion only**: ideas, options, tradeoffs, example SQL in chat — **no `apply_patch`, no file edits, no “I implemented it”.**

**Write / change code only when:**

- The user says **`code now`**, **or**
- They answer **yes** after you ask something like **“Should I implement this now?”**

**When you do ship code:** bump **`package.json`** version and add a **`CHANGELOG.md`** entry in the **same change** (repo convention).

**Exception:** If they say **implement**, **fix**, **migrate**, or **do it** in **that** message for a specific task, that counts as permission for **that** task.

**Cursor rule (workspace):** `.cursor/rules/cinematch-discussion-first.mdc` — **`alwaysApply: true`**.

Partner rules: `.cursor/rules/cinematch-handoff.mdc`, `.cursor/rules/compute-neighbors-cron.mdc`.

**HANDOFF.md** — broader roadmap (Circles phases, paths); version-bump note there too.

---

## For the assistant (every Cinematch session)

1. **Read this file early** when working in this repo — live handoff for CF, neighbors, cron, UI chrome, **workflow (above)**, and recent behavior.
2. **Recurring ops reminder:** as MAU grows, **`cron` chunk coverage must grow**. Staggered `compute-neighbors` jobs use `offset` steps; ensure **`(# of jobs) × (limit per job)`** covers all eligible (non-seed) users. Details: **`COMPUTE-NEIGHBORS-CRON.md`**. Audit:  
   `select jobname, schedule from cron.job where jobname like 'compute-neighbors-w%';`
3. **When the user asks to “update passdown”** or after a milestone (neighbors, cron, match, circles, nav): **edit this file** so the next session stays accurate.

---

## Keep in mind every session

- **`COMPUTE-NEIGHBORS-CRON.md`** — full ops runbook: Vault, `apikey` + `x-compute-neighbors-secret`, `pg_net` timeouts, staggered schedules, scaling formula.
- **Neighbor cron:** expand **`offset`** / add **`cron.schedule`** rows when user count exceeds current weekly coverage; do **not** assume the first batch of `w00…w09` is enough forever.

## Repo version & git

- **`package.json`:** **5.5.15** — **`CHANGELOG.md`** through **5.5.15**. Profile shows **Cinemastro v…** via **`APP_VERSION`** (from `package.json` in `src/App.jsx`).
- Confirm **`main` tip** with `git log -3 --oneline` after local commits. Recent **`main`** includes **v5.5.8–v5.5.15**: circle **Ratings** tabs — **Recent** (horizontal strip), **All** / **Top** (3-col grids, **More** pagination; Top cap **25**); migration **`20260522120000_circles_rated_all_top_grid.sql`** + redeploy **`get-circle-rated-titles`**. Older: **`20260506120000_circles_strip_recent_activity.sql`**, **`20260505120000_...`**, optional **`20260504120000_...`**.

## Recent work (client — `src/App.jsx`)

**Primary file:** `src/App.jsx` (inline `<style>{styles}</style>` for nav, detail, circles, etc.).

### Title detail

- **Backdrop:** `.detail-hero-backdrop img` uses **`object-position: 30% top`** so the float poster hides less of the focal area.
- **Type pill:** Movie / TV Show pill **`justify-content: flex-start`** in `.detail-hero-copy .d-type-genre` (left-aligned under hero).
- **Mobile title:** **`@media (max-width: 899px)`** — `.d-title` uses **DM Sans** (Serif hairlines break on Mobile Safari).

### Circles — list & invites bell

- **`pendingInvitesCount > 0`:** bell uses **gold active** styling; **numeric badge** only when **> 0** (display cap **`99+`**). No **`0`** next to the bell.

### Circles — `circle-detail` hero

- **Layout:** Full-bleed **`circle-hero--detail`**. **Top bar** **`circle-hero__top-bar--detail-chat`:** frosted strip (**`backdrop-filter`**). **Back** · **centered cluster:** **avatar** (two-letter initials via **`circleAvatarInitials`** in **`src/circles.js`**) + **name** (one-line ellipsis, centered; narrow: **DM Sans**) + **subtitle** (people icon + count, centered) · circular **(i)** → **Circle info**.
- **Invite:** **+ Invite more** lives in the **Circle info** modal (creator, active); **`openInviteSheet`** closes the info sheet first.
- **Circle info modal:** **`get_circle_member_names`** RPC + `profiles` fallback when **`showCircleInfoSheet`** opens (`circleInfoNamesById`).

### Circles — strip + “Rate a title”

- **Ratings block:** Header **Ratings** with tabs **Recent** | **All** | **Top**. **Recent:** horizontal strip (skeleton + loaded). **All / Top:** 3-column grid (2 cols if viewport **≤360px**), Discover-style cards, **More** loads **10** more; **Top** max **25** titles. **Empty** copy unchanged for all tabs. **&lt;2 members** placeholder still **Rated in this circle** (gate copy).
- **Cards:** **Recent** strip sorted by **most recent circle rating** (`last_at`). **Circle** avg for **every** title; **N rated** if circle **&gt;2 members**. **Solo** rows: **Cinemastro** under meta. Grids reuse the same score lines.
- **Rate a title:** Centered pill below the body (**`circle-rate-title-pill`**, active circles only). **`openDiscoverFromCircleForRating`** sets **`rateTitleReturnCircleIdRef`**; from **Discover**, **`openDetail`** forces **`detailReturnScreenRef`** → **`circle-detail`** so **Submit rating** / back returns to the same circle. **`useEffect` on `screen`** clears the ref when not on **discover** / **detail**. Cap-hint **Open Discover** uses the same handler.
- **Create circle names:** **`validateCircleName`** in **`src/circles.js`** — 2–32 chars, letter-led charset (see Supabase migrations below).

### Desktop wordmark

- **`@media (min-width: 900px)`** — slightly larger **`brand-logo--header`** and primary-nav logo height / max-width.

### Detail / nav glue (stable)

- **`"detail"`** in **`primaryNavScreens`**; **`clearDetailOverlayToNavigate()`** in **`navigatePrimarySection`** / **`onDiscover`**. **`AppPrimaryNav`**: **`onDetailBack={screen === "detail" ? goBack : undefined}`**.

## Recent work (Supabase / Circles / profiles)

- **`20260503120000_get_circle_member_names.sql`** — **`get_circle_member_names(p_circle_id)`** — apply on hosted DB if missing.
- **`20260522120000_circles_rated_all_top_grid.sql`** — **`get_circle_rated_all_grid`**, **`get_circle_rated_top_grid`** (Edge **`view`**).
- **`20260506120000_circles_strip_recent_activity.sql`** — **`get_circle_rated_strip`** recent-activity ordering + **`group_rating`** for single rater + **`trg_ratings_bump_rated_at`** on **`ratings`** score updates.
- **`20260505120000_circles_name_length_2_32.sql`** — **`circles.name`** length **2–32** (replaces legacy 1–40 check). Apply on hosted DB if not applied (existing rows must satisfy length before it succeeds).
- **`20260504120000_profiles_name_not_null.sql`** — backfill + **`NOT NULL`** on **`profiles.name`** — optional; run when product is ready.

## Neighbor CF + cron (unchanged thread)

### Client

- **`openDetail`:** `authedForCf = Boolean(sessionUser?.id ?? user?.id)`.
- **`runComputeNeighborsNow`:** `compute-neighbors` with **`userId`** after rating saves (debounced); logs Edge failures / **`stored === 0`**.

### Edge / DB

- **`compute-neighbors`:** `SEED_PREFIX` on **`profiles.name`** for subject eligibility; **`mode: "all"`** needs trusted cron/service secret. Atomic swap: **`commit_user_neighbors_swap`** (**`20260502120000_...`**).
- **`supabase/config.toml`:** **`[functions.compute-neighbors] verify_jwt = false`** for **`pg_net`** cron calls.

### Cron (prod)

- **`compute-neighbors-w00`…`w03`** (example): Sunday **05:00 / 05:03 / 05:06 / 05:09** UTC — **4 × limit** users per week unless more jobs/offsets added.

### Seed users (product + data)

- **Code:** “Seed” = **`profiles.name`** starting with **`seed`** (case-insensitive) — not email domain. **`mode: "all"`** skips them as subjects; they can still appear as **neighbors** until edges removed.
- **Bulk cleanup:** `@seed.cinemastro.local` users were mass-deleted via **`auth.users`** + dependent rows; batched CTE deletes work better than some **PROCEDURE** paths in the SQL editor (transaction nesting).

## Product rules (stable)

- Blue pill / neighbor-backed CF: **`neighborCount ≥ 1`**.
- Gold Cinemastro: community avg from **`cinemastroAvgByKey`**.
- Do **not** blindly re-add past regressions (detail predictions into all strips, badge order, “always Edge” in **`recFromMatchPrediction`**, etc.).

## Open / follow-ups

- **Circles (full backlog):** **`HANDOFF.md`** “What’s next” — **edit name & info**, **watchlist on Circles main page** (layout TBD), **circle name on watchlist rows** (`source_circle_id`), **invite email for non-users**, **phone verification at signup**, **Bayesian rating normalization**. *Quick-rate from inside a circle* is partially covered by **Rate a title** (Discover + return); a slimmer **in-place** pill without leaving the circle is still backlog if desired.
- **Cron:** audit **`jobs × limit`** vs eligible users; **`COMPUTE-NEIGHBORS-CRON.md`**.
- **Nav (optional):** **`126px`** header / scrim offsets — **`App.jsx`**.
- **Lint:** possible **`react-hooks/set-state-in-effect`** on **`AppPrimaryNav`** — pre-existing.

---
*Replace or trim after the next milestone; keep “Last updated” and the workflow/session blocks current.*
