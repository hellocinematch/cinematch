# Passdown for next chat (Cinematch)

**Last updated:** 2026-04-21

---

## Tell the next chat (copy from here)

> Cinematch is on **`main` at 5.6.24** (see `package.json`). Read **`@PASSDOWN-NEXT-CHAT.md`** and follow **`.cursor/rules/cinematch-discussion-first.mdc`** (don’t code unless I say *code now* / *implement* / *fix* / *do it* for that task, unless I clearly ask for code in the same message).  
> **Context:** **Circles** use **`rating_circle_shares`**. **Recent** strip: long-press or **⋯** → Details / Rate·Rerate / watchlist / Forward (manage) / Remove from circle; **Movie/TV · year** on-poster (muted chip) + `StripPosterBadge` + under-title **circle · Cinemastro** pill; **All / Top** = **3 lines** (title; **type · year**; ring **Circle** / **Cinemastro** / green **You**; **(n)** if **memberCount > 2**). **Strips** type/year lines use a muted chip (`.strip-genre`). **Watchlist:** max **30**; reorder (⋯ Top / Up / Down / Bottom) uses **`sort_index`**; **apply** **`20260523120000`** + **`20260525120000`** + **`20260526120000_watchlist_rls_update_own.sql`** on hosted DB (migrations are not Vercel); client treats **`UPDATE` `error` only** (no gating on empty RETURNING; some RLS setups omit returned rows). **Client:** **git push** → Vercel. **5.6.8** **navTab** from primary nav. **Edge** `get-circle-rated-titles` = RPC-only. **Cron:** **`COMPUTE-NEIGHBORS-CRON.md`**.

(Adjust or shorten if the next task is something else.)

---

## Snapshot (read this first)

| Item | State |
|------|--------|
| **App version** | **5.6.24** (`package.json` / `CHANGELOG.md`); Profile shows **Cinemastro v…** via **`APP_VERSION`** in `src/App.jsx`. |
| **Git** | **`main` pushed**; last ship **5.6.24** (watchlist reorder + **RLS UPDATE** migration + passdown). |
| **Supabase — apply if not already** | **`20260524120000_rating_circle_shares.sql`**, **`20260523120000_watchlist_sort_index.sql`**, **`20260525120000_watchlist_max_30.sql`**, **`20260526120000_watchlist_rls_update_own.sql`** (watchlist row **UPDATE** for reorder under RLS). |
| **Edge** | **`get-circle-rated-titles`** — RPC-only; **redeploy** only if function source changes. |
| **Client deploy** | **Vercel** on **`main`** push; migrations **not** auto-applied. |

**Watchlist (current behavior)**

- **DB:** `watchlist` stores **`user_id`**, **`tmdb_id`**, **`media_type`**, **`title`**, **`poster`**, **`sort_index`**, optional **`source_circle_id`**. **Max 30** rows per user — **`WATCHLIST_MAX`** + migration **`20260525120000_watchlist_max_30.sql`** (trim over-cap + insert trigger). At cap: toast; **+ Watchlist** (detail), **Select to Watch** (mood), **Add to watchlist** (circle menu) **disabled**; **Profile** / watchlist screen show **n / 30**. **`toggleWatchlist(movie, { skipGoBack, circleIdForSource })`** for strip/circle.
- **UI meta** (strip + list): **one line** under the title — **`Movie · YYYY · TMDB x.x · Genre`**. Enrichment via **`buildWatchlistFromRows`** + **`catalogue`**. **Detail** = full-fidelity.
- **Profile:** no duplicate **`page-topbar`** under primary nav; hero is **`profile-top`** only.
- **Bottom nav:** **Mood · Watchlist · Profile** — active tab = **faded circle** behind icon (no text labels).
- **Watchlist screen:** vertical **list**, **⋯** = **Details / ⇈ Top / ↑ Up / ↓ Down / ⇊ Bottom / Remove**. **Up** and **Down** swap **`sort_index`** with the adjacent row; **Top** / **Bottom** set **`sort_index`** below the current minimum / above the current maximum for that user (one update each).
- **Reordering (5.6.22–5.6.24):** **`loadUserData`** always rebuilds from **`watchlist`** rows when present (stubs in **`buildWatchlistFromRows`** if catalogue is empty). Keys for Supabase filters: **`watchlistRowKeys`**, **`tmdbId` / `tmdb_id` / `parseMediaKey(id)`**, **`media_type`** → **`movie` \| `tv`**. **Swap** / **Top** / **Bottom** do **not** require non-empty **`UPDATE … RETURNING`**; only a non-null **`error`** from the client is treated as failure. Hosted DB: apply **`20260526120000_watchlist_rls_update_own.sql`** so **`authenticated`** users can **`update`** their own **`watchlist`** rows if RLS was blocking **`sort_index`** updates.
- **Primary nav** (desktop + hamburger): includes **Watchlist**; **`navigatePrimarySection`**: **Watchlist** → `navTab` **watchlist**; **Pulse** → `navTab` **home**; **any other section** (Circles, Streaming, etc.) → **`setNavTab("home")`** + **`setScreen(…)`** so the bottom **Watchlist** ring does not stay on after you leave Watchlist via the top bar (**5.6.8**).
- **Detail:** optional line **Watchlist · from …** (circle name when resolvable) when saved from a circle (`source_circle_id` + **`circleNameById`** from **`circlesList`**).

---

## How the user wants to work

**Unless they clearly ask for code in the same message**, treat messages as **discussion only**: ideas, options, tradeoffs, example SQL in chat — **no `apply_patch`, no file edits, no “I implemented it”.**

**Write / change code only when:**

- The user says **`code now`**, **or**
- They answer **yes** after you ask something like **“Should I implement this now?”**

**When you do ship code:** bump **`package.json`** version and add a **`CHANGELOG.md`** entry in the **same change** (repo convention).

**Exception:** If they say **implement**, **fix**, **migrate**, or **do it** in **that** message for a specific task, that counts as permission for **that** task.

**Cursor rule (workspace):** `.cursor/rules/cinematch-discussion-first.mdc` — **`alwaysApply: true`**.

Partner rules: `.cursor/rules/cinematch-handoff.mdc`, `.cursor/rules/compute-neighbors-cron.mdc`.

**HANDOFF.md** — broader roadmap (Circles phases, “what’s next”); may lag version numbers — trust **`package.json`** / this file for release.

---

## For the assistant (every Cinematch session)

1. **Read this file early** when working in this repo — workflow, prod notes, **Watchlist / Circles / neighbors**, and recent UI behavior.
2. **Recurring ops:** as MAU grows, **`pg_cron`** **`compute-neighbors`** chunk coverage must grow — **`(# jobs) × (limit per job)`** must cover eligible non-seed users. **`COMPUTE-NEIGHBORS-CRON.md`**. Audit:  
   `select jobname, schedule from cron.job where jobname like 'compute-neighbors-w%';`
3. When the user asks to **“update passdown”** or after a milestone: **edit this file** (date, version, migrations, open items).

---

## Keep in mind every session

- **`COMPUTE-NEIGHBORS-CRON.md`** — Vault, `apikey` + `x-compute-neighbors-secret`, `pg_net` timeouts, staggered schedules, scaling formula.
- **Do not** assume the first wave of **`compute-neighbors-w*`** jobs covers everyone forever — expand **`offset`** / add **`cron.schedule`** rows as users grow.

---

## Changelog trail (recent)

- **5.6.24** — Watchlist ⋯ **moves:** don’t require **`UPDATE` RETURNING**; migration **`20260526120000_watchlist_rls_update_own`**. (Git **`770278e`** to **`main`**.)
- **5.6.23** — **Watchlist:** **`watchlistRowKeys`** fallbacks + stable **`tmdbId`** in **`buildWatchlistFromRows`**; RETURNING object/array fix (superseded by 5.6.24).
- **5.6.22** — **Watchlist** persist: **`loadUserData`** when rows exist; normalized **`media_type`**; numeric **`tmdb_id`** in Supabase filters.
- **5.6.12** — **Watchlist max 30** (client + migration trim + trigger).
- **5.6.11** — **Circles Recent:** long-press / **⋯** menu (Details, Rate·Rerate, watchlist, Forward, Remove from circle).
- **5.6.10** — **Circles All / Top:** **(n)** after **Circle** score when **memberCount > 2** and **n** raters (`distinct_circle_raters`).
- **5.6.9** — **Circles All / Top:** watchlist-style **list**; line 1 **title · year**; line 2 **Circle** → **You** → **Cinemastro** (⭐), omit missing; row opens **detail**.
- **5.6.8** — **Primary nav** → Circles/… clears **bottom** watchlist tab highlight (`navTab` `home`).
- **5.6.7** — Circle title lines **centered**; `⭐` score spacing.
- **5.6.6** — Circle strip/grid: one-line **title** + type · year · Cine; Circle score row unchanged.
- **5.6.5** — Recent: faded **←** in circle on **left** when you can pan left (more titles off-screen).
- **5.6.4** — Recent add column **76px** wide (half a strip poster), smaller **+**.
- **5.6.3** — Recent **+** in **poster** band, not vertically centered in full row.
- **5.6.2** — Recent: **+** in a **round** (muted) for add (replaces large add tile); **`aria-label`** for accessibility.
- **5.6.1** — Recent: **oldest → newest** (L→R), **Earlier** on the **left**, add tile to the right of newest; **center-on-land** scroll; empty / leave / grid copy = **publish**; removed bottom **Rate a title** pill.
- **5.6.0** — **`rating_circle_shares`**; circle strip/grids only show **published** titles; publish modal after first rating; **Publish to circles…** on detail; leave circle drops shares for that group.
- **5.5.21** — Watchlist **⋯**: **⇈ Top**, **↑ Up**, **↓ Down**, **⇊ Bottom** (+ Details, Remove); **`swapWatchlistOrder`**, **`moveWatchlistItemToTop`**, **`moveWatchlistItemToBottom`** in **`App.jsx`**.
- **5.5.20** — Single-line watchlist meta (type · year · TMDB · genre); strip ellipsis when narrow.
- **5.5.19** — **`sort_index`** migration; DB order; removed localStorage ordering for watchlist.
- **5.5.18** — ⋯ menu: Details, Move up, Remove (ordering was localStorage until 5.5.19).
- **5.5.17** — Profile header cleanup; bottom nav circle highlights; Watchlist list + nav link; circle name on detail when from group.
- **5.5.16** — Watchlist in bottom bar; dedicated **`watchlist`** screen; detail + bottom nav glue.

---

## Recent work (client — `src/App.jsx`)

**Primary file:** `src/App.jsx` (inline `<style>{styles}</style>` for nav, detail, circles, bottom nav, watchlist list CSS, etc.).

### Bottom navigation & Watchlist

- **`BottomNav`:** Mood · Watchlist · Profile; **active** = circular highlight; no community/ratings counts in bar.
- **`navigatePrimarySection`:** handles **`watchlist`** (sets **`navTab`** + **`screen`**).
- **`goBack`:** if **`navTab === "watchlist"`**, restores **`screen`** to **`watchlist`**.
- **`clearDetailOverlayToNavigate`** before leaving detail via Mood / Watchlist / Profile.
- **Watchlist reorder:** **`swapWatchlistOrder(id, "up" | "down")`** (TEMP swap); **`moveWatchlistItemToTop`** / **`moveWatchlistItemToBottom`**; **`buildWatchlistFromRows`**, **`watchlistRowKeys`**; **`setInviteToast`** is not used for reorder errors (see **`console.warn`**). **5.6.24:** no `.select()` gating on success.

### Circles

- **Circle detail:** Ratings **Recent / All / Top**; feeds = **`ratings` ∩ `rating_circle_shares`** for that circle. **`fetchCircleRatedTitles`** + Edge **`get-circle-rated-titles`**. Migrations: **`20260524120000_rating_circle_shares.sql`**, **`20260522120000_...`**, strip **`20260506120000_...`**, etc.
- **Publish:** first-time rating from detail → modal (skip OK); from circle flow, defaults include that circle. **Publish to circles…** on detail when already rated.
- **Recent strip:** Titles **oldest → newest** (L→R); **long-press** (~520ms) or **⋯** → Details, Rate/Rerate, watchlist add/remove (**`toggleWatchlist`** + **`skipGoBack`**), Forward (**`publishRatingModal` manage**), Remove from circle (**`unpublishTitleFromCircleStrip`**); **Earlier** (paginate) on the **left**; **+** in a **76px** poster band; **center-on-land**; **faded ←** when pannable.
- **All / Top:** **List** (like Watchlist): **title · year** on line 1; line 2 **Circle** / **You** / **Cinemastro** with **⭐** (omit if missing); **Circle** may show **(n)** after the score when **`memberCount > 2`** and **`distinct_circle_raters`**. **`CircleAllTopRatingsLine`**, **`formatCircleListYear`** in **`App.jsx`**. **Recent** strip cards still use **`formatCircleSublineTypeYearCine`** (centered poster row).
- **+** or empty state → **Discover**; **`rateTitleReturnCircleIdRef`** / **`detailReturnScreenRef`** for return to circle.

### Title detail (basics)

- Backdrop **`object-position: 30% top`**; mobile **`.d-title`** DM Sans; **`BottomNav`** inside **`.detail`**.

---

## Recent work (`src/circles.js`)

- **`fetchCircleRatedTitles({ circleId, limit, offset, view })`** — Edge + RPC fallbacks for strip/grids.

---

## Supabase migrations checklist (hosted DB)

Apply any that are missing on prod (user often uses SQL editor):

| Migration | Purpose |
|-----------|---------|
| **`20260524120000_rating_circle_shares.sql`** | **`rating_circle_shares`** + strip/all/top RPCs — **required** for circle rated feeds (publish model). |
| **`20260523120000_watchlist_sort_index.sql`** | **`watchlist.sort_index`** — **required** for watchlist ordering / **⋯** Top·Up·Down·Bottom. |
| **`20260525120000_watchlist_max_30.sql`** | **30** watchlist rows per user (trim + trigger); client **`WATCHLIST_MAX`**. |
| **`20260526120000_watchlist_rls_update_own.sql`** | RLS: **`update`** on own **`watchlist`** rows (`auth.uid() = user_id`) — for ⋯ **Top/Up/Down/Bottom** when RLS is on. |
| **`20260522120000_circles_rated_all_top_grid.sql`** | All/Top grid RPCs; then **redeploy** **`get-circle-rated-titles`**. |
| **`20260506120000_circles_strip_recent_activity.sql`** | Strip ordering + `rated_at` bump. |
| **`20260505120000_circles_name_length_2_32.sql`** | Circle name 2–32. |
| **`20260503120000_get_circle_member_names.sql`** | **`get_circle_member_names`**. |
| **`20260504120000_profiles_name_not_null.sql`** | Optional, when product-ready. |

**Edge:** **`get-circle-rated-titles`** — **`git push` does not deploy** — use `supabase functions deploy` for the project ref in **`HANDOFF.md`**.

---

## Neighbor CF + cron (stable)

- **Client:** **`openDetail`** uses authed user for CF; **`runComputeNeighborsNow`** after ratings (debounced).
- **Edge:** **`compute-neighbors`**; **`commit_user_neighbors_swap`**; **`config.toml`** **`verify_jwt = false`** for cron **`pg_net`**.
- **Seed:** **`profiles.name`** prefix **`seed`** (case-insensitive); **`mode: "all"`** skips as subjects.
- **Cron (example):** staggered **`compute-neighbors-w00`…`** Sunday UTC — scale **`jobs × limit`** with MAU.

## Product rules (stable)

- Neighbor-backed CF: **`neighborCount ≥ 1`**.
- Gold Cinemastro: community avg from **`cinemastroAvgByKey`**.
- Avoid known regressions (detail preds in all strips, badge order, etc.).

---

## Open / follow-ups

- **Prod Supabase:** confirm **`20260526120000_watchlist_rls_update_own.sql`** applied (SQL editor or **`db push`**) if watchlist RLS is enabled.
- **`ACCOUNT-SECURITY.md`** — Tightening user accounts: **Apple/Google OAuth** + **CAPTCHA** (preferred); optional **phone**; layers vs duplicate-account rating abuse.
- **`HANDOFF.md`** — Phase D (handle), **edit circle name/info**, watchlist on **Circles** landing (layout TBD; global Watchlist done), **`source_circle_id`** labels on rows, invites to non-users, Bayesian ratings, in-circle quick rate, etc.
- **Marketing stats:** can return in top bar / About — not in bottom nav.
- **Cron:** audit coverage vs eligible users.
- **Lint:** possible **`react-hooks/set-state-in-effect`** on **`AppPrimaryNav`** — pre-existing.

---

*Trim after the next milestone; keep **Last updated**, workflow block, and version row current.*
