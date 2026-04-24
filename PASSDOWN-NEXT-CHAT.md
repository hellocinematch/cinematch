# Passdown for next chat (Cinematch)

**Last updated:** 2026-04-24 — **`main` at 6.0.14** (see `package.json` / **CHANGELOG**). **6.0.14** — Indian+TV+**Netflix** only: **`with_origin_country=IN`**; **Prime** / **Hulu** broad+client taste (6.0.13 hurt those). **6.0.13** — **`with_origin_country=IN`** for all TV (reverted in **6.0.14** for 9/15). **6.0.12** — Indian taste language **or** IN origin. **6.0.11** / **6.0.10** / **6.0.9** — see **CHANGELOG**. **6.0.7** — **Secondary Region** → **Streaming**: service pill + **discover** refill (`watch_region` = market). **6.0.6** — **Streaming** service control: one **row** with **Series** / **Movies**; **divider**; **chevron**; **gold** when a provider is selected. **6.0.2–6.0.3** — **original language** (TMDB) on **secondary Region** strip + **title detail** facts bar (`formatOriginalLanguageDisplay`, `detailMeta.languageLabel` from detail fetch). **6.0.4–6.0.5** — **Streaming** page: **All services** = legacy pools; **service `<select>`** (`.streaming-page-service-select` in **`App.css`**) = **independent of profile** `streaming_provider_ids` (**Your Picks** still uses profile). **6.0.5** — choosing a service **re-fills** from TMDB **discover** (`with_watch_providers`, `watch_region=US`, `with_watch_monetization_types=flatrate`), cap **20**, `hasExcludedGenre` on results; **staggered** reveal 4→9→14→19→20; `predict_cached` uses refilled list when filtered (`streamingMoviesForPredict` / `streamingTVForPredict`, preserve order). **6.0.1** — secondary **Region** strip load reliability. **6.0.0** — **`src/App.css`**. **Recent Circles (unchanged):** **5.6.50–5.6.52** (Forward, creator leave, edit circle). **To do (moderation):** **§ Master backlog 4a–4c, 4e**; **4d** last-member **disintegrate** TBD. **Deferred:** scroll-stop **`predict_cached`**. See **§ Last session** below.

---

## Tell the next chat (copy from here)

> Cinematch is on **`main` at 6.0.11** (see `package.json`). Read **`@PASSDOWN-NEXT-CHAT.md`** and follow **`.cursor/rules/cinematch-discussion-first.mdc`** and **`.cursor/rules/cinematch-handoff.mdc`** (don’t code unless I say *code now* / *implement* / *fix* / *do it* for that task, unless I clearly ask for code in the same message). On **handoff updates**, include the session’s **last note** in passdown (see **§ For the assistant** item 4).  
> **Context:** **6.0.11** — secondary: **no** profile **genres** on secondary strips/refill/merge; **Indian** = client language filter after broad discover. **6.0.6–6.0.7** — **Streaming** page: service **pill** + **divider** + **Series**/**Movies**; **6.0.5** = **US** discover refill, cap 20. **6.0.7–6.0.8** — **Secondary Region** / **Streaming**: same + **`with_original_language`** (non-Indian). **6.0.9** — secondary **US** only (**`SECONDARY_AVAILABILITY_TMDB_REGION`**), taste = **`getRegionLanguageCodes`**; removed **IN/KR/…** map. **6.0.10** — secondary **service** refill: **not** global **`showRegionKeys`**. **6.0.2–6.0.3** — original **language** on Region strip + detail. **Your Picks** = profile `streaming_provider_ids` only. **6.0.0** — **`App.css`**. **Circles** / **caps** / **Edge** / **migrations** / **Vercel** / **cron** — see full passdown. **Next:** **§ Master backlog**; **beta** feedback.

(Adjust or shorten if the next task is something else.)

---

## Snapshot (read this first)

| Item | State |
|------|--------|
| **App version** | **6.0.11** (`package.json` / `CHANGELOG.md`); Profile shows **Cinemastro v…** via **`APP_VERSION`**. **6.0.11** — secondary: **no** profile **genres** on secondary shelves; **Indian** taste via client `original_language` after broad US discover. **6.0.10** — secondary service refill: no global **`showRegionKeys`**. **6.0.0** — global CSS **`src/App.css`**. **6.0.1** — secondary Region strip reliability. **6.0.2–6.0.3** — original **language** (Region strip + detail). **6.0.4–6.0.5** — Streaming: **service** + **6.0.5** **discover** refill. |
| **Git** | **`main`** = **6.0.11** (push when ready); **5.6.52** edit circle; **5.6.51** **`creator_leave_circle`**; **5.6.50** Forward + strip order. |
| **Supabase — apply if not already** | **`20260529120000_creator_leave_transfer_ownership.sql`** — **creator** leave **transfers** `creator_id` when **≥2** members. Plus prior: **`20260528120000_circle_strip_share_activity_order.sql`**, **`20260527120000_circle_member_last_seen.sql`**, **`20260524120000_rating_circle_shares.sql`**, **`20260523120000_watchlist_sort_index.sql`**, **`20260525120000_watchlist_max_30.sql`**, **`20260526120000_watchlist_rls_update_own.sql`**. |
| **Edge** | Each of **`get-circle-rated-titles`**, **`send-circle-invite`**, **`accept-circle-invite`**, **`compute-neighbors`**, **`match`**: `index.ts` has **`EDGE_FUNCTION_VERSION`**; JSON bodies include **`edge: { name, version }`**. On any code change: **bump** that constant (semver) in the **same** commit, **redeploy** that function, confirm **`edge.version`** in a test response. |
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

**When you do ship code:** bump **`package.json`** version and add a **`CHANGELOG.md`** entry in the **same change** (repo convention). **Edge functions:** in **`supabase/functions/<name>/index.ts`**, bump **`EDGE_FUNCTION_VERSION`** in the **same** change as any behavior or import change, then **redeploy**; responses expose **`edge.version`** for prod verification.

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
5. **Circles moderation backlog (not implemented):** scannable **checkbox** list under **§ Master backlog** — **“Circles moderation & lifecycle — things to do”** (items **4a–4e**, main list **4–8**). Update checkboxes when features ship; full spec is in those **items 4–8** (not only a nested sub-list).

---

## Keep in mind every session

- **`COMPUTE-NEIGHBORS-CRON.md`** — Vault, `apikey` + `x-compute-neighbors-secret`, `pg_net` timeouts, staggered schedules, scaling formula.
- **Do not** assume the first wave of **`compute-neighbors-w*`** jobs covers everyone forever — expand **`offset`** / add **`cron.schedule`** rows as users grow.

---

## Changelog trail (recent)

- **6.0.9** — **Secondary Region:** **`SECONDARY_AVAILABILITY_TMDB_REGION` = US** for theaters, streaming, service discover; **`secondary_region_key`** → language only; removed **`secondaryMarketTmdbRegion`**. **6.0.8** — secondary refill **`with_original_language`**. **6.0.7** — secondary service UI + discover. **6.0.6** — **Streaming** pill row. **6.0.5** — **US** **discover**, **`predict_cached`**. **6.0.4** — service `<select>`.  
- **6.0.3** — **Title detail:** **Original language** in **facts** bar (from TMDB detail `original_language` via `detailMeta.languageLabel`). **6.0.2** — **Region (secondary) strip:** **Language** in strip meta (`formatSecondaryRegionStripMeta` / `formatOriginalLanguageDisplay`).  
- **6.0.1** — **Region (secondary) strip:** Fast **`secondary_region_key`** from Supabase after bootstrap; **try/catch/finally** for TMDB **Promise.all** so the strip is not left loading or empty until refresh.  
- **6.0.0** — **Refactor:** global stylesheet in **`src/App.css`** (imported from **`App.jsx`**); no intended UI or product change. **Major** = structural milestone.  
- **5.6.52** — **Circles — edit info:** **Creator** updates **name**, **description**, **vibe** for **active** circles; **Edit** on **Circles list** + **“Edit name & description”** in **Circle info**; **`updateCircle`** in **`src/circles.js`**. **No** migration.  
- **5.6.51** — **Creator leave** — if **other members** remain, **`creator_id`** **transfers** to **earliest** `joined_at` (RPC **`creator_leave_circle`**); **solo** creator → **archive** + leave. Migration **`20260529120000_creator_leave_transfer_ownership.sql`**.  
- **5.6.50** — **Forward** add-only + **`addRatingCircleShares`**; **strip** **`greatest(rated_at, share.created_at)`** (migration **`20260528120000_circle_strip_share_activity_order.sql`**).  
- **5.6.49** — **Circles — star parity:** **Circle (orange) and Cinemastro (gold)** use the **same SVG** path with **`currentColor`**, **fixed** sizes — strip **16px**, All/Top list **13px** — so stars **match** (replaces gold **emoji** + `em`-sized orange SVG mismatch). **Build:** removed **backticks** inside a **CSS** comment in the `styles` template literal (they **broke** `vite build`). **Edge** (`match` + lineage): same **`edge: { name, version }`** convention.  
- **5.6.38** — **Supabase Edge — deploy lineage:** **`EDGE_FUNCTION_VERSION`** per function + **`edge: { name, version }`** on all JSON responses; bump version whenever that function’s code changes, then redeploy.  
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

**Primary file:** `src/App.jsx` + global **`src/App.css`**. **6.0.1** — secondary **Region** (`screen === "secondary-region"`): reliable strip fetch. **6.0.2** — Region strip: **`formatSecondaryRegionStripMeta`** = **`formatStripMediaMeta`** + **`formatOriginalLanguageDisplay`(`movie.language`)**. **6.0.3** — **Detail:** **`detailMetaFromTmdbDetail`** adds **`languageLabel`**; facts row includes language with cert / date / runtime. **6.0.4–6.0.5** — **`screen === "streaming-page"`:** service **`<select>`** (`STREAMING_SERVICES` ids); **6.0.5** `fetchStreamingPageProviderRefillPool` (default **`watch_region=US`**) + `streamingPageRefill*`; **6.0.6** — single **`filter-row`** + **active** class. **6.0.7–6.0.8** — secondary **Streaming** service UI + **discover** refill. **6.0.9** — secondary **Region** uses **`SECONDARY_AVAILABILITY_TMDB_REGION` (US)** for all **TMDB** `region` / `watch_region` on that page; **taste** = **`getRegionLanguageCodes`**. **All** = unchanged for main **Streaming** page.

### Bottom navigation & Watchlist

- **`BottomNav`:** Mood · Watchlist · Profile; **active** = circular highlight; no community/ratings counts in bar.
- **`navigatePrimarySection`:** handles **`watchlist`** (sets **`navTab`** + **`screen`**).
- **`goBack`:** if **`navTab === "watchlist"`**, restores **`screen`** to **`watchlist`**.
- **`clearDetailOverlayToNavigate`** before leaving detail via Mood / Watchlist / Profile.
- **Watchlist reorder:** **`swapWatchlistOrder(id, "up" | "down")`** (TEMP swap); **`moveWatchlistItemToTop`** / **`moveWatchlistItemToBottom`**; **`buildWatchlistFromRows`**, **`watchlistRowKeys`**; **`setInviteToast`** is not used for reorder errors (see **`console.warn`**). **5.6.24:** no `.select()` gating on success.

### Circles

- **Circle activity (5.6.33–5.6.37):** **`circle_member_last_seen`** (Supabase) + RPCs; **`fetchMyCircleUnseenActivity`**, **`markCircleLastSeen`**, **`getCircleOthersActivityWatermark`** in **`src/circles.js`**. **`App.jsx`:** `circleUnseenById` / list **bell+count**; `checkRemoteCircleNewActivity` + 10s interval (ref) + **visibility** / **focus** / **pageshow**; **“New”** strip tile (left of **+**) + All/Top compact row; `mark` on open circle. **Assumed use** (short sessions; leave/resume may refetch) — see **§ Circles activity — assumed use** in this file.
- **5.6.49 — Circle score stars:** **`CirclePillStarGlyph`** + shared path constant; **orange** circle + **gold** Cinemastro use the same SVG (**`currentColor`**), **16×16** Recent under-title pill, **13×13** All/Top list — replaces mismatched **emoji** / `em` sizing. **`CircleStripRingCineBelowTitle`**, **`CircleAllTopRatingsLine`** / **`CircleGroupScoreIcon`** (`variant="list"`).
- **5.6.50 — Forward** (strip ⋯): **`addRatingCircleShares`**; **Recent** strip sort uses **share** `created_at` (DB migration). **5.6.51 — Creator leave:** RPC **`creator_leave_circle`** (client **`leaveCircle`**); leave **copy** solo vs transfer. **5.6.52 — Edit circle:** **`updateCircle`**; list card **Edit** + **Circle info** “Edit name & description”; **`fetchMyCircles`** includes **`joined_at`** on members.
- **Circle detail:** Ratings **Recent / All / Top**; feeds = **`ratings` ∩ `rating_circle_shares`** for that circle. **`fetchCircleRatedTitles`** + Edge **`get-circle-rated-titles`**. Migrations: **`20260524120000_rating_circle_shares.sql`**, **`20260522120000_...`**, strip **`20260506120000_...`**, etc.
- **Publish:** first-time rating from detail → modal (skip OK); from circle flow, defaults include that circle. **Publish to circles…** on detail when already rated.
- **Recent strip:** Titles **oldest → newest** (L→R); **long-press** (~520ms) or **⋯** → Details, Rate/Rerate, watchlist add/remove (**`toggleWatchlist`** + **`skipGoBack`**), Forward (**`publishRatingModal` manage**), Remove from circle (**`unpublishTitleFromCircleStrip`**); **Earlier** (paginate) on the **left**; **+** in a **76px** poster band; **center-on-land**; **faded ←** when pannable; optional **New activity** tile **left of +** when the activity watermark is newer than the last loaded baseline (5.6.33+).
- **All / Top:** **List** (like Watchlist): **title · year** on line 1; line 2 **Circle** / **You** / **Cinemastro** with **⭐** (omit if missing); **Circle** may show **(n)** after the score when **`memberCount > 2`** and **`distinct_circle_raters`**. **`CircleAllTopRatingsLine`**, **`formatCircleListYear`** in **`App.jsx`**. **Recent** strip cards still use **`formatCircleSublineTypeYearCine`** (centered poster row).
- **+** or empty state → **Discover**; **`rateTitleReturnCircleIdRef`** / **`detailReturnScreenRef`** for return to circle.

### Title detail (basics)

- Backdrop **`object-position: 30% top`**; mobile **`.d-title`** DM Sans; **`BottomNav`** inside **`.detail`**. **6.0.3+** — **facts** bar: optional **`languageLabel`** (TMDB **`original_language`**) with certification / US release / runtime.

### PWA (5.6.29)

- **Files:** `index.html` (manifest + metas + **`apple-touch-icon.png`**), `public/site.webmanifest`, `public/cinemastro-pwa-icon.svg` (inlined wordmark), `public/apple-touch-icon.png`, `public/pwa-icon-192.png`, `scripts/generate-pwa-touch-icons.mjs`.

---

## Recent work (`src/circles.js`)

- **`fetchCircleRatedTitles({ circleId, limit, offset, view })`** — Edge + RPC fallbacks for strip/grids.
- **5.6.52 — `updateCircle`**, **5.6.50 — `addRatingCircleShares`**, **`fetchMyCircles`** with **`joined_at`** on **`circle_members`**.
- **Circle activity (5.6.33+):** **`fetchMyCircleUnseenActivity`**, **`markCircleLastSeen`**, **`getCircleOthersActivityWatermark`** (Supabase RPCs; see migration **`20260527120000_circle_member_last_seen.sql`**).

---

## Supabase migrations checklist (hosted DB)

Apply any that are missing on prod (user often uses SQL editor):

| Migration | Purpose |
|-----------|---------|
| **`20260527120000_circle_member_last_seen.sql`** | **`circle_member_last_seen`**, **last-seen** RPCs, index on **`(circle_id, created_at)`** for **`rating_circle_shares`** — **required** for 5.6.33 circle activity badges. |
| **`20260529120000_creator_leave_transfer_ownership.sql`** | **`creator_leave_circle`** — creator leave **transfers** `creator_id` when **≥2** members; solo creator leave **archives** (5.6.51). |
| **`20260528120000_circle_strip_share_activity_order.sql`** | Recent strip **`last_at`** = **`max(greatest(rated_at, share.created_at))`** (forward surfaces as recent). |
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

## Circles — ratings & strip predictions (5.6.49+)

**Color language (user-facing; teach during beta):**

- **Green** (poster pill, ★): **Your** rating.
- **Blue** (poster pill, border `strip-badge--predicted`): **Personal / “for you”** prediction (neighbor-backed when **`neighborCount ≥ 1`**; lighter blue = provisional / low overlap per product rules).
- **Gold** (poster pill; often with **vote meter** when Cinemastro-sourced): **Cinemastro** community average, or **TMDB** when that is the fallback in `stripBadgeDisplay`.
- **Orange** (under-title strip, All/Top list): **Circle (group) score** — average among **members who published** that title to the circle.
- **Gold** second star/segment under title: **Cinemastro site** average for the **same** title (global aggregate), **not** the same field as the orange circle number.
- **Active tab** (Recent / All / Top) uses **brand gold** for “selected” — **navigation chrome**, not a score.

**Why circle / Cinemastro / predicted can show the *same* number (e.g. 8.0):** they are **different** aggregates. With **one** circle rater, circle average **is** that one score. If **one** (or few) **site-wide** raters, Cinemastro can match. **Predicted** can coincide by coincidence or thin signal — **not** one field copied three ways.

**Strip vs detail — “blue lags until I open detail”:**

- Edge **`get-circle-rated-titles`** attaches **`prediction`** from **`user_title_predictions`** (batched, TTL + `model_version` check). **Cold or missing row → `prediction` null** → poster pill shows **Cinemastro/TMDB** (or green if you rated). Avoids **N×** `predict_cached` on every strip open.
- **Title detail** runs **`predict_cached` / match** and **writes** the cache, so the **next** strip load can show **blue** — expected behavior today.

**Deferred (2026-04-22 — pre-beta, user decision):** **Do not** implement **scroll-stop** / idle **`predict_cached`** for only **visible** strip tiles **yet** — let **beta** roll; **detail** still hydrates predictions; **too many** color meanings to layer more behavior before feedback. Revisit with **§ Master backlog** when product wants it.

---

## For the next chat — circle “updates” (after Phase A 5.6.33)

**Phase A (5.6.33+) shipped on web** — `circle_member_last_seen`, **`get_my_circle_unseen_counts`**, **`mark_circle_last_seen`**, **`get_circle_others_activity_watermark`**, `src/circles.js` helpers, **`App.jsx`**: Circles list **🔔 + count** (others’ **`rating_circle_shares`** with `created_at` \> your **last_seen** for that circle); in-circle **“New activity”** as a **76px** strip tile (**Recent**, immediately **left of +**) + **Refresh**; compact line under **All/Top** tabs when applicable; **~10s** visible-document watermark poll (not a full silent strip rewrite by itself; see **assumed use** below). Badges: **login**, **tab focus** / **visibility** / **pageshow**, and **navigate to Circles list**. (Body-level pull-to-refresh was **removed** in 5.6.36 — it misfired on mobile scroll.)

**Circles activity — assumed use (web / PWA v1)**

- **Session length:** We assume members **do not** keep **circle detail** open for a **very long** continuous visit in one sitting. Short trips in and out of the circle are the norm.
- **Implicit updates are acceptable:** Leaving the circle (**navigation**), switching **tabs** or **apps**, or **focus / visibility** changes can cause the **Recent** strip (or related loaders) to **refetch** or show newer data **without** the user tapping **New activity → Refresh**. That is **OK for v1** on browser / PWA; it covers “I stepped away and came back.”
- **Explicit path when staying on screen:** The **New activity** tile on the **Recent** strip, the **~10s** watermark check, and **Circles list** badges are the deliberate “something changed” affordances. A stricter contract (**no** refetch on resume, **only** on explicit **Refresh**) is **deferred** to a **native** client or a later **WebView** / lifecycle pass—not required for current web v1.
- **Why defer:** Simpler shipping; PWA and browser **lifecycle** events are inconsistent (especially on **iOS**). Revisit when building a true app.

**Still out of scope / next steps:**

- **Native (Phase A continuation):** **APNs / FCM** when there is a native app — not part of 5.6.33.
- **Web Phase B (optional):** **Realtime** or light polling for power users; **Web Push** only if product wants (heavy / iOS limits).
- **Apply migration on prod:** **`20260527120000_circle_member_last_seen.sql`**.

**Last user note (end of thread / new chat):** *See **§ Open / follow-ups — Last session (2026-04-22)** for the current handoff (5.6.52 + migrations).*

---

## Master backlog (consolidated checklist)

*One merged list from **§ Open / follow-ups**, **Roadmap**, **Speed / performance**, **Ongoing / ops**, and **`HANDOFF.md` § What’s next. Trust **`package.json`** for version. When you ship or cancel an item, update this section and/or the narrative blocks below so they don’t contradict.*

### Circles & feeds

1. **Circle activity / “live” feeds (phased):** **Phase A (5.6.33) shipped** — list **bell + count**, in-circle **new activity** + refresh, **`circle_member_last_seen`** + RPCs. **Next:** **native** push (APNs/FCM), optional **Realtime/polling** (Phase B), Web Push if desired. *See* **§ For the next chat — circle “updates”** above.
1b. **Recent strip — personal prediction (blue) hydration (deferred post-beta):** optional **scroll-stop** / idle **`predict_cached`** for **1–2** visible **unrated** titles to show **blue** without opening **detail**; **not** implemented as of 5.6.49 — user chose **beta first**, **detail** already fetches; **revisit** after feedback. *See* **§ Circles — ratings & strip predictions**.
2. **“Unseen” activity (polish):** optional: dismiss rules, animation, or tuning count rules; core badges shipped in 5.6.33.
3. **Invites at max circles:** today **`auto_declined`** — recipient never sees invite; creator gets auto-decline. *Idea:* muted row for recipient (“at cap”) + open/pending for creator until resolved.
4. **(4a) Circles — admin line / successor order:** **Creator** = primary mod. **Auto-designate** up to two **sub-admins** as the **2nd and 3rd members to join** (by `joined_at` / join order) so **successor order** is always known without manual picks.
5. **(4b) Circles — remove member:** **Creator/admins** can **remove a user** from the circle (new RLS / RPC or Edge; today `circle_members` DELETE is **self-only** — see passdown / schema). Aligns with familiar chat **admin** behavior.
6. **(4c) Circles — request unpublish title:** **Request** flow — ask the **publisher** to **unpublish** a title from the group (notification + deep link to unpublish) for **wrong fit** without ejecting the member. Complements **show who published** (when implemented).
7. **(4d) Circles — creator leave + group survival (partially shipped):** If **>1 member** remains, **do not** kill the circle: **transfer ownership** to the **next in line** (e.g. **2nd joiner** admin, else **3rd joiner**). If **0–1 members** and the **last person** leaves or **deletes the group**, **disintegrate** (archive/delete — exact rule **TBD**). **Shipped (5.6.51):** creator leave with **≥2 members** → **`creator_leave_circle`** RPC transfers **`creator_id`** to **earliest `joined_at`** among **other** members, then removes the leaver (no archive). **Solo** creator leave → **archive** + leave (unchanged). *Still TBD:* explicit **“delete group”** for last member, **2nd/3rd** as named **admin** roles beyond `creator_id` / one `role='creator'` row.
8. **(4e) Circles — solo only after others left (anti–shadow-watchlist):** If the circle **used to have 2+ members** and the **last other member(s) leave**, the **one remaining** user is not in the same boat as a **fresh** solo create + invite. Product intent: **~7 day grace** (default; **TBD** at build) to **invite** someone or **close** the circle — avoids using an empty social shell as a **second watchlist**; after grace, **nudge** or **force** **Close** (or require invite) — enforcement **TBD**. *Implementation needs* a **transition timestamp** (e.g. when `member_count` first drops to **1** from **≥2**) or equivalent.

**Circles moderation & lifecycle — things to do** (same as **items 4–8**; use this as a scan list; check off when shipped.)

- [ ] **4a** — Auto **2nd / 3rd joiner** admins / **successor** order (`joined_at`) — *main list **4***.
- [ ] **4b** — **Remove member** (creator/admins; RLS / RPC or Edge) — *main list **5***.
- [ ] **4c** — **Request unpublish** title + **show who published** (if not already) — *main list **6***.
- [x] **4d** — **Creator leave** → **transfer** if **>1** member (**5.6.51** `creator_leave_circle`). *Open:* last-member **delete group** / full **disintegrate** rules — *main list **7***.
- [ ] **4e** — **Solo after exodus** — **~7 day grace**, then **invite** or **close**; track **≥2 → 1** transition time in DB — *main list **8***.

### Product — discovery & polish

9. **Phase D — `profiles.handle`:** search/invite by handle — **blocked on schema**.
10. **Edit circle** — **shipped 5.6.52:** name / description / vibe; **active** + **creator** only; **`updateCircle`**. *Polish (optional):* **archived** read-only is already the case (list only **active**); no extra work unless showing archived later.
11. **Phase E polish:** animations, cover upload, **`icon_emoji`**, per-circle color, **archived** section.

### Watchlist, invites, ratings

12. **Watchlist on Circles landing:** surface watchlist on main Circles — **layout TBD** (`HANDOFF.md`).
13. **Watchlist rows — circle name:** when saved from a circle, show name via **`source_circle_id`** (partially in roadmap today).
14. **Invite → non-user email:** deliver path to **join** + accept circle invite — product detail **TBD**.
15. **In-circle quick rate pill:** rate from circle context → same **publish to circles** flow (`rating_circle_shares`).
16. **Bayesian (or similar) normalization** for ratings — formula + pipeline **TBD**.

### Security & trust

17. **`ACCOUNT-SECURITY.md`:** OAuth (e.g. Apple / Google), **CAPTCHA** on signup, optional **phone** verification — see file.

### Engineering — performance & platform

18. **Code-splitting:** route/screen **`lazy()` + `Suspense`** to cut first-load JS parse/compile.
19. **Fetch waterfalls:** shell + skeletons first; don’t await non-critical TMDB/secondary fetches before meaningful paint after auth.
20. **Split `App.jsx`:** move to **`pages/*`** (pure refactor, large file — `HANDOFF.md`).
21. **Caching:** Vercel CDN for hashed assets; optional short TTL for stable owned API responses.
22. **Vercel Image Optimization (optional):** `/_vercel/image` or framework integration — WebP/AVIF + resize vs raw TMDB.
23. **Smaller thumbs (optional):** e.g. **`w185`** for tiny list rows only if quality OK.
24. **Prefetch (optional):** low-priority hints for likely next screen — **careful on cellular**.
25. **Supabase hot paths:** fewer columns, indexes, avoid N+1; watch **RLS** cost on hot queries.
26. **Fonts:** subset / **`font-display`** if text blocks paint.
27. **PWA service worker (optional):** repeat-visit cache for shell/assets; respect **TMDB** hotlinking; cold first load unchanged.

### Ops, quality, docs

28. **Prod Supabase:** confirm **`20260526120000_watchlist_rls_update_own.sql`** if **RLS** on **`watchlist`** and **⋯ reorder** must work.
29. **Docs sync:** **`package.json`**, **`CHANGELOG.md`**, this file, **`HANDOFF.md`** version/callouts — don’t let **`HANDOFF`** version drift vs **`package.json`**.
30. **Marketing stats:** may return in top bar / About (not bottom nav).
31. **Cron:** **`compute-neighbors`** wave coverage vs MAU — **`COMPUTE-NEIGHBORS-CRON.md`**.
32. **Lint:** pre-existing **`react-hooks/set-state-in-effect`** in **`AppPrimaryNav`**.

### Small follow-ups (nice-to-have)

33. **Circle strip tabs:** **Top** copy vs **Most rated** by count — combine or rename if product wants both (`HANDOFF.md` item 11).

---

## Open / follow-ups

**Master checklist:** **§ Master backlog (consolidated checklist)** above — this section keeps **narrative**, **shipped** history, and **numbered 1–33** shorthand aligned with that list (Circles **1–1b, 2, 3,** moderation **4–8** = **4a–4e**, then Product **9–11**, etc.).

**Handoff rule:** the **last user note** from the prior session (see **§ For the assistant** item 4) must be reflected here or under **Last session** when you update this file.

**Last session (2026-04-24) — for the next chat**

- **6.0.11 (this session):** Secondary Region — **no** profile **genres** on secondary **Streaming** / **Theaters** / service refill / **`catalogueForRecs` merge** for those rows. **Indian** `secondary_region_key` — **no** TMDB `with_original_language` on discover for strip + provider refill; **client** filter by **`getRegionLanguageCodes`** on normalized items (fixes empty/flaky Indian **Prime / Netflix / …**). **`package.json` / `CHANGELOG` / this passdown** updated; push to **`origin`** when ready.
- **Earlier shipped:** **`main` at 6.0.10** — **6.0.6–6.0.7** **Streaming** service **pill** + **6.0.5** discover refill. **6.0.7–6.0.8** **Secondary** + **`with_original_language`**. **6.0.9** — **`SECONDARY_AVAILABILITY_TMDB_REGION` = `US`**. **6.0.10** — secondary refill: **not** global **`showRegionKeys`**; genres until **6.0.11**. **Files:** `src/App.jsx`, etc.
- **Prior (same period):** **6.0.0** **`App.css`**; **6.0.1** secondary **Region** strip load race + **try/catch/finally** on secondary TMDB batch.
- **Prod Supabase (stable note):** hand-pasted SQL may not appear in **`supabase_migrations.schema_migrations`** — verify with **`pg_get_functiondef`** / Dashboard for **`get_circle_rated_strip`**, **`creator_leave_circle`**, etc.
- **Open (unchanged):** **§ Master backlog 4a–4c, 4e**; **4d** last-member **delete / disintegrate** TBD. **Deferred:** scroll-stop **`predict_cached`**. **Next:** **beta** feedback, backlog, **native** / **Realtime** when prioritized.

**Earlier — Last session (2026-04-23)**

- **6.0.0 / 6.0.1** on **`main`**; passdown at that time listed **optional** Region **language** as discussion-only — now **shipped** in **6.0.2–6.0.3**.

**Earlier — Last session (2026-04-22)**

- **5.6.52 — shipped to `main` (commit e.g. `7ae12ad`):** **Creator** can **edit** circle **name**, **description**, and **vibe** — **Circles** list **Edit** + **Circle info**; **`updateCircle`** in **`src/circles.js`**. **No** new migration.
- **5.6.51 / 5.6.50** — see **Changelog**; prod migrations **`20260529120000`**, **`20260528120000`** if using creator leave + strip share ordering.

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
6. **Creator leave / moderation stack:** *Full spec:* **§ Master backlog** **items 4–8 (4a–4e)**. **5.6.51:** creator leave **transfers** when others remain; **solo** still archives. *Still not in app:* **remove member** (4b), **request unpublish** (4c), **4e** grace clock, last-member **delete group** (4d).

**Roadmap (see also `HANDOFF.md`)**

- **Phase D — `profiles.handle`:** search/invite by handle (blocked on schema).
- **Edit circle** — **shipped** (5.6.52); list + info; name / description / vibe.
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
