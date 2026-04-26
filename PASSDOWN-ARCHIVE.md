# Passdown archive (Cinematch)

**Purpose:** Historical narrative cut from **`PASSDOWN-NEXT-CHAT.md`** to keep the live passdown small. **Shipped truth** = **`CHANGELOG.md`** + **`package.json`**. Open this file only when you need old session notes or the long changelog trail.

**Archived from passdown:** 2026-04-26 (slim passdown refactor).

---

## Changelog trail (legacy copy — prefer CHANGELOG.md)

- **6.1.3** — Circle path: **orange strip** wraps full first-rating block (title + chips + **Submit** + **Watchlist**). **6.1.2** — **One** **`.5`** chip (half on chosen **1–9**; toggle off). **6.1.1** — Half row was nine **`.5`** labels (superseded by **6.1.2**). **6.1.0** — **`RatingScoreChips`** (slider replaced); **`detailRateEntry`**; facts-before-Overview layout; **Rate more** Discover-only.
- **6.0.32–6.0.34** — **Rated by** modal: row dividers, top/bottom list rules, **gold** **Close** / **×**; small layout/copy passes. **6.0.30–6.0.31** — title on top, **“Rated by”** orange subline, centered copy. **6.0.29** — **3b** tap pill → **Rated by** modal, **`get_circle_title_publishers`**, migration **`20260602120000_…`**, **`fetchCircleTitlePublishers`** in **`src/circles.js`**. **6.0.28** — **Circle hosts (4a):** `admin` for **2nd/3rd** join; RLS **`is_circle_moderator`**; **Edge** invite fns **1.0.1**; migration **`20260601120000_…`**. **6.0.25** — `mailto` uses **`encodeURIComponent`** (fix **+** in Mail). **6.0.24** — `mailto` “Open in email app”. **6.0.23** — non-user **copy-to-mail**. **6.0.22** — **Circles (master backlog 1):** **Pending invites** in the **main Circles list** (first), **no** slide-down invites panel; **Accept** + **Decline**; solid **`.invite-card--list`**; **at** `CIRCLE_CAP` **no** invite rows + header hint; **unseen** activity on **joined** circle rows = **number in a circle** (not bell); header **bell** = pending count and **scroll** to first invite or hint. `showInvitesPanel` **removed**; `listInvitesShown`, `firstPendingInviteRowRef`, `capPendingInvitesHintRef`. **6.0.21** — **Detail / Where to Watch:** **In Theaters** pool + no streaming → **Google** showtimes search link (`googleTheatricalShowtimesSearchUrl`). **6.0.20** — **In Theaters:** **20** titles max per strip (`IN_THEATERS_PAGE_STRIP_CAP`). **6.0.19** — **In Theaters:** **Popular** strip = **`/trending/movie/week`** (2 pages), **trending order**, same theatrical / language gates as **Now Playing**; **`passesUsTheatricalLimitedWindow`**; catalogue **`mergeInTheatersStripsForCatalogue`**. **6.0.18** — **Main Streaming** page: **Now** and **popular** = **separate** TMDB feeds; cap **25**; stagger **5,10,15,20,25** per row; provider **date** vs **popularity** via `discoverSort`. **6.0.17** — **Secondary** All-services **movies**: widen pool (US flatrate + per-provider). **6.0.16** — **Secondary** Indian All-services: broad TV/movie `discover` + merge. **6.0.15** — **Secondary** **Streaming** strip: **5**-then-stagger **9→20**. **6.0.9** — **Secondary Region:** **`SECONDARY_AVAILABILITY_TMDB_REGION` = US** for theaters, streaming, service discover; **`secondary_region_key`** → language only; removed **`secondaryMarketTmdbRegion`**. **6.0.8** — secondary refill **`with_original_language`**. **6.0.7** — secondary service UI + discover. **6.0.6** — **Streaming** pill row. **6.0.5** — **US** **discover**, **`predict_cached`**. **6.0.4** — service `<select>`.
- **6.0.3** — **Title detail:** **Original language** in **facts** bar (from TMDB detail `original_language` via `detailMeta.languageLabel`). **6.0.2** — **Region (secondary) strip:** **Language** in strip meta (`formatSecondaryRegionStripMeta` / `formatOriginalLanguageDisplay`).
- **6.0.1** — **Region (secondary) strip:** Fast **`secondary_region_key`** from Supabase after bootstrap; **try/catch/finally** for TMDB **Promise.all** so the strip is not left loading or empty until refresh.
- **6.0.0** — **Refactor:** global stylesheet in **`src/App.css`** (imported from **`App.jsx`**); no intended UI or product change. **Major** = structural milestone.
- **5.6.52** — **Circles — edit info:** **Creator** updates **name**, **description**, **vibe** for **active** circles; **Edit** on **Circles list** + **“Edit name & description”** in **Circle info**; **`updateCircle`** in **`src/circles.js`**. **No** migration.
- **5.6.51** — **Creator leave** — if **other members** remain, **`creator_id`** **transfers** to **earliest** `joined_at` (RPC **`creator_leave_circle`**); **solo** creator → **archive** + leave. Migration **`20260529120000_creator_leave_transfer_ownership.sql`**. *(Superseded by **6.1.4+** **`leave_circle`** — see **CHANGELOG**.)*
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

## Recent work (client — `src/App.jsx`) — archive

**Primary file:** `src/App.jsx` + global **`src/App.css`**. **6.1.0–6.1.3** — **`RatingScoreChips`**, **`detailRateEntry`** + **`setDetailRateEntry`** (clear on **`goBack`** / overlay clear / popstate), **`unratedDetailRateInner`**, **`d-rate-title-strip`**; detail **Rate more** pill gated **`detailRateEntry === "discover"`**; facts-before-Overview order. **6.0.29+** — **Rated by** modal (`whoPublishedModal`, **`CircleStripRingCineBelowTitle`** / **`CircleAllTopRatingsLine`** tap, **`openWhoPublishedForCircleRow`**, list row rules, gold **Close**). **6.0.28** — **`isCircleModerator`**: **Edit** on list, **Circle info** (**Edit** + **+ Invite more**) for **creator** + **admin**; **crown** / **hero ★** still **creator-only**; **Circle info** member rows: **admin** = **Member** + **★**. **6.0.22** — **`screen === "circles"`:** **`listInvitesShown`** (empty at cap); main **`circles-list`** = invite rows (**`invite-card--list`**) + **`circlesList`**; **`openInvitesPanel`** scrolls to **`firstPendingInviteRowRef`** or **`capPendingInvitesHintRef`**; joined-row unseen = **`circle-card__unseen`** + **`circleUnseenById`**. **6.0.23+** — invite sheet: **no-account** path **copy-to-mail** + **mailto** (see **CHANGELOG**). **6.0.21** — **Detail `WhereToWatch`:** **Google** showtimes when title is in **`inTheaters` / `inTheatersPopularRanked`** and streaming unavailable. **6.0.20** — **In Theaters:** **`IN_THEATERS_PAGE_STRIP_CAP`** = **20**. **6.0.19** — **`screen === "in-theaters"`**: **`fetchInTheaters`** — **Now** = **`now_playing`** (unchanged); **Popular** = **`/trending/movie/week`** p1–2, **trending order**, **`passesUsTheatricalLimitedWindow`**; **`mergeInTheatersStripsForCatalogue`** when merging into catalogue. **6.0.18** — **`screen === "streaming-page"`** (`PageShell` “Streaming”): **Now** and **What’s popular** are **independent** pools (`streamingMoviesNow` / `Popular`, `streamingTVNow` / `Popular`, or per-provider `streamingPageRefill*Now` / `Popular`); `streamingMovies` / `streamingTV` = **deduped merge** for catalogue + `match`. Helpers: `fetchStreamingPageMoviesNowAllServices`, `…PopularAllServices`, `fetchStreamingPageTvNowAllServices`, `…TvPopularAllServices`; `filterRowsByProfileLanguageCodes`. **`fetchStreamingPageProviderRefillPool`**: `options.discoverSort` **date** \| **popularity**, **90d** window on **movie+date**; cap **`STREAMING_PAGE_STRIP_CAP` (25)**. Stagger: **`streamingPageNowDisplayLen`** and **`streamingPagePopularDisplayLen`**; refs **`streamingPageNowRevealSigRef`**, **`streamingPagePopularRevealSigRef`**. **Removed** `fetchStreamingMoviesOnly` / `fetchStreamingTVOnly` (replaced by the new helpers + merge). **6.0.1** — secondary **Region** (`screen === "secondary-region"`): reliable strip fetch. **6.0.2** — Region strip: **`formatSecondaryRegionStripMeta`**. **6.0.3** — **Detail** `languageLabel`. **6.0.4–6.0.5** — **`streaming-page`:** service **`<select>`**; `fetchStreamingPageProviderRefillPool` + `streamingPageRefill*`. **6.0.7–6.0.8** — secondary **Streaming** service + discover. **6.0.9** — secondary **Region** TMDB **US** + **`getRegionLanguageCodes`**. **6.0.11–6.0.14** / **6.0.16–6.0.17** — secondary All-services / Indian / movie widen — see **CHANGELOG**.

### Bottom navigation & Watchlist

- **`BottomNav`:** Mood · Watchlist · Profile; **active** = circular highlight; no community/ratings counts in bar.
- **`navigatePrimarySection`:** handles **`watchlist`** (sets **`navTab`** + **`screen`**).
- **`goBack`:** if **`navTab === "watchlist"`**, restores **`screen`** to **`watchlist`**.
- **`clearDetailOverlayToNavigate`** before leaving detail via Mood / Watchlist / Profile.
- **Watchlist reorder:** **`swapWatchlistOrder(id, "up" | "down")`** (TEMP swap); **`moveWatchlistItemToTop`** / **`moveWatchlistItemToBottom`**; **`buildWatchlistFromRows`**, **`watchlistRowKeys`**; **`setInviteToast`** is not used for reorder errors (see **`console.warn`**). **5.6.24:** no `.select()` gating on success.

### Circles

- **Circle activity (5.6.33–5.6.37 + 6.0.22 list):** **`circle_member_last_seen`** (Supabase) + RPCs; **`fetchMyCircleUnseenActivity`**, **`markCircleLastSeen`**, **`getCircleOthersActivityWatermark`** in **`src/circles.js`**. **`App.jsx`:** `circleUnseenById` / **Circles list** = **unseen count in a round badge** (**`circle-card__unseen`**, 6.0.22); **header** **bell** = **pending invite** count + **scroll to** first invite; `checkRemoteCircleNewActivity` + 10s interval (ref) + **visibility** / **focus** / **pageshow**; **“New”** strip tile (left of **+**) + All/Top compact row; `mark` on open circle. **Assumed use** (short sessions; leave/resume may refetch) — see **`HANDOFF.md`** § **Circles activity — assumed use**.
- **6.0.23–6.0.34** — **Copy-to-mail** + **hosts (admin)** + **3b** **`fetchCircleTitlePublishers`**, **`isCircleModerator`**, `buildCopyToMailCircleInviteText`, `buildCopyToMailCircleInviteMailto` in **`src/circles.js`**; Edge **invite** fns see **CHANGELOG**.
- **5.6.49 — Circle score stars:** **`CirclePillStarGlyph`** + shared path constant; **orange** circle + **gold** Cinemastro use the same SVG (**`currentColor`**), **16×16** Recent under-title pill, **13×13** All/Top list — replaces mismatched **emoji** / `em` sizing. **`CircleStripRingCineBelowTitle`**, **`CircleAllTopRatingsLine`** / **`CircleGroupScoreIcon`** (`variant="list"`).
- **5.6.50 — Forward** (strip ⋯): **`addRatingCircleShares`**; **Recent** strip sort uses **share** `created_at` (DB migration). **5.6.51 — Creator leave:** RPC **`creator_leave_circle`** (superseded by **`leave_circle`** in **6.1.4+**). **5.6.52 — Edit circle:** **`updateCircle`**; list card **Edit** + **Circle info** “Edit name & description”; **`fetchMyCircles`** includes **`joined_at`** on members.
- **Circle detail:** Ratings **Recent / All / Top**; feeds = **`ratings` ∩ `rating_circle_shares`** for that circle. **`fetchCircleRatedTitles`** + Edge **`get-circle-rated-titles`**. Migrations: **`20260524120000_rating_circle_shares.sql`**, **`20260522120000_...`**, strip **`20260506120000_...`**, etc.
- **Publish:** first-time rating from detail → modal (skip OK); from circle flow, defaults include that circle. **Publish to circles…** on detail when already rated.
- **Recent strip:** Titles **oldest → newest** (L→R); **long-press** (~520ms) or **⋯** → Details, Rate/Rerate, watchlist add/remove (**`toggleWatchlist`** + **`skipGoBack`**), Forward (**`publishRatingModal` manage**), Remove from circle (**`unpublishTitleFromCircleStrip`**); **Earlier** (paginate) on the **left**; **+** in a **76px** poster band; **center-on-land**; **faded ←** when pannable; optional **New activity** tile **left of +** when the activity watermark is newer than the last loaded baseline (5.6.33+).
- **All / Top:** **List** (like Watchlist): **title · year** on line 1; line 2 **Circle** / **You** / **Cinemastro** with **⭐** (omit if missing); **Circle** may show **(n)** after the score when **`memberCount > 2`** and **`distinct_circle_raters`**. **`CircleAllTopRatingsLine`**, **`formatCircleListYear`** in **`App.jsx`**. **Recent** strip cards still use **`formatCircleSublineTypeYearCine`** (centered poster row).
- **+** or empty state → **Discover**; **`rateTitleReturnCircleIdRef`** / **`detailReturnScreenRef`** / **`detailRateEntry`** for return + detail CTAs. **Shipped (6.1.x):** **Rate this** block after **facts**, before **Overview**; **Rate more** pill **Discover-only**; circle first-rating UI in **`d-rate-title-strip`**.

### Title detail (basics)

- Backdrop **`object-position: 30% top`**; mobile **`.d-title`** DM Sans; **`BottomNav`** inside **`.detail`**. **6.0.3+** — **facts** bar: optional **`languageLabel`** (TMDB **`original_language`**) with certification / US release / runtime.

### PWA (5.6.29)

- **Files:** `index.html` (manifest + metas + **`apple-touch-icon.png`**), `public/site.webmanifest`, `public/cinemastro-pwa-icon.svg` (inlined wordmark), `public/apple-touch-icon.png`, `public/pwa-icon-192.png`, `scripts/generate-pwa-touch-icons.mjs`.

---

## Recent work (`src/circles.js`) — archive

- **`fetchCircleRatedTitles({ circleId, limit, offset, view })`** — Edge + RPC fallbacks for strip/grids.
- **6.0.29** — **`fetchCircleTitlePublishers`** → RPC **`get_circle_title_publishers`** (3b / **Rated by** modal).
- **6.0.28** — **`isCircleModerator`**, **`currentUserRole`** may return **`"admin"`**; **`updateCircle`** still client-side for active circles; RLS enforces **moderator** on **circles** update.
- **5.6.52 — `updateCircle`**, **5.6.50 — `addRatingCircleShares`**, **`fetchMyCircles`** with **`joined_at`** on **`circle_members`**.
- **Circle activity (5.6.33+):** **`fetchMyCircleUnseenActivity`**, **`markCircleLastSeen`**, **`getCircleOthersActivityWatermark`** (Supabase RPCs; see migration **`20260527120000_circle_member_last_seen.sql`**).

---

## Neighbor CF + cron (archive)

- **Client:** **`openDetail`** uses authed user for CF; **`runComputeNeighborsNow`** after ratings (debounced).
- **Edge:** **`compute-neighbors`**; **`commit_user_neighbors_swap`**; **`config.toml`** **`verify_jwt = false`** for cron **`pg_net`**.
- **Seed:** **`profiles.name`** prefix **`seed`** (case-insensitive); **`mode: "all"`** skips as subjects.
- **Cron (example):** staggered **`compute-neighbors-w00`…`** Sunday UTC — scale **`jobs × limit`** with MAU. **Detail:** **`COMPUTE-NEIGHBORS-CRON.md`**.

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

**Deferred:** **Do not** implement **scroll-stop** / idle **`predict_cached`** for only **visible** strip tiles **yet** — revisit **§6b** in passdown **To be decided later** when product wants it.

---

## Circle “updates” after Phase A (5.6.33) — archive

**Phase A (5.6.33+) shipped on web** — `circle_member_last_seen`, **`get_my_circle_unseen_counts`**, **`mark_circle_last_seen`**, **`get_circle_others_activity_watermark`**, `src/circles.js` helpers, **`App.jsx`**: Circles list **🔔 + count** (others’ **`rating_circle_shares`** with `created_at` \> your **last_seen** for that circle); in-circle **“New activity”** as a **76px** strip tile (**Recent**, immediately **left of +**) + **Refresh**; compact line under **All/Top** tabs when applicable; **~10s** visible-document watermark poll (not a full silent strip rewrite by itself; see **assumed use** in **`HANDOFF.md`**). Badges: **login**, **tab focus** / **visibility** / **pageshow**, and **navigate to Circles list**. (Body-level pull-to-refresh was **removed** in 5.6.36 — it misfired on mobile scroll.)

**Still out of scope / next steps:**

- **Native (Phase A continuation):** **APNs / FCM** when there is a native app — not part of 5.6.33.
- **Web Phase B (optional):** **Realtime** or light polling for power users; **Web Push** only if product wants (heavy / iOS limits).
- **Apply migration on prod:** **`20260527120000_circle_member_last_seen.sql`** if missing.

---

## Open / follow-ups — archived session notes

*(Bullets below were moved from **`PASSDOWN-NEXT-CHAT.md`**; newest passdown keeps only the last one or two sessions.)*

**Last session (2026-04-29) — backlog reorg**

- **Last note:** User asked to **keep** only legacy items **§8, §9, §17–§20, §21–§30, §36** in the **active** queue, **renamed** to **§ Prioritized backlog (next builds)**; **move** all other former master-list items to **§ To be decided later**. **§31–§35** (ops/docs/lint) are **parked** with the rest.

**Last session (2026-04-28) — passdown in git + 6.1.x shipped**

- **Last note:** User asked to **update `PASSDOWN-NEXT-CHAT.md` for the next chat** and to **ensure the passdown is in git** (commit + push). Prior thread shipped **6.1.0–6.1.3** to **`main`** (**`0f46072`**): **score chips**, **Rate this / Rate more** layout + gating, single **`.5`** chip, orange **`d-rate-title-strip`** around full circle first-rating block; **Vercel** from **`main`**. **Next Circles build:** **4b–4e** (§ **9–12** moderation). **Ops:** prod migrations if missing (**`20260602120000_…`**, **`20260601120000_…`**); **cron/MAU** → **`COMPUTE-NEIGHBORS-CRON.md`**.
- **Shipped:** **`main` @ 6.1.3** (see **`package.json`** / **`CHANGELOG.md`**).
- **Next:** **4b–4e** moderation / lifecycle; **Deferred** strip **`predict_cached`**.

**Earlier — Last session (2026-04-26) — handoff (6.0.34 on `main`, 3b + workflow)**

- **Last note:** Passdown workflow + **3b** / **6.0.34** context; next was **4** & **5** (now **shipped** in **6.1.x**).
- **Shipped (then):** **`f2ca04c`** @ **6.0.34**.

**Earlier — Last session (2026-04-26) — passdown (6.0.22–6.0.28 narrative)**

- **Last note:** The user asked to **update** **`PASSDOWN-NEXT-CHAT.md`** for the next session and to report **what they should tell the next chat**.
- **Shipped (then):** **`main` @ 6.0.28** (e.g. **`d25e796`**) — **6.0.23–6.0.28** copy-mail, **4a** hosts; next was **3b** at the time.

**Earlier — Last session (2026-04-27) — 6.0.22 passdown + git push**

- **Last note:** After **`6.0.22`** shipped (**`ea7a9ee`**) the user asked to **update** **`PASSDOWN-NEXT-CHAT.md`** for the release and **push** the passdown to **`git`**.
- **Shipped (then):** **`main` @ 6.0.22**.

**Earlier — Last session (2026-04-27) — user starting next chat (handoff, pre-6.0.22 passdown commit)**

- User **refreshed** handoff to open a **fresh chat**; **no** app code in that thread.

**Earlier — Last session (2026-04-26) — passdown-only discussion**

- **Rating / detail UX** filed as **main list 4–5**; **invite path** cross-refs **§ item 18**.

**Earlier — Last session (2026-04-25) — for the next chat**

- **Circles (discussion only):** invite list / activity chrome; **§ item 2** copy-to-mail. **User chose** “**A**” for **In Theaters** **Popular** row (**6.0.19**).

**Earlier — Last session (2026-04-25) — passdown-only (pre-6.0.19 narrative)**

- **User asked** to **update this passdown** after **6.0.18**.

**Earlier — Last session (2026-04-24)**

- **Secondary All-services thin pool** — addressed in **6.0.16** / **6.0.17**.

**Earlier — Last session (2026-04-23)**

- **6.0.0 / 6.0.1** on **`main`**.

**Earlier — Last session (2026-04-22)**

- **5.6.52** edit circle; **5.6.51 / 5.6.50** — see **Changelog**.

**Shipped 2026-04-22 (bullets)**

- **5.6.33** Circles activity Phase A; **5.6.32** posters; **5.6.31** lazy; **5.6.30** header; **5.6.29** PWA; **5.6.28** PWA iOS; **5.6.27** PWA install.

**Last session backlog (2026-04-22)**

1. **Circle activity Phase A:** **shipped 5.6.33**. **Prod:** migration **`20260527120000_circle_member_last_seen.sql`**.

**Earlier backlog (2026-04-21)**

1. **Circle feeds — live / multi-user:** Phase A done; native push + Realtime remain.
2. **Circles list — “unseen” activity:** **shipped** 5.6.33.
3. **Invites at max circles:** **`auto_declined`** today.
4. **Prod Supabase:** **`20260526120000_watchlist_rls_update_own.sql`** if needed.
5. **Docs:** sync **`package.json` / `CHANGELOG` / passdown**.
6. **Moderation stack:** **4b–4e**; **4a** shipped 6.0.28.

**Roadmap / speed / ops (archived duplicates)**

- See **`HANDOFF.md`** and **§ Prioritized backlog** in **`PASSDOWN-NEXT-CHAT.md`** for current queues. Historical performance bullets (code-split, fetch waterfall, etc.) match **§21–30** in passdown.

---

*Append-only is OK; trim this file only if you are sure nothing unique remains.*
