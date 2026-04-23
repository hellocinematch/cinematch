# Passdown for next chat (Cinematch)

**Last updated:** 2026-04-22 (**Next chat:** circle activity Phase B polish / native push, or other backlog)

---

## Tell the next chat (copy from here)

> Cinematch is on **`main` at 5.6.37** (see `package.json`). Read **`@PASSDOWN-NEXT-CHAT.md`** and follow **`.cursor/rules/cinematch-discussion-first.mdc`** and **`.cursor/rules/cinematch-handoff.mdc`** (don’t code unless I say *code now* / *implement* / *fix* / *do it* for that task, unless I clearly ask for code in the same message). On **handoff updates**, include the session’s **last note** in passdown (see **§ For the assistant** item 4).  
> **Context:** **Circles** use **`rating_circle_shares`**. **Caps (prod):** **10** / **25** (client + invite Edge). **Watchlist** max **30**, **`sort_index`**, RLS **UPDATE** migration on prod if needed. **Primary nav:** no **`profiles.name`** pill (**5.6.30**). **Posters:** **`loading="lazy"`** (**5.6.31**); **`img src`** rewrites small UI to TMDB **`w342`**, detail / large cards **`w500`** (**5.6.32**); stored/catalogue URLs still **`w500`**. **5.6.33 — Circles activity (Phase A web):** list **bell + count**; in-circle **new activity** bar + refresh; **`circle_member_last_seen`** + RPCs (apply **`20260527120000_circle_member_last_seen.sql`** on prod). **PWA:** **`/site.webmanifest`**; **`apple-touch-icon`** = **`/apple-touch-icon.png`** (180×180); manifest **`/pwa-icon-192.png`**; **`/cinemastro-pwa-icon.svg`** = larger **wordmark**, slight **diagonal** (no tagline on icon; in-app logo unchanged). **Tab** **`/favicon.svg`**. **`npm run icons:pwa`** after SVG edits. **Client:** **git push** → Vercel. **Edge** `get-circle-rated-titles` = RPC-only. **Cron:** **`COMPUTE-NEIGHBORS-CRON.md`**. **Next build:** **native** push (APNs/FCM) for background circle updates; optional Realtime (Phase B). **§ Master backlog** + **`HANDOFF.md`** for the rest.

(Adjust or shorten if the next task is something else.)

---

## Snapshot (read this first)

| Item | State |
|------|--------|
| **App version** | **5.6.37** (`package.json` / `CHANGELOG.md`); Profile shows **Cinemastro v…** via **`APP_VERSION`** in `src/App.jsx`. |
| **Git** | **`main`** — **5.6.37** = **New activity** tile on **Recent** strip (left of **+**); **5.6.36** = no misfiring body pull; **5.6.35** = **10s** poll; **5.6.33**+ circle activity; **5.6.32** = TMDB **`w342`/`w500`**; **5.6.31** = lazy posters; **5.6.30** = removed header name pill. |
| **Supabase — apply if not already** | **`20260527120000_circle_member_last_seen.sql`** (circle **last seen** + RPCs for badges / watermark) — **required** for 5.6.33 Circles activity. Plus **`20260524120000_rating_circle_shares.sql`**, **`20260523120000_watchlist_sort_index.sql`**, **`20260525120000_watchlist_max_30.sql`**, **`20260526120000_watchlist_rls_update_own.sql`** (watchlist row **UPDATE** for reorder under RLS). |
| **Edge** | **`get-circle-rated-titles`** — RPC-only; **redeploy** only if function source changes. |
| **Client deploy** | **Vercel** on **`main`** push; migrations **not** auto-applied. |

**PWA / install (5.6.29)**

- **`/site.webmanifest`:** `name` / `short_name` **Cinemastro**, **`display: standalone`**, **theme/background** `#0a0a0a`, **`icons`:** **`/pwa-icon-192.png`** then **`/cinemastro-pwa-icon.svg`** (maskable **any**).  
- **`/cinemastro-pwa-icon.svg`:** 512×512, **`#0a0a0a`** background, **inlined** wordmark — **larger** type, **~−27°** diagonal (home-screen legibility); **no** “YOUR PERSONAL…” tagline on this asset (still on **`cinemastro-logo.svg`** in-app).  
- **`index.html`:** `link rel="manifest"`, `theme-color`, `application-name`, **`apple-touch-icon`** → **`/apple-touch-icon.png`** (180×180).  
- **Regenerate PNGs** after editing the master SVG: **`npm run icons:pwa`** (`scripts/generate-pwa-touch-icons.mjs`, **`@resvg/resvg-js`**).  
- **Favicon** for tabs/bookmarks: unchanged **`/favicon.svg`**.

**Watchlist (current behavior)**

- **DB:** `watchlist` stores **`user_id`**, **`tmdb_id`**, **`media_type`**, **`title`**, **`poster`**, **`sort_index`**, optional **`source_circle_id`**. **Max 30** rows per user — **`WATCHLIST_MAX`** + migration **`20260525120000_watchlist_max_30.sql`** (trim over-cap + insert trigger). At cap: toast; **+ Watchlist** (detail), **Select to Watch** (mood), **Add to watchlist** (circle menu) **disabled**; **Profile** / watchlist screen show **n / 30**. **`toggleWatchlist(movie, { skipGoBack, circleIdForSource })`** for strip/circle.
- **UI meta** (strip + list): **one line** under the title — **`Movie · YYYY · TMDB x.x · Genre`**. Enrichment via **`buildWatchlistFromRows`** + **`catalogue`**. **Detail** = full-fidelity.
- **Profile:** no duplicate **`page-topbar`** under primary nav; hero is **`profile-top`** only.
- **Bottom nav:** **Mood · Watchlist · Profile** — active tab = **faded circle** behind icon (no text labels).
- **Watchlist screen:** vertical **list**, **⋯** = **Details / ⇈ Top / ↑ Up / ↓ Down / ⇊ Bottom / Remove**. **Up** and **Down** swap **`sort_index`** with the adjacent row; **Top** / **Bottom** set **`sort_index`** below the current minimum / above the current maximum for that user (one update each).
- **Reordering (5.6.22–5.6.24):** **`loadUserData`** always rebuilds from **`watchlist`** rows when present (stubs in **`buildWatchlistFromRows`** if catalogue is empty). Keys for Supabase filters: **`watchlistRowKeys`**, **`tmdbId` / `tmdb_id` / `parseMediaKey(id)`**, **`media_type`** → **`movie` \| `tv`**. **Swap** / **Top** / **Bottom** do **not** require non-empty **`UPDATE … RETURNING`**; only a non-null **`error`** from the client is treated as failure. Hosted DB: apply **`20260526120000_watchlist_rls_update_own.sql`** so **`authenticated`** users can **`update`** their own **`watchlist`** rows if RLS was blocking **`sort_index`** updates.
- **Primary nav** (desktop + hamburger): includes **Watchlist**; **`navigatePrimarySection`**: **Watchlist** → `navTab` **watchlist**; **Pulse** → `navTab` **home**; **any other section** (Circles, Streaming, etc.) → **`setNavTab("home")`** + **`setScreen(…)`** so the bottom **Watchlist** ring does not stay on after you leave Watchlist via the top bar (**5.6.8**).
- **Detail:** optional line **Watchlist · from …** (circle name when resolvable) when saved from a circle (`source_circle_id` + **`circleNameById`** from **`circlesList`**).

**Circles — production caps (revert from testing)**

- If you **lower** caps locally (e.g. **3** active circles, **4** members per circle), **restore production** to these values everywhere they appear:
  - **10** active circles per user — `CIRCLE_CAP` in **`src/circles.js`**, and **`CIRCLE_USER_ACTIVE_CAP`** in Edge **`supabase/functions/send-circle-invite/index.ts`** and **`supabase/functions/accept-circle-invite/index.ts`**.
  - **25** members per circle — `CIRCLE_MEMBER_CAP` in those same **three** files.
- In **`src/App.jsx`**, avoid hard-coded “10-circle” copy; use **`CIRCLE_CAP`** (or match it when reverting) so UI strings stay correct.
- **Redeploy** both invite Edge functions after any cap change so the client and server stay aligned.
- **No Supabase SQL migration** is required to switch these numbers (enforcement is app + Edge; the circles schema comment documents intent only).

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
4. **When you write or update this handoff for the next chat** (including when the user says **“write a handoff”** / **“handoff for next chat”**), always include the session’s *last note* — the final thing the user asked for, decided, or left open in that thread (e.g. *“don’t implement X yet”*, a product call, a bug repro, or a **pending backlog** list). **Do not** only bump version: merge that **last note** into **Open / follow-ups** (or a short **Last session** bullet under it) so the next assistant sees it. After long threads, a **bulleted pending list** (Circles, watchlist, ops) is **required**; see **Open / follow-ups** in this file.

---

## Keep in mind every session

- **`COMPUTE-NEIGHBORS-CRON.md`** — Vault, `apikey` + `x-compute-neighbors-secret`, `pg_net` timeouts, staggered schedules, scaling formula.
- **Do not** assume the first wave of **`compute-neighbors-w*`** jobs covers everyone forever — expand **`offset`** / add **`cron.schedule`** rows as users grow.

---

## Changelog trail (recent)

- **5.6.37** — **Circles — New activity** on **Recent** horizontal strip: compact tile **left of +**; All/Top keep **under-tabs** line.  
- **5.6.36** — **Circles:** Dropped **body** pull-to-refresh (false triggers on mobile scroll/overscroll; strip reload only via **New activity → Refresh** or publish/unpublish).  
- **5.6.35** — **Circles — new activity in foreground:** **10s** poll + **ref**-stable interval (was 45s and reset on re-renders, so in-tab updates rarely showed).  
- **5.6.34** — **Circles — new activity on mobile / PWA:** `pageshow` for all resume types, `visibility` + delayed re-check, **45s** watermark-only poll on circle detail (visible doc only).  
- **5.6.33** — **Circles — activity (Phase A, web):** per-circle list badges (others’ **`rating_circle_shares`** vs **last seen**), in-circle **new activity** + refresh + pull; migration **`20260527120000_circle_member_last_seen.sql`**.  
- **5.6.32** — **TMDB:** **`posterSrcThumb`** (**`w342`**) vs **`posterSrcDetail`** (**`w500`**) at **`img`**; mood keeps backdrop **`w780`**.  
- **5.6.31** — **Performance:** Lazy-load off-screen poster **`img`**s; eager detail hero + onboarding / rate-more card.  
- **5.6.30** — **Primary nav:** Removed **`profiles.name`** pill (layout vs **Circles** et al. on narrow screens).  
- **5.6.29** — **PWA icon:** Bigger wordmark, diagonal tilt; regenerated PNGs.  
- **5.6.28** — **PWA / iOS:** **`apple-touch-icon.png`** (180×180), **`pwa-icon-192.png`** in manifest; **`cinemastro-pwa-icon.svg`** self-contained; **`npm run icons:pwa`** + **`@resvg/resvg-js`**.  
- **5.6.27** — **PWA:** `site.webmanifest` + square **`cinemastro-pwa-icon.svg`** (embeds **`cinemastro-logo.svg`**) for **Install** / home screen; `index.html` manifest + `theme-color` + `apple-touch-icon`. (Commit on **`main`**, e.g. **`876a484`**.)  
- **5.6.26** — Circles: **10** / **25** caps restored (client + invite Edge; redeployed by user).  
- **5.6.25** — **Header** `profiles.name` pill; testing caps 3/4 (superseded by 5.6.26 for prod).  
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

### PWA (5.6.29)

- **Files:** `index.html` (manifest + metas + **`apple-touch-icon.png`**), `public/site.webmanifest`, `public/cinemastro-pwa-icon.svg` (inlined wordmark), `public/apple-touch-icon.png`, `public/pwa-icon-192.png`, `scripts/generate-pwa-touch-icons.mjs`.

---

## Recent work (`src/circles.js`)

- **`fetchCircleRatedTitles({ circleId, limit, offset, view })`** — Edge + RPC fallbacks for strip/grids.

---

## Supabase migrations checklist (hosted DB)

Apply any that are missing on prod (user often uses SQL editor):

| Migration | Purpose |
|-----------|---------|
| **`20260527120000_circle_member_last_seen.sql`** | **`circle_member_last_seen`**, **last-seen** RPCs, index on **`(circle_id, created_at)`** for **`rating_circle_shares`** — **required** for 5.6.33 circle activity badges. |
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

## For the next chat — circle “updates” (after Phase A 5.6.33)

**Phase A (5.6.33) shipped on web** — `circle_member_last_seen`, **`get_my_circle_unseen_counts`**, **`mark_circle_last_seen`**, **`get_circle_others_activity_watermark`**, `src/circles.js` helpers, **`App.jsx`**: Circles list **🔔 + count** (others’ **`rating_circle_shares`** with `created_at` \> your **last_seen** for that circle); in-circle **“New activity”** bar + **Refresh**; **pull down** (touch, near page top) to refresh; **no** silent auto-refresh. Badges: **login**, **tab focus** / **visibility** / bfcache **pageshow (persisted)**, and **navigate to Circles list**.

**Still out of scope / next steps:**

- **Native (Phase A continuation):** **APNs / FCM** when there is a native app — not part of 5.6.33.
- **Web Phase B (optional):** **Realtime** or light polling for power users; **Web Push** only if product wants (heavy / iOS limits).
- **Apply migration on prod:** **`20260527120000_circle_member_last_seen.sql`**.

**Last user note (this session):** *Ship circle activity Phase A (list badges, in-circle refresh, persistence, web focus/resume) per PASSDOWN; bump version, CHANGELOG, and passdown.*

---

## Master backlog (consolidated checklist)

*One merged list from **§ Open / follow-ups**, **Roadmap**, **Speed / performance**, **Ongoing / ops**, and **`HANDOFF.md` § What’s next. Trust **`package.json`** for version. When you ship or cancel an item, update this section and/or the narrative blocks below so they don’t contradict.*

### Circles & feeds

1. **Circle activity / “live” feeds (phased):** **Phase A (5.6.33) shipped** — list **bell + count**, in-circle **new activity** + refresh, **`circle_member_last_seen`** + RPCs. **Next:** **native** push (APNs/FCM), optional **Realtime/polling** (Phase B), Web Push if desired. *See* **§ For the next chat — circle “updates”** above.
2. **“Unseen” activity (polish):** optional: dismiss rules, animation, or tuning count rules; core badges shipped in 5.6.33.
3. **Invites at max circles:** today **`auto_declined`** — recipient never sees invite; creator gets auto-decline. *Idea:* muted row for recipient (“at cap”) + open/pending for creator until resolved.
4. **Creator leave → transfer ownership:** keep circle **active**, hand off to next member (order: e.g. `joined_at`); **solo creator** edge case **TBD**. Today: archive-then-leave / dissolve-style (see **`HANDOFF.md`** architecture).

### Product — discovery & polish

5. **Phase D — `profiles.handle`:** search/invite by handle — **blocked on schema**.
6. **Edit circle:** name / description / (maybe) vibe from Circle info; **archived read-only**; reuse **`validateCircleName`** / limits in **`src/circles.js`**.
7. **Phase E polish:** animations, cover upload, **`icon_emoji`**, per-circle color, **archived** section.

### Watchlist, invites, ratings

8. **Watchlist on Circles landing:** surface watchlist on main Circles — **layout TBD** (`HANDOFF.md`).
9. **Watchlist rows — circle name:** when saved from a circle, show name via **`source_circle_id`** (partially in roadmap today).
10. **Invite → non-user email:** deliver path to **join** + accept circle invite — product detail **TBD**.
11. **In-circle quick rate pill:** rate from circle context → same **publish to circles** flow (`rating_circle_shares`).
12. **Bayesian (or similar) normalization** for ratings — formula + pipeline **TBD**.

### Security & trust

13. **`ACCOUNT-SECURITY.md`:** OAuth (e.g. Apple / Google), **CAPTCHA** on signup, optional **phone** verification — see file.

### Engineering — performance & platform

14. **Code-splitting:** route/screen **`lazy()` + `Suspense`** to cut first-load JS parse/compile.
15. **Fetch waterfalls:** shell + skeletons first; don’t await non-critical TMDB/secondary fetches before meaningful paint after auth.
16. **Split `App.jsx`:** move to **`pages/*`** (pure refactor, large file — `HANDOFF.md`).
17. **Caching:** Vercel CDN for hashed assets; optional short TTL for stable owned API responses.
18. **Vercel Image Optimization (optional):** `/_vercel/image` or framework integration — WebP/AVIF + resize vs raw TMDB.
19. **Smaller thumbs (optional):** e.g. **`w185`** for tiny list rows only if quality OK.
20. **Prefetch (optional):** low-priority hints for likely next screen — **careful on cellular**.
21. **Supabase hot paths:** fewer columns, indexes, avoid N+1; watch **RLS** cost on hot queries.
22. **Fonts:** subset / **`font-display`** if text blocks paint.
23. **PWA service worker (optional):** repeat-visit cache for shell/assets; respect **TMDB** hotlinking; cold first load unchanged.

### Ops, quality, docs

24. **Prod Supabase:** confirm **`20260526120000_watchlist_rls_update_own.sql`** if **RLS** on **`watchlist`** and **⋯ reorder** must work.
25. **Docs sync:** **`package.json`**, **`CHANGELOG.md`**, this file, **`HANDOFF.md`** version/callouts — don’t let **`HANDOFF`** version drift vs **`package.json`**.
26. **Marketing stats:** may return in top bar / About (not bottom nav).
27. **Cron:** **`compute-neighbors`** wave coverage vs MAU — **`COMPUTE-NEIGHBORS-CRON.md`**.
28. **Lint:** pre-existing **`react-hooks/set-state-in-effect`** in **`AppPrimaryNav`**.

### Small follow-ups (nice-to-have)

29. **Circle strip tabs:** **Top** copy vs **Most rated** by count — combine or rename if product wants both (`HANDOFF.md` item 11).

---

## Open / follow-ups

**Master checklist:** **§ Master backlog (consolidated checklist)** above — this section keeps **narrative**, **shipped** history, and **numbered 1–6** shorthand aligned with that list.

**Handoff rule:** the **last user note** from the prior session (see **§ For the assistant** item 4) must be reflected here or under **Last session** when you update this file.

**Shipped 2026-04-22**

- **5.6.33 — Circles activity (Phase A):** **PASSDOWN** / user asked to **implement** list **unseen** badges, **last_seen** + counts (**others’** **`rating_circle_shares`** after your **last visit**), in-circle **new activity** + **Refresh** + pull-down, web **login / focus / visibility / bfcache resume**; **no** background push (defer native). **Apply** migration **`20260527120000_circle_member_last_seen.sql`** on production Supabase.  
- **5.6.32 — Right-size posters:** User asked to ship **priority (1)** — rewrite **`img src`** to **`w342`** for strips/lists/grids/thumbs; **`w500`** for detail float, onboarding, rate-more, mood poster-only; backdrops unchanged.  
- **5.6.31 — Lazy posters:** **`loading="lazy"`** on poster **`img`**s (Vercel image proxy **TBD**). Detail **backdrop** **`fetchPriority="high"`**; hero poster + single-card flows **eager**.  
- **5.6.30 — Header name:** User asked to **remove** **`profiles.name`** pill from primary nav for now (was **bleeding** over **Circles** title on mobile). **Profile** screen unchanged.  
- **5.6.29 — PWA readability:** User asked for **larger** home-screen wordmark; shipped bigger type + **−27°** diagonal; tagline only on in-app **`cinemastro-logo.svg`**. Re-run **`npm run icons:pwa`** after SVG edits; redeploy, re-add icon if cached.  
- **5.6.28 — PWA / iOS home screen:** User saw **blank** tile on iPhone after Add to Home Screen (**SVG** touch icon with nested **`cinemastro-logo.svg`** not rasterized). Shipped **PNG** **`apple-touch-icon`** + **192** manifest icon; **self-contained** **`cinemastro-pwa-icon.svg`**; **`npm run icons:pwa`** to refresh PNGs from SVG. Push **`main`** → Vercel; user may need to **remove** old home-screen shortcut and **re-add** after deploy (Safari caches icons).
- **5.6.27 — PWA / beta install:** `site.webmanifest` + `cinemastro-pwa-icon.svg` (wordmark via embed; superseded for iOS by **5.6.28**).

**Last session backlog (2026-04-22)**

1. **Circle activity Phase A:** **shipped 5.6.33** — see **Changelog** and **§ For the next chat — circle “updates”**. **Prod:** run migration **`20260527120000_circle_member_last_seen.sql`**.

**Earlier backlog (2026-04-21) — not implemented unless user says *code now* / *implement* / *fix* for that item**

1. **Circle feeds — live / multi-user:** **Phase A** done (5.6.33); **native** push + optional **Realtime** remain.
2. **Circles list — “unseen” activity:** **shipped** in 5.6.33 (list badges; count = others’ shares after last_seen).
3. **Invites at max circles:** today **`auto_declined`**; recipient **never sees** invite; creator gets auto-decline. *Idea:* **muted** row for recipient (“at cap”) + **open/pending** for creator until resolved.
4. **Prod Supabase:** confirm **`20260526120000_watchlist_rls_update_own.sql`** if watchlist RLS is enabled and reorder must work.
5. **Docs:** keep **`package.json` / `CHANGELOG` / this file** in sync; **`HANDOFF.md`** roadmap **version** line lags if not refreshed — trust **`package.json`**.
6. **Creator leave → new owner, keep circle:** *Desired behavior:* when the **creator** leaves, **do not** archive/remove the circle; **transfer ownership** to the **next** member (define order: e.g. `joined_at`, member list) and keep the group **active**. *Current behavior (as of 5.6.x):* creator leave still follows **archive-then-leave** / dissolve-style flow in app + `HANDOFF.md` — changing this needs **client**, **RLS/Edge**, and **edge cases** (e.g. **creator is the only member** — archive vs delete vs require transfer — **TBD**).

**Roadmap (see also `HANDOFF.md`)**

- **Phase D — `profiles.handle`:** search/invite by handle (blocked on schema).
- **Edit circle** name/description/(maybe vibe) from Circle info; archived read-only.
- **Phase E polish:** animations, cover, `icon_emoji`, per-circle color, archived section.
- **Watchlist on Circles** landing; **`source_circle_id`** / circle name on list rows; **invites to non-user emails**; **in-circle quick rate**; **Bayesian** ratings; **`ACCOUNT-SECURITY.md`** (OAuth, CAPTCHA, optional phone); **split `App.jsx`**.

**Speed / performance (to do — beyond 5.6.31 lazy + 5.6.32 `w342`/`w500`)**

- **Code-split:** route/screen-level **`lazy()` + `Suspense`** for heavy UI (shrink parse/compile on first load).
- **Fetch waterfall:** keep shell + skeletons; avoid awaiting non-critical TMDB/secondary fetches before first meaningful paint after auth.
- **Caching:** lean on Vercel CDN for hashed assets; optional short TTL for stable owned API responses.
- **Vercel Image Optimization** (optional): `/_vercel/image` or framework integration — WebP/AVIF + resize vs raw TMDB URLs.
- **Smaller thumbs (optional):** e.g. **`w185`** for tiny list rows only if quality OK; keep strips/detail larger.
- **Prefetch (careful on cellular):** low-priority hints for likely next screen/data after login.
- **Supabase hot paths:** fewer columns, indexes, avoid N+1; watch RLS cost on hot queries.
- **Fonts:** subset / **`font-display`** if text ever blocks paint.
- **PWA SW (repeat visits):** optional cache for app shell/assets; respect TMDB hotlinking; cold first load unchanged.

**Ongoing / ops**

- **Marketing stats** may return in top bar / About — not in bottom nav. **Cron:** audit **`compute-neighbors`** coverage vs MAU (`COMPUTE-NEIGHBORS-CRON.md`). **Lint:** pre-existing **`react-hooks/set-state-in-effect`** in **`AppPrimaryNav`**.

---

*Legacy pointer:* Pending work lives in **§ Master backlog** plus narrative in **Open / follow-ups**; future passdowns should not drop **last-note** class updates.

---

*Trim after the next milestone; keep **Last updated**, workflow block, and version row current.*
