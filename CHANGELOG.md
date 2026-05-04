# Changelog

## 7.0.45

- **Circles — share invite link:** `navigator.share` no longer passes a separate `url` alongside `text` (many apps only received the URL). Share payload is **`title` + `text`** with the link inlined in `text`.

## 7.0.44

- **Circles — share invite link:** Invite sheet adds **Search by email**, **Or share a link**, and **Share invite link** (Edge **`create-circle-invite-link`** `1.0.0`) — native share with `/join/<token>` (URL from **`VITE_PUBLIC_SITE_URL`** / **`window.location.origin`**). **`/join/:token`** route: **`preview-circle-invite-link`** `1.0.0` (anon; **`verify_jwt = false`** in **`supabase/config.toml`**), **`pendingCircleInviteToken`** through auth, **`claim-circle-invite-token`** `1.0.0`, Join / Decline via existing accept/decline. Removed copy-to-mail fallback when email has no account; **`send-circle-invite`** `1.0.3` suggests share link. Migration **`20260613120000_circle_invite_share_links.sql`**: nullable **`invited_user_id`**, **`invite_token`**, **`invite_email`**, **`expires_at`**, status **`revoked`**, pending-invite labels exclude unclaimed link rows, recipient **DELETE** own declined rows. **Apply migration; deploy new Edge functions + redeploy `send-circle-invite`.**
- **Circles — hosts:** Client **`isCircleModerator`** and **`send-circle-invite`** allow **creator** and **admin** (creators can invite).

## 7.0.43

- **Circles — last member leave:** **`leave_circle`** deleted **`circles`** under the same RLS as the signed-in user; **`creator can delete own circle`** requires **`is_circle_moderator`** ( **`admin`** ). A **sole** **`member`** row led to **0 rows deleted** and no error, so the empty circle could remain. Migration **`20260612120000_leave_circle_delete_bypass_rls.sql`** sets **`set row_security = off`** on the RPC and asserts delete / membership row counts. **Apply on each hosted DB.**

## 7.0.42

- **Title detail — clear rating:** While changing a saved score, **Save new**, **Cancel**, and a red **Clear rating** control. **Clear rating** asks for confirmation: the title is removed from **all circles** it was published to and the global rating is deleted. Migration **`20260611120000_ratings_rls_delete_own.sql`** adds **`ratings` DELETE** for **`authenticated`** (own rows only); apply on each hosted DB.

## 7.0.41

- **Auth — display name + email confirm:** Migration **`20260610120000_profiles_sync_display_name_from_auth_users.sql`** — **`AFTER INSERT OR UPDATE OF raw_user_meta_data`** on **`auth.users`** upserts **`public.profiles.name`** from **`raw_user_meta_data->>'name'`** (fallback email local-part / **`User`**); backfills existing rows where meta had a name but **`profiles.name`** was blank. **Apply on each env.** Client **`signUp`**: **`profiles.update`** for name runs **only when `data.session`** exists (avoids pointless RLS failures when confirmation is required).

## 7.0.40

- **Profile — display name:** Removed the Display name block from Settings. Tap the **header name** to open the **Edit display name** sheet (same save flow as before).

## 7.0.39

- **Profile — display name settings UX:** Collapsed row shows current name + **Edit display name**; editing opens the shared bottom sheet (**Save** / **Cancel**) instead of an always-visible field. Validation errors appear in the sheet only.

## 7.0.38

- **Profile — display name:** Settings card adds **Display name** field (**Save display name**) — updates **`profiles.name`** and **`auth.updateUser({ data: { name } })`** so avatars and metadata stay aligned. Profile header and menu initial use **`profiles.name`** when present (then metadata, then email local-part).

## 7.0.37

- **Auth — display name required on sign-up:** Validate trimmed name (**≥ `CIRCLE_NAME_MIN`**, **≤ 120** chars) before **`signUp`**; **`profiles`** update uses the same trimmed value. Sign-up field **`required`** + **`minLength`** / **`maxLength`** for browser hints.

## 7.0.36

- **Onboarding / Rate more — poster on mobile:** **`.onboarding .card-poster`** uses **~2:3** aspect, **`object-fit: contain`**, and a **shorter height cap** (**`min(22vh, 168px)`** base; slightly larger at **600px+** / **900px+**) so the image reads as a **poster tile**, not a wide hero, and **`RatingScoreChips`** stay visually primary on small viewports.

## 7.0.35

- **Bottom nav — Circles:** First slot opens **Circles** (same routing as drawer / primary **`navigatePrimarySection('circles')`**). **`BottomNavCirclesRingsIcon`**: three **interlocking ring** strokes in wordmark **`#f0ebe0`** / **`#8B1A1A`** / **`#e8c96a`**, **22×22** viewBox aligned with **`BottomNavListIcon`**. Active while **`circles`** or **`circle-detail`**.

## 7.0.34

- **Circles — globally unique names (active):** Database partial unique index on **`lower(trim(name))`** for **`status = 'active'`** — migration **`20260609120000_circles_active_name_unique_ci.sql`**. Matches client trim + case-insensitive collisions; **`archived`** rows are excluded so legacy data stays valid. **`createCircle`** / **`updateCircle`** map Postgres **`23505`** to **That circle name is already taken.** See **`src/circles.js`**.

## 7.0.33

- **About top bar:** **`users:`** / **`ratings:`** site stats move to the **right** of the legal top bar (trailing column), **About** title stays centered.

## 7.0.32

- **Profile & About — community stats:** **`get_public_site_stats`** counts shown as **`users:`** / **`ratings:`** (same compact format as the nav) on **Profile** under personal stat chips, and beside the **About** top-bar title. **`formatPublicStat`** moved to **`src/formatPublicStat.js`**; **`LegalTopBar`** accepts optional **`titleAside`**.

## 7.0.31

- **Help — Add to Home Screen:** Fourth post-onboarding tour card (**narrow viewports** only, ≤1023px at tour open) explains **Share → Add to Home Screen** (iOS Safari) and **Chrome install / add** (Android). **`Help & how to use`** gains a full section on **Add to Home Screen** (mobile & tablet), **offline expectations**, and **iOS vs Android** steps. See **`src/helpPage.jsx`**.

## 7.0.30

- **Pulse — shared daily cache:** Trending + popular strips are **one catalog per UTC calendar day** for all users. **`pulse_catalog_daily`** (migration **`20260608120000_pulse_catalog_daily.sql`**) holds JSON rows; first visit after read miss invokes Edge **`pulse-catalog`** (**`1.0.0`**) to fetch TMDB and **upsert**; further visits **read** only. **Same-day** return to Pulse skips skeleton + refetch (**`pulseLoadedUtcDateRef`**). **Apply** the migration; set Edge secret **`TMDB_READ_ACCESS_TOKEN`**; **deploy** **`pulse-catalog`**. If DB/Edge is unavailable, client falls back to existing **`fetchPulseTrendingCatalog`** / **`fetchPulsePopularCatalog`**.

## 7.0.29

- **Performance — circles (step 5, partial):** **“New activity”** watermark poll uses **tiered backoff** while the tab is visible — **15s** → **45s** → **60s** when **`get_circle_others_activity_watermark`** returns the same timestamp as the prior poll; any change resets to **15s**. Focus / visibility / **`pageshow`** checks unchanged. Constants: **`CIRCLE_WATERMARK_POLL_MS`** in **`App.jsx`**. See **`docs/PERFORMANCE-CIRCLE-CACHE.md`**.

## 7.0.28

- **Performance — circles (step 4):** **All** / **Top** grids use merged session cache + background reconcile (`peekCircleGridMergedCache`, `setCircleGridMergedCache`, `invalidateCircleGridCaches`); instant paint when revisiting tabs; **`fingerprintRecentStripPayload`** gates **`setCircles*`** updates; **`CIRCLE_GRID_MERGED_RECACHE_MAX`** (**80**) caps silent All prefetch width. **`invalidateCircleRecentStripCache`** + grid invalidation run when **`circleRatedRefreshKey`** bumps. See **`docs/PERFORMANCE-CIRCLE-CACHE.md`**.

## 7.0.27

- **Performance — circles (step 3):** **`fetchMyCircles`** runs **silent** when returning to **`screen === "circles"`** (no list loading spinner once already loaded); responses are discarded if a **newer** fetch started (**nonce ref**); **`setCirclesList`** only when **`fingerprintMyCirclesList`** changes (**`src/myCirclesListFingerprint.js`**). Initial sign-in load remains a normal foreground refresh. See **`docs/PERFORMANCE-CIRCLE-CACHE.md`**.

## 7.0.26

- **Performance — circles (step 2):** Session **TMDB hydrate cache** for titles missing from the main catalogue (**`peekCircleTmdbHydrateCache`**, **`mergeCircleTmdbHydrateCache`**) — revisit circle detail reuses **`/movie` / `/tv`** payloads instead of fetching again (**`clearCircleTmdbHydrateSessionCache`** on sign-out). See **`docs/PERFORMANCE-CIRCLE-CACHE.md`**.

## 7.0.25

- **Performance — circles (step 1):** Session **stale-while-revalidate** for **circle detail** (`fetchCircleDetail`) and the **recent** rated strip **first page** (`fetchCircleRatedTitles` offset 0). Cached payloads render immediately when revisiting a circle; background refetches run and the UI updates **only when** fingerprints differ (**`src/circleDetailSessionCache.js`**). Recent-strip cache resets when **`circleRatedRefreshKey`** bumps (publish / unpublish flows); caches clear on **sign-out** and when **leaving** a circle. Staged backlog: **`docs/PERFORMANCE-CIRCLE-CACHE.md`**.

## 7.0.24

- **Layout — primary nav:** Scroll offset under the fixed bar uses **`--primary-nav-overlay-clearance`** (**72px** mobile, **82px** from **900px**, **84px** from **1200px**) so **logo + Beta** does not crowd the first row of content. Nav wordmark cluster gets **`min-width:0`**, **`nowrap`**, and **`max-height`** so the row stays stable.
- **Circles — detail header:** **WhatsApp-style** row: **back** | **left-aligned** gold initials chip (**36px**, smaller than the **40px** back control) + **title** and **member count** stacked and **left-aligned** (ellipsis on long names). Slightly more padding on the blur bar; desktop gutters unchanged intent.

## 7.0.23

- **Help tour:** Show the three-card Circles / Secondary-region tour whenever **`help_post_onboarding_seen`** is missing and the account has **finished onboarding** (metadata flag or any saved ratings), on first **Circles** landing — including **returning logins** (**reverts 7.0.22’s session-only gate**).

## 7.0.22

- **Help tour:** Post-onboarding cards no longer open for **returning logins** that simply lack `help_post_onboarding_seen`. The tour is **queued only when onboarding is completed in-session** (finishing the onboarding / “rate more” funnel without a prediction-specific context), then shown on the next **Circles** landing.

## 7.0.21

- **Help:** One-time **post-onboarding tour** (three cards: Circles ×2, Secondary region) opens on **Circles** when onboarding is finished and **`help_post_onboarding_seen`** is unset (persisted on dismiss/skip/full help via **`supabase.auth.updateUser`**). Returning users stay eligible until marked.
- **Help:** **`/help`** screen — **Help & how to use** with sections (Pulse, In theaters, Streaming, Secondary region, Watchlist, Your picks & Discover, Circles, Profile), **ratings colors** swatches, strip-badge notes. Linked from **About**, **Profile → Help** (avatar and bottom-nav menus), and the tour.

## 7.0.20

- **Circles:** Non-user **copy-to-mail** invite link no longer hardcodes the old staging host. **`getCopyToMailCinemastroSiteUrl()`** uses **`VITE_PUBLIC_SITE_URL`** if set, else the current **`window.location.origin`** (so prod vs staging Vercel URLs match the app), else **`https://www.cinemastro.com/`**.

## 7.0.19

- **Edge (`compute-neighbors` 1.0.1):** **`fetchAllRealUserIds`** now pages **`profiles`** with **`.order("id")`** so **`mode: "all"`** `totalEligible` matches DB reality (unordered PostgREST ranges could skip/overlap rows). **`isSeedSubject`** / in-loop checks treat **null `name`** like non-seed (aligns with SQL `coalesce`).

## 7.0.18

- **Product:** Public **Beta** labeling — gold pill next to the header wordmark; **About** and **Profile** version lines; **`index.html`** title / **`application-name`**; PWA **`site.webmanifest`** name. Toggle via **`src/productLabels.js`** **`PUBLIC_BETA_LABEL`** for GA.

## 7.0.17

- **Legal:** **Terms of Use** — completed truncated sections **23–26** (electronic signatures, California notice, miscellaneous, contact); added **§27 TMDB API Usage** (TMDB obligations, restrictions, rate-limit reference). Markdown source: **`Policies/TERMS_OF_SERVICE.md`** (**Last updated April 29, 2026**).

## 7.0.16

- **About:** Dedicated **`/about`** screen (**`aboutPage.jsx`**) — logo, tagline **Your Personal Film Maestro**, **semver**, intro + site link; **Legal & compliance** (Privacy / Terms buttons, US-only notice, **support@cinemastro.com**); **Credits** (copyright, TMDB sentence + logo). Lazy-loaded beside Privacy/Terms.
- **Nav:** Primary **hamburger / horizontal nav** includes **About** → opens **`/about`** (existing SPA routing).
- **Layout:** Removed **`AppFooter`** from all main shells — legal/TMDB/US messaging lives on About; bottom chrome stays the tab bar only.

## 7.0.15

- **Layout:** Footer stays at the **end of page flow** (not fixed). **Bottom nav** `z-index: 50`; **footer** `position: relative` + `z-index: 10` so the bar paints **above** the footer when they overlap — scroll to bring footer links fully **above** the nav (existing scroll shells keep bottom padding for clearance).

## 7.0.14

- **Footer:** **Site** URL **`https://cinemastro.com`**; **Contact** → **`mailto:support@cinemastro.com`**. **US-only** availability notice. **TMDB** attribution uses official wordmark (**`/public/tmdb-attribution-logo.svg`**, from TMDB branding assets) linking to **themoviedb.org**; sentence updated to match API attribution wording.

## 7.0.13

- **Footer:** Copyright **©** (current calendar year) **Cinemastro, LLC. All rights reserved.**

## 7.0.12

- **Legal:** **Privacy** and **Terms** screens render **`Policies/PRIVACY_POLICY.md`** and **`Policies/TERMS_OF_SERVICE.md`** via **`markdown-it`** + **`markdown-it-anchor`** (lazy chunk **`legalMarkdown.js`**). About remains inline placeholder copy.

## 7.0.11

- **Legal URLs:** Footer links use **`/privacy`**, **`/terms`**, **`/about`** (SPA **`history`** matches path); legacy **`?legal=`** deep links still hydrate. **`vercel.json`** rewrites those paths to **`index.html`**; dev server middleware mirrors behavior.

## 7.0.10

- **Circles list:** **Last activity** time is **latest share in the circle by anyone** (including you), WhatsApp-style. **Unseen** count is still **other members only** since **last seen**. **DB:** `get_my_circle_unseen_counts` returns **`latest_share_at`** (apply migration **`20260605120000_get_my_circle_unseen_counts_latest_share_at.sql`** on prod).

## 7.0.9

- **Circles list:** **Unseen** count badge uses **brand gold** (`--vibe-accent` / `#e8c96a`) with a **dark** numeral instead of WhatsApp green.
- **Circles list:** **Last activity** for days before **Yesterday** is shown as **DD/MM/YY** (e.g. `28/04/26`).

## 7.0.8

- **Circles list:** **Last activity** time sits in a **right trail column** with the **unseen** badge below it so the timestamp stays **right-aligned** with other cards (no left shift when the green badge is present).

## 7.0.7

- **Circles list:** Same row as the circle name, show **latest other-member share** time: **today** → local time; **yesterday** → `Yesterday`; **2–6 days ago** → weekday (`Monday`, …); **older** → short date with weekday (adds year when not this year). Uses existing `latest_others_share_at` from **`get_my_circle_unseen_counts`**.

## 7.0.6

- **Circles list:** **New activity** badge is a solid **WhatsApp-style green** disc (`#25d366`) with **black** count text, centered in the trailing column.

## 7.0.5

- **Circles list:** Removed **Edit** on each card (edit stays under **Circle info**). **New activity** count moves to the **right** (former Edit slot) with a **green** pill (`#4ade80` on a green-tinted background).

## 7.0.4

- **Your Picks:** **Refresh** in the **For you** header uses **gold** (`#e8c96a`), stays **12px** uppercase like other **`.section-meta`** lines, and is a proper **button** (keyboard + `aria-label`).

## 7.0.3

- **Refactor:** Secondary Region screen markup moved to **`src/pages/SecondaryRegionPage.jsx`** (behavior unchanged; fetch, refill, stagger, and match stay in `App.jsx`).

## 7.0.2

- **Refactor:** In Theaters screen markup moved to **`src/pages/InTheatersPage.jsx`** (behavior unchanged).

## 7.0.1

- **Refactor:** Pulse screen markup moved to **`src/pages/PulsePage.jsx`** (behavior unchanged).

## 7.0.0

- **Semver:** Major bump to **7.0.0** (7.x release line).

## 6.1.13

- **Secondary Region (Indian) → Streaming:** Per-service discover and All-services shallow widen use **US** `watch_region` for **Netflix, Prime Video, and Hulu** (restores Hulu and US-catalog density); **IN** remains for JioHotstar, Sony Liv, Zee5, Sun Nxt, and Eros Now.

## 6.1.12

- **Secondary Region (Indian) → Streaming:** Service picker replaces Disney+–AMC+ with **JioHotstar**, **Sony Liv**, **Zee5**, **Sun Nxt**, and **Eros Now** (keeps Netflix, Prime Video, Hulu). Per-service and shallow widen discover use TMDB **`watch_region=IN`** for those catalogs. Primary Streaming and profile “Where you watch” unchanged.

## 6.1.11

- **Detail — Where to Watch:** **Find showtimes near you (Google)** also appears for titles that appear in the **secondary region → In Theaters** strip (same behavior as primary US theaters).

## 6.1.10

- **Streaming page (All services):** **Now** / **Popular** stagger completes to the full cap after **detail → back** (stagger effect no longer re-runs when the *other* of movies vs TV finishes loading).

## 6.1.9

- **Streaming page (All services):** After opening a title and going back, **Now** / **Popular** strips show again (reset stagger dedupe when not on per-service refill).

## 6.1.8

- **Streaming page:** **Genres** is back on the same row as **Series** / **Movies**, separated by the usual vertical rule; only the **All services + Series + Movies** segment scrolls horizontally so the genre panel still opens fully.

## 6.1.7

- **Streaming page — genre filter:** By default, strips hide **animation**, **documentary**, **reality**, and **kids** (TMDB genre ids **16**, **99**, **10764**, **10762**); **family** titles are **not** excluded. A **Genres** pill opens a panel with checkboxes to **include** any of those types. Applies to **All services** and **per-service** discover on the main Streaming page only (other screens keep the previous animation-only rule unless they use the shared provider refill with default options).

## 6.1.6

- **Circles — Circle info modal:** Smaller centered **Circle info** title; larger centered circle name; close control top-right. Roster (members + pending invites) ends with a **divider**; **+ Invite more** first as **gold fill** CTA, then a line, then **Edit name & description**; **Leave circle** last, red, centered with other actions.

## 6.1.5

- **Circles — Circle info (hosts):** While the circle is **active**, **hosts** see an **Invites pending** section: **one line per** in-app **`pending`** invite, with **display name** from **`profiles.name`** or **email** from **`auth.users`** when the name is empty. No inviter shown. **DB:** apply **`20260604120000_get_circle_pending_invite_labels.sql`** (RPC **`get_circle_pending_invite_labels`**).

## 6.1.4

- **Circles — admin-only hosts & leave (4d):** Membership roles are **`admin`** (host) and **`member`** only; the **`creator`** role is removed. **Hosts** are the **three most senior** members by **`joined_at`**, or **everyone** if the circle has **fewer than three** members. **`circles.creator_id`** stays set when the circle is created (RLS / inserts) and is **not** updated when people leave.
- **Leave:** All members use RPC **`leave_circle`**. If **more than one** member remains, the leaver’s row is removed (their **`rating_circle_shares`** for that circle are cleared as today). If the leaver is the **last member**, the **circle row is deleted** (**CASCADE**: invites, all shares for that circle, members, last-seen rows). **Pending invites** and **group** shares are removed with the circle.
- **UI:** No crown / “creator” star; circle info lists **Host** (with ★) vs **Member**. Leave confirmation copy matches delete-vs-stay behavior.
- **DB:** Apply **`20260603120000_leave_circle_admin_only.sql`**. **`creator_leave_circle`** is dropped — clients must call **`leave_circle`**. **Edge:** `send-circle-invite` / `accept-circle-invite` **1.0.2** (host = **`admin`** only); redeploy after migration.

## 6.1.3

- **Detail (circle path):** The faint orange **Rate this title** container now wraps the **whole** first-rating block — heading, score chips, **Submit Rating**, and **+ Watchlist** / saved state.

## 6.1.2

- **Score chips:** Second row is a **single** **.5** chip. Pick a **whole** score **1–10**, then **.5** adds a half for **1–9** only (**7** → **7.5**; **10** cannot use **.5**). Tap **.5** again to return to the integer. **.5** stays disabled until a whole score is selected.

## 6.1.1

- **Score chips:** Second row shows **.5** only (nine chips aligned under **1–9**); values **1.5–9.5** unchanged, with full score in **`aria-label`**. Integer row stays **1–10** on a matching **10-column** grid.
- **Detail (circle path):** **Rate this title** sits in a **faint orange** inset strip (circle accent).

## 6.1.0

- **Rating input — score chips (backlog §5):** Replace the **1–10 / 0.5** range slider with two rows — integers **1–10**, then half steps **1.5–9.5** only (**no** 10.5). Composed score above the rows; **—** until the user taps a chip. Used on **onboarding**, **Rate similar titles**, and **title detail** (new rating + change rating).
- **Detail — Rate this / Rate more (backlog §4):** **Rate this title** label and rating block sit **after** the **facts** row and **before** **Overview** / tagline. **Rate more** / **Rate to refine** (prediction refine flow) shows **only** when detail was opened from **Discover** without the circle-return path; **circle** entry (circle detail or Discover via **+** / return-to-circle) no longer shows that pill on the same visit. Other entry paths keep rating chips but no refine pill.

## 6.0.34

- **Circles — rated in group modal:** **Close** uses a **gold fill** (`#e8c96a` on dark text); header **×** uses **gold** instead of gray.

## 6.0.33

- **Circles — rated in group list:** A **top rule** on the list (line above the first rater) and a **bottom rule** on the last row (line under the last rater), in addition to **between-row** lines.

## 6.0.32

- **Circles — rated in group modal:** Multiple raters use **row dividers** (horizontal lines) between **name** and **score** rows.

## 6.0.31

- **Circles — rated in group modal:** **Title** is the **top** line; **“Rated by”** is the **next** line in smaller type (**13px**), **circle orange** (`#f97316`).

## 6.0.30

- **Circles — rated in group:** The members modal uses the heading **Rated by** (centered), a **second line** with the **title name only**, and a **top-right** close control; a11y and empty state copy updated to match.

## 6.0.29

- **Circles — who published (3b):** On **Recent / All / Top** circle surfaces, tap the under-title **Circle + Cinemastro** score row (or the same pair on **All/Top** list rows) to open a **centered** modal: **names and scores** for members who **published** this title to the group (from **`rating_circle_shares`** + global ratings), **Close** and backdrop. No title line in the dialog (context is the row you tapped). **Apply** migration **`20260602120000_get_circle_title_publishers.sql`** on the hosted project (RPC **`get_circle_title_publishers`**).

## 6.0.28

- **Circles — hosts (4a / backlog):** The **2nd and 3rd** members to join a circle (by `joined_at`) are **`admin`**, with the **same** privileges as the **creator** for **editing** the circle, **+ Invite more**, and **send** via `send-circle-invite`. **`circles.creator_id`** remains the only **owner** for **delete circle** and **`creator_leave_circle`**. RLS: **`is_circle_moderator()`** and **`is_active_circle_moderator()`**; circles **UPDATE** and **circle_invites** read/insert allow **creator + admin**. **Circle info** lists **“Member”** for admins with a **gold ★** (Host). **Edge:** `send-circle-invite` and `accept-circle-invite` **1.0.1** (hosts can invite; self-invite error text). **Apply** migration **`20260601120000_circle_members_admins_moderator_rls.sql`** on the hosted project, then **redeploy** those two Edge functions.

## 6.0.27

- **Circles — copy-to-mail:** **Open in email app** uses a **blue** pill (dark blue fill, light blue label, blue border) instead of the neutral ghost style.

## 6.0.26

- **Circles — copy-to-mail body:** Under **Your circle gets:**, the three lines are now a **bulleted list** with a **slight indent** (plain text: two spaces + `•`) for both **Copy for email** and **Open in email app**.

## 6.0.25

- **Circles — copy-to-mail `mailto:`:** Encode **subject** and **body** with `encodeURIComponent` (spaces as **`%20`**) instead of `URLSearchParams` (spaces as **`+`**), so **Apple Mail** and similar clients show normal spaces in the draft, not plus signs.

## 6.0.24

- **Circles — copy-to-mail (non-user invite):** Add **Open in email app** using a `mailto:` link that prefills **To** (typed address), **Subject**, and **Body** (same as the copyable block). **Copy for email** unchanged. Some mail clients may truncate very long `mailto` bodies; copy remains the reliable full-message path.

## 6.0.23

- **Circles — copy-to-mail invite (master backlog item 2):** When **invite by email** finds **no Cinemastro account** for that address, the **Invite** sheet offers a **read-only prefilled** subject + message (inviter name from **`profiles.name`**, with sign-in **metadata / email** fallbacks), **Copy for email** to clipboard, and short **paste in your mail app** instructions including **send to** the address they entered. **In-app invite** still runs when a matching account exists. **Download** line points to the web app: **https://cinematch-nine-sigma.vercel.app/**. Copy uses **“invited”** / **“join”** wording (not “added”).

## 6.0.22

- **Circles — invite list & activity chrome (master backlog item 1):** **Pending invites** are **in the main Circles list** (no separate slide-down panel): **sort** = invite rows **first**, then your circles — one list, **no** “Invites / Your circles” section headers. **Invite** rows use a **solid, distinct** surface (`.invite-card--list`) with **Decline** and **Accept** on the row. **Header bell** stays a **summary**; tap **scrolls** to the first pending invite (or to a **hint** when you’re **at the circle cap** but still have pending invites — rows are **hidden** at cap until you free a slot). **Unseen** activity on **joined** circle rows is a **number in a circle** (no bell icon). Invite / pending errors show in the Circles header area.

## 6.0.21

- **Title detail — In Theaters:** When a **movie** is in the current **In Theaters** strips (**Now** or **Popular**) and **Where to Watch** has no streaming options (or TMDB returns no regional providers), show **Find showtimes near you (Google)** — opens a Google search for `{title} {year} movie showtimes`. Short hint that results depend on location.

## 6.0.20

- **In Theaters (main screen):** Raise per-strip cap from **15** to **20** (`IN_THEATERS_PAGE_STRIP_CAP`).

## 6.0.19

- **In Theaters (main screen):** **Popular in theaters** is no longer a popularity sort of the **Now Playing** pool. It uses **`/trending/movie/week`** (pages 1–2), **trending order**, with the **same** filters as **Now Playing** (no default-excluded genres, already released, profile region languages when set, US limited-theatrical type-2 window or pass when no US type-2 row). Strip subtitle updated. Catalogue merge **dedupes** by id across both strips so overlap does not duplicate rows.

## 6.0.18

- **Streaming page (main):** **Now** and **What’s popular** use **separate** TMDB pools (no longer one list, two sorts). **All services — Movies:** *Now* = US `flatrate`, **90-day** `primary_release_date`, newest first; *Popular* = **`/trending/movie/week`**. **All services — Series:** *Now* = US `flatrate`, `first_air_date` desc; *Popular* = **`/trending/tv/week`** (excl. talk/news). **With a service:** *Now* = that provider + US `flatrate`, date sort (movies also **90d** window via discover); *Popular* = same provider + **`popularity.desc`** (in-service). Pool cap **25** for each strip; reveal **5** then **10, 15, 20, 25** (~120ms steps) for **both** rows independently. `fetchStreamingPageProviderRefillPool` gains `options.discoverSort` (`date` \| `popularity`) and **90d** window for **movie** + **date**. Profile region languages apply to main-page provider discover via `with_original_language`. Removed legacy single-refill stagger **4→20** on this page.

## 6.0.17

- **Secondary Region → Streaming, All services, Movies:** After the existing **~90d** + **trending** path, the pool is now widened for **every** secondary taste (not only Indian): **US `flatrate`** discover (`primary_release_date.desc`, no date window) with the same `with_original_language` query as the tight path when applicable, then if unique count is still **under 12**, **6** parallel **per-provider** `discover/movie` pulls (cap **8** each, 1 page) — parallel to the **Series** All-services strategy. **Indian** still uses the same Indian taste on broad `flatrate` + per-provider; final cap **25** and strip stagger unchanged.

## 6.0.16

- **Secondary Region → Streaming, All services, Indian:** Widen the **pool** (not the stagger) for **Movies** and **Series** by adding US `flatrate` `discover` (no single `with_watch_providers`) after the existing 90d / 180d+trending paths, with **dedupe** and the same **Indian** taste (language or **`IN`** origin). **Series** also **merge** the prior tight “new/7d air/trending” pool, and if the merged list is still short, run a **shallow** per-provider `discover` (first **6** of `STREAMING_SERVICES`, 1 page, cap **8** each) in parallel — matching **6.0.14** Netflix **`with_origin_country=IN`** on that path. `fetchStreamingPageProviderRefillPool` accepts optional `{ maxPage, cap }` for these smaller pulls. Staggered **5 → 20** on this screen is unchanged.

## 6.0.15

- **Secondary Region (screen) → Streaming strip only:** Reveal is **5** titles immediately, then **9 → 20** on **~120ms** steps (capped at **20** and pool length). Applies to **All services** and **per-provider** refills. **In theaters** and the main **Streaming** page are unchanged (that page still uses 4,9,14,19,20).

## 6.0.14

- **Secondary Region — Indian + service, TV — Netflix vs Prime/Hulu:** `with_origin_country=IN` on `/discover/tv` (6.0.13) is applied only when the selected provider is **Netflix** (TMDB id **8**). **Prime Video** and **Hulu** use the prior **broad US + provider** discover plus the in-app Indian taste filter; `with_origin_country=IN` + those providers was returning no/few series for Indian.

## 6.0.13

- **Secondary Region — Indian + provider, TV only:** `fetchStreamingPageProviderRefillPool` now adds TMDB **`with_origin_country=IN`** on **`/discover/tv`** when the Indian language allowlist is used. Broad US+flatrate discover is dominated by non-Indian titles; the in-app filter then only leaves a couple of rows (often worse for **Netflix** where list payloads omit `origin_country`). Constraining discover to **India origin** + **provider** + **US** `watch_region` first aligns TV strip density with **Prime** / **Hulu**. Movies use the same client taste filter as before (no new discover param in this release).

## 6.0.12

- **Secondary Region — Indian (TV / movies / provider strip / Theaters):** Indian taste no longer uses **`original_language` only**. Many Indian **Netflix** (and other) titles are `en` in TMDB. Rows now also match when **`origin_country` includes `IN`**, in line with how catalog metadata often works. Applies to `fetchStreamingPageProviderRefillPool`, `fetchStreamingMoviesForMarket` / `fetchStreamingTVForMarket` (Indian client taste), and **`In theaters**` language gate.

## 6.0.11

- **Secondary Region — titles (all surfaces):** Do **not** apply profile **Genres to show** (or the genre gate on CF merge) to secondary-shelf / service-refill rows; taste is the secondary bucket and TMDB only.
- **Secondary Region — Indian:** TMDB `with_original_language=hi|ta|…` on **discover** (especially with **watch providers**) is unreliable for Indian. For **`secondary_region_key` = Indian** only: use **broad US** discover / provider refill, then keep titles whose `original_language` is in the Indian language set (same as `getRegionLanguageCodes`).

## 6.0.10

- **Secondary Region / Streaming (service):** `secondaryRegionRefill*` no longer runs **`showRegionKeys`** (global “Regions to show”) on discover refill rows. That filter is for the home catalogue; combined with the Indian/Asian/… **language** query it could empty lists for every provider (e.g. Prime, Hulu) while another looked fine. **Genres to show** still apply. The **All services** path is unchanged; that pool was not using this post-filter. **Not** a TMDB date cut — service discover has no 90-day window.

## 6.0.9

- **Secondary Region screen — US availability:** Theatrical, default streaming pools, and **service** discover refill now use **`region` / `watch_region` = US** (`SECONDARY_AVAILABILITY_TMDB_REGION`) so titles are ones you can watch **in the United States**, while **`secondary_region_key`** only drives **taste** via **`getRegionLanguageCodes`** (and the same filters as before). Removes the old **`secondaryMarketTmdbRegion`** mapping (IN/KR/MX/GB). **Streaming** service IDs in the dropdown match **US** TMDB providers (e.g. Prime **9**). Copy updated (subtitle, empty states, section meta).

## 6.0.8

- **Secondary Region (Streaming) — service discover refill:** Applies the same **`with_original_language`** filter as the non-refill regional streaming pools (via **`getRegionLanguageCodes(secondary_region_key)`**), so provider-filtered discover stays **region-native titles** (e.g. Indian languages for the Indian bucket) instead of mostly English “available in that `watch_region`” catalog. Main **Streaming** page (US) unchanged.

## 6.0.7

- **Secondary Region (Streaming):** Same **service** pill row as the **Streaming** page (All services, chevron, gold active state, vertical rule before **Series** / **Movies**). Picking a provider **re-fills** the strip from TMDB **discover** for that market’s **watch region** (same mapping as the existing regional pool: e.g. **IN** / **KR** / **MX** / **GB**), **flatrate**, cap **20**, **staggered** reveal, genre filters, and **`predict_cached`** on the refilled list; **All services** = previous regional streaming behavior.

## 6.0.6

- **Streaming page — service pill:** The service control sits in one row with **Series** / **Movies** (divider only before those pills), **chevron** on the right, and the pill uses the same **gold active** style as the media pills when a specific provider is selected (not **All services**).

## 6.0.5

- **Streaming page — service filter:** Picking a provider **re-fills** both strips from TMDB **discover** (US, **flatrate**, `with_watch_providers`), up to **20** titles, instead of filtering the all-services pool with per-title `watch/providers`. **All services** = unchanged. **Now** and **Popular** are still the same pool with **newest date first** vs **popularity** client sorts. Titles are revealed in **4, then 9, 14, 19, 20** (short stagger after load) when the final pool is ready; while the first request is in flight, a skeleton shows only until the first items exist. Excludes default **animation** etc. the same as other discover paths. **Your Picks** is unchanged. **`predict_cached`** uses the refilled list when a provider is selected (preserves order).

## 6.0.4

- **Streaming page:** **All services** (default) keeps the same two strips as before. A **service** dropdown (above **Series** / **Movies**) optionally filters both strips to titles that have that provider on **US subscription (flatrate)** in TMDB — loaded asynchronously, shared cache with **Your Picks**. Independent of **profile** streaming provider picks (those still apply only in **Your Picks**).

## 6.0.3

- **Title detail — facts bar:** The shaded row under the scores (US rating / air date, runtime, etc.) now also shows **original language** (from TMDB detail `original_language`, same display names as the secondary Region strip).

## 6.0.2

- **Region (secondary) strip:** Each tile’s meta line now includes **original language** (TMDB `original_language`, shown as a readable name, e.g. Hindi, English) after type · year / season, so one market can still show many languages clearly.

## 6.0.1

- **Region (secondary) strip reliability:** `secondary_region_key` is now read from the profile in a **dedicated, fast** Supabase call once session + catalogue bootstrap are ready, instead of only at the end of the heavier `loadUserData()` (ratings + watchlist + full profile). That removes a race where the secondary TMDB fetches could run with a **null** key and leave theaters/streaming **empty** until a full page refresh. The secondary **TMDB** `useEffect` now uses **try / catch / finally** so a thrown error or unhandled edge case cannot leave the strip **stuck in the loading** state (`secondaryStripReady` false).

## 6.0.0

- **Refactor:** Moved the global app stylesheet from an inline **`styles`** template literal in **`App.jsx`** to **`src/App.css`**, imported from **`App.jsx`**. **No** intended visual or behavior change; same class names and rules. Bumps **major** version to reflect the structural milestone.

## 5.6.52

- **Circles — edit info:** The **creator** can update **name**, **description**, and **vibe** for an **active** circle. **Edit** on the **Circles list** (pill next to the card) and **“Edit name & description”** in **Circle info** open the same bottom sheet. **`updateCircle`** in **`src/circles.js`** (RLS: existing creator update policy). **No** new migration.

## 5.6.51

- **Circles — creator leave:** If the **creator** leaves but **other members** remain, the circle **stays active**: **`creator_id` transfers** to the **earliest-joined** remaining member (`circle_members.joined_at`), their membership role becomes **creator**, then the leaver is removed. **Solo** creator (only member) — behavior **unchanged** (**archive** + remove membership). **Client:** `leaveCircle` calls new RPC `creator_leave_circle`; leave confirmation **copy** reflects transfer vs solo-archive. **DB:** apply **`20260529120000_creator_leave_transfer_ownership.sql`**. **`fetchMyCircles`** now selects **`joined_at`** on members (for any UI that needs join order later).

## 5.6.50

- **Circles — Forward:** Uses a dedicated **Forward to circles** step: only **other** groups (not the circle you’re in) with **add-only** saves — the source circle is never un-published. (Detail still uses **Circles for this title** for full add/remove.) **DB:** `get_circle_rated_strip` now orders Recent by `max(greatest(ratings.rated_at, rating_circle_shares.created_at))` per title so a forward surfaces as **recent** in destination circles, not only when someone re-rates. Apply migration **`20260528120000_circle_strip_share_activity_order.sql`**.

## 5.6.49

- **Circles — rating stars (strip + list):** **Circle (orange) and Cinemastro (gold) now use the same SVG** with **fixed sizes** (strip **16px**, list **13px**) so they always **match each other**. The gold side used to be a ⭐ **emoji** (scales with font/line-height, OS-dependent); the orange side was an SVG sized with **em**, which did not line up. Green “You” / other UI unchanged.

## 5.6.48

- **Circles — circle score star:** Larger orange SVG (**1.28em** in the strip pill, **14px** on All/Top) to better match the **visual** size of the adjacent gold ⭐ (emoji still reads bigger than 1em box).

## 5.6.47

- **Circles — circle score orange star size:** The SVG is larger (**1em** in the under-title pill, **11px** on All/Top list) so it matches the **visual** size of the gold Cinemastro ⭐. Using the same **0.68em** as the cine `font-size` had made the SVG look smaller, because emojis do not size like a 0.68em box.

## 5.6.46

- **Build:** Removed **backticks** inside a CSS comment in the `styles` template literal (they terminated the string and broke `vite build`).

## 5.6.45

- **Circles — circle score star color:** The **circle** score star now uses a small **SVG** with `fill="currentColor"` and **`#f97316`**, because the **⭐ emoji** is usually drawn as a fixed-color graphic and **does not follow** CSS `color` (numbers did). Sizing unchanged vs Cinemastro (strip **0.68em**, list **8.5px**).

## 5.6.44

- **Circles — circle score mark:** **No ring** around the circle-group score. **Orange (`#f97316`) ⭐** only, **same size** as the Cinemastro ⭐ (strip **0.68em**, list **8.5px**). Orange **number** unchanged.

## 5.6.43

- **Circles — circle (group) rating color:** The **circle** score segment uses **orange `#f97316`** for the **ring**, **star**, and **numeric score** (Recent strip under-title pill and All/Top list rows). **Cinemastro** remains **gold**. List rater count **(n)** after the circle score uses a **muted orange**.

## 5.6.42

- **Circles — circle group score mark:** Uses the same **⭐ size** as the **Cinemastro** star in that row (strip: **`cinematch-cine-star`** at **0.68em**; All/Top list: **8.5px** like **`circle-list-rating__star`**) with a **gold circular border** around the red ⭐. Replaces the custom SVG so both scores stay visually consistent.

## 5.6.41

- **Circles — circle group score icon (readability):** Much larger on the **Recent** strip (**20px**) and on **All/Top** rows (**18px**), slightly **thicker gold ring**, **brighter red** star, and a hover **tooltip** (“Circle group score”) on the mark. Easier to see on desktop / high-DPI screens.

## 5.6.40

- **Circles — circle group score icon:** Slightly larger **gold ring + red star** (strip **12px**, All/Top list **10px**; was 10px / 8px).

## 5.6.39

- **Circles — circle score pill icon:** The **group (circle) score** segment no longer uses a **hollow gold ring** (often read as “0”). It now shows a **gold ring with a red star** inside, before the numeric score — on the **Recent** strip under-title pill and on **All / Top** list rows. **Cinemastro** (gold ⭐) segment unchanged.

## 5.6.38

- **Supabase Edge functions — deploy lineage:** Each function’s `index.ts` now defines **`EDGE_FUNCTION_VERSION`** (semver) and includes **`edge: { name, version }`** on every **JSON** response so you can confirm which build is live after deploy. **Convention:** bump **`EDGE_FUNCTION_VERSION`** in the same change as any behavior or dependency change, then **redeploy** that function. Initial baseline **`1.0.0`** for `get-circle-rated-titles`, `send-circle-invite`, `accept-circle-invite`, `compute-neighbors`, and `match`.

## 5.6.37

- **Circles — New activity on the Recent strip:** The **New activity / Refresh** control is no longer a wide bar at the top of the scroll. On **Recent**, it appears as a **76px** strip tile (same width column as the **+**) **immediately to the left of the +** add tile. On **All** / **Top**, a compact one-line **New activity** + **Refresh** still appears under the view tabs (those lists are not a horizontal strip).

## 5.6.36

- **Circles — no accidental strip refresh on mobile:** Removed **body-level “pull to refresh”** touch handlers. They misfired on normal **scroll from the top**, **overscroll** / rubber-band, and **horizontal strip** use (`window.scrollY` ≈ 0 + downward move **> 68px** looked like a pull). The **Recent** feed only reloads when the user taps **Refresh** in the **New activity** bar (or from publish/unpublish flows that already trigger a reload on purpose). The **10s** poll still only **detects** new activity; it does **not** refetch the strip.

## 5.6.35

- **Circles — “new activity” while screen stays on:** The watermark **poll** is now every **10s** (only when the document is **visible**; still not a full feed refetch) and uses a **ref** to the check callback so the timer is **not** reset on every re-render. That makes “someone else published while I’m still on this circle” work without **switching away and back** (resume events were already reliable).

## 5.6.34

- **Circles — new activity (mobile / PWA):** Resume checks no longer require **`pageshow.persisted`** (that only matches bfcache; mobile tab/PWA return usually has `persisted: false` while **`window` `focus` is unreliable** on iOS). Added a **~500ms** follow-up `check` after **`visibilitychange` → visible**, a **45s** lightweight watermark poll only on **circle detail** (not a full feed refetch, tab hidden = no tick), and **`pageshow`** always re-syncs badges / “new activity” so behavior matches **desktop** when another member publishes.

## 5.6.33

- **Circles — activity (Phase A, web):** **Circles** list (logged in): each circle can show a **bell + count** for **new publishes from other members** since your last open (`rating_circle_shares` with `user_id` ≠ you and `created_at` > per-circle **last seen**). **Inside a circle** (2+ members): after you load the feed, we compare a server **watermark** (latest other member share time) to what you had when the feed was last refreshed; on **tab focus** / **visibility** / bfcache **pageshow** we may show **“New activity”** with **Refresh**; pull **down** on the circle body (from scroll top) also bumps refresh. **No** automatic silent refetch of the strip. **DB:** `circle_member_last_seen` + RPCs **`get_my_circle_unseen_counts`**, **`mark_circle_last_seen`**, **`get_circle_others_activity_watermark`** — apply migration **`20260527120000_circle_member_last_seen.sql`** on Supabase. Badges also refresh on **login** and when returning to the **Circles** list.

## 5.6.32

- **TMDB posters — right-size at render:** Strips, list thumbs, discover grid, watchlist, rated list, circle rows, etc. use **`w342`** via **`posterSrcThumb()`** (rewrites `/t/p/w500/…` → **`w342`**). **Detail** floating poster, **onboarding** / **rate-more** cards, and **mood** poster-only fallback use **`w500`** via **`posterSrcDetail()`**. **Mood** cards keep **`backdrop`** URLs as-is (**`w780`**). Catalogue / watchlist **stored** URLs stay **`w500`**; only **`<img src>`** changes. Helpers: **`tmdbImageProfileUrl`**, **`posterSrcThumb`**, **`posterSrcDetail`**, **`moodCardBackdropOrPosterSrc`**.

## 5.6.31

- **Images:** **`loading="lazy"`** + **`decoding="async"`** on poster thumbnails, strips, lists, discover/mood grids, watchlist, circle rows, and **Where to Watch** provider logos. **Title detail** hero **backdrop** uses **`loading="eager"`** + **`fetchPriority="high"`**; **floating poster** **`eager`**; **onboarding** and **Rate more** single-card posters **`eager`** so LCP is not deferred.

## 5.6.30

- **Primary nav:** Removed **`profiles.name`** pill beside the header logo (it crowded narrow viewports and overlapped section titles like **Circles**). Name still appears on **Profile** as before.

## 5.6.29

- **PWA icon:** Larger **cinemastro** wordmark on **`cinemastro-pwa-icon.svg`** (~**88px** type, wider canvas), **−27°** tilt so it uses the square; tagline omitted on the icon asset only (unreadable at 180×180). Regenerated **`apple-touch-icon.png`** / **`pwa-icon-192.png`** (`npm run icons:pwa`).

## 5.6.28

- **PWA / iOS home screen:** **`apple-touch-icon`** now **`/apple-touch-icon.png`** (180×180 raster) so Add to Home Screen shows the **wordmark** on iPhone (Safari often skips nested `<image href>` inside SVG touch icons). **`cinemastro-pwa-icon.svg`** is **self-contained** (inlined wordmark, no external asset). **`site.webmanifest`** lists **`/pwa-icon-192.png`** first for install surfaces that prefer PNG. Dev: **`npm run icons:pwa`** regenerates PNGs from the SVG via **`scripts/generate-pwa-touch-icons.mjs`** (**`@resvg/resvg-js`**).

## 5.6.27

- **PWA / install icon:** `site.webmanifest` + **`/cinemastro-pwa-icon.svg`** (square, **`#0a0a0a`**, embeds the full **`/cinemastro-logo.svg`**) so “Install” / Add to Home Screen uses the **Cinemastro wordmark**, not the small abstract **`favicon.svg`**. `index.html`: manifest link, `theme-color`, `application-name`, `apple-touch-icon`. Tab shortcut still uses **`favicon.svg`**. *Note:* some older iOS versions prefer a **raster** `apple-touch-icon` (e.g. 180×180 PNG); if the home-screen tile is wrong on a device, export PNGs from the same comp and add them to `public/` + manifest.

## 5.6.26

- **Circles — limits:** Restore **10** active circles per user and **25** members per circle in **`circles.js`** and **`send-circle-invite`** / **`accept-circle-invite`**. (Testing caps 3/4 are reverted.) **Redeploy** both Edge functions to Supabase for prod to match the client.

## 5.6.25

- **Circles — limits (testing):** **3** active circles per user and **4** members per circle (`CIRCLE_CAP` / `CIRCLE_MEMBER_CAP` in `circles.js`, matching **`send-circle-invite`** and **`accept-circle-invite`** Edge). UI copy and invite gating use **`CIRCLE_MEMBER_CAP`** (no hardcoded 25s). **Redeploy** both Edge functions on the Supabase project when shipping.
- **Primary nav — display name:** Shows **`profiles.name`** in a small **no-fill** pill between the logo and the **Discover (lens)** control; names longer than **5** characters are truncated with an **ellipsis** (full name on hover via `title`).

## 5.6.24

- **Watchlist — ⋯ menu moves:** Reorder no longer **blocks the UI** on empty **`UPDATE` RETURNING** rows (some RLS / PostgREST setups omit the returned row even when the update applies). We only **fail** on a non-null **`error`**. New migration adds **`watchlist update own`** (authenticated users may update their own rows) for projects where UPDATE was not allowed.

## 5.6.23

- **Watchlist reorder:** **Move up/down/top/bottom work again** — row keys for Supabase `tmdb_id` / `media_type` now fall back to **`tmdb_id`**, then **`parseMediaKey(id)`** when `tmdbId` is missing, and `buildWatchlistFromRows` always sets **`tmdbId`** from the DB when needed. **Post-update `.select()`** results are treated as **either a single object or an array** so we do not treat a successful one-row update as “0 rows”.

## 5.6.22

- **Watchlist order:** **Persist reorder after sign-out** — `loadUserData` now always rebuilds the list from `watchlist` when rows exist, even if **catalogue** is not ready yet (stubs for TMDB). **Media type** is normalized to `movie` / `tv` for list keys and **Supabase** updates so `.eq("media_type", …)` and `.eq("tmdb_id", …)` match stored rows. **Swap / Top / Bottom** use **number** `tmdb_id`, normalized `media_type`, and **`.select()`** after updates so a **0-row** update no longer only updates React state (which looked fine until the next full reload).

## 5.6.21

- **Circles — All / Top:** The **You** label uses the same **green** as your score (was blue).

## 5.6.20

- **Circles — All / Top:** Personal score label is **You** in sentence case (not uppercase), matching “you” vs the prior **Your** / **YOUR** styling.

## 5.6.19

- **Strips — type & year:** A **muted chip** (dark translucid background + light border) behind **Movie · … / TV · …** on home/strip cards (`.strip-genre`).
- **Circles — Recent:** The **on-poster** type/year (bottom-left) uses a matching **muted background** (`.circle-strip-poster-meta`). **Spacer** strip rows (Earlier / + / More / etc.) use `.strip-genre--spacer` so empty slot lines stay invisible.

## 5.6.18

- **Circles — All / Top list:** **Three lines** — **title** (line 1); **Movie/TV · year** on its own line (line 2, muted); **Circle · Cinemastro · Your** scores (line 3).

## 5.6.17

- **Circles — All / Top list:** **Movie/TV** and **year** sit **immediately after** the title (inline) instead of being pushed to the right — **`.circle-list-title-line__name`** no longer uses `flex-grow`.

## 5.6.16

- **Circles — Recent:** Restores the **pill** (subtle background + gold-edge border) around the **circle + Cinemastro** line under the title.

## 5.6.15

- **Circles — Recent:** Circle + Cinemastro line **below the title** is **plain text** (no background/border “pill”).

## 5.6.14

- **Circles — Recent strip (fix):** Restores **`StripPosterBadge`** on the **poster (bottom-right)** — your rating, personal prediction, or community/TMDB as before. **Circle** (gold ring) and **Cinemastro** (smaller ⭐) live on a **line under the title**, not on the art.

## 5.6.13

- **Circles — Recent strip:** **Movie/TV** and **year** on the poster (**bottom-left**, muted) so the row under the art is just **title** + optional rater line. **Circle** and **Cinemastro** scores sit together in one **bottom-right** pill: **hollow gold ring** + circle average, **·** , slightly smaller **⭐** + site average (no separate per-title badge).
- **Circles — All / Top** list: **one line** for scores — **ring** + circle (and **(n)** when used) **·** **⭐** + Cinemastro **·** **Your** + number (no extra stars on “Your”). **Title** is **one line** with **· TV|Movie · year** in **smaller, muted** type after the name.

## 5.6.12

- **Watchlist:** **30 titles max** per user (`WATCHLIST_MAX` in `App.jsx`). Adds are blocked with a toast when full; **+ Watchlist** (detail), **Select to Watch** (mood), and **Add to watchlist** (circle Recent menu) are disabled at cap. **Profile** and **Watchlist** screens show **count / 30**. Migration **`20260525120000_watchlist_max_30.sql`**: trims users over 30 (pre-launch), **`BEFORE INSERT`** trigger enforces the cap.

## 5.6.11

- **Circles — Recent strip:** **Long-press** (~520ms) or **⋯** opens a menu: **Details**, **Rate** / **Rerate**, **Add to watchlist** / **Delete from watchlist** (no navigate-away), **Forward** (opens **Circles for this title** when you’ve rated — publish to other circles), **Remove from circle** (only when **you** published here; unpublishes your share). Horizontal drag cancels long-press.

## 5.6.10

- **Circles — All / Top:** After the **Circle** score, show **(n)** when the circle has **more than two members** and **n** members rated that title (`distinct_circle_raters`), matching the **Recent** strip’s rater-count rule.

## 5.6.9

- **Circles — All / Top:** Replaced the poster **grid** with a **watchlist-style list** (thumb + text). First line is **title · year**; second line shows **Circle**, **You**, and **Cinemastro** ratings in that order (each with **⭐**), omitting scores that are not available. **Circle** uses amber numerals, **You** uses a blue label and green score, **Cinemastro** uses gold. Rows open **title detail** on tap.

## 5.6.8

- **Navigation:** Opening **Circles** (or other primary sections) from the **top nav** after being on **Watchlist** now sets **`navTab` to `home`**, so the bottom bar no longer keeps the **Watchlist** ring.

## 5.6.7

- **Circles** — Title and type/year/Cinemastro subline are **center**-aligned. Site score segment uses **`⭐ 5.0`** (space after star) for clearer separation from the middle dot.

## 5.6.6

- **Circles — title rows (Recent / All / Top).** Titles are **one line** with **ellipsis**; the line under is **`Movie`/`TV` · year · `⭐`Cinemastro** (e.g. `TV · 2026 · ⭐5.0`), with **—** when there is no site average. **Circle** row (group score + rater count) is unchanged. The extra **Cinemastro**-only line under `solo` is removed; site score is in the combined line.

## 5.6.5

- **Circles — Recent scroll hint.** When the strip is horizontally scrollable and not at the **left** edge (e.g. after centering on the newest title), a **faded ← in a round** appears on the **left** over the poster row; **pointer-events: none** so it does not block dragging. Shown when `scrollLeft > 4` and `scrollWidth > clientWidth`.

## 5.6.4

- **Circles — Recent add width.** The add column is **half the width** of a title strip card (**76px** vs **152** poster), with a **smaller** round **+**; still **212px** tall poster row for alignment with neighbors.

## 5.6.3

- **Circles — Recent add alignment.** The **+** sits in the same **152×212 poster** band as other strip cards, with `strip-title` / `strip-genre` placeholders (hidden) so the column matches neighbors; `align-self: flex-start` with title cards (no vertical centering in the full row).

## 5.6.2

- **Circles — Recent add control.** The in-strip add action is a **round +** (muted gold, ~48px) instead of a full poster-size “Rate a title” tile, with a clear **`aria-label`**.

## 5.6.1

- **Circles — Recent strip UX.** Titles are shown **oldest → newest (left → right)** with **load earlier** on the **left** and a **Rate a title** add tile to the **right** of the newest pick (replaces the separate bottom **Rate a title** pill). On load, the strip **scrolls** so the **newest** title is about **centered** in view; re-centering is skipped when loading more **earlier** titles. **All / Top** and placeholder **empty** copy is aligned with the **publish** model; creator **leave** confirmation copy updated.

## 5.6.0

- **Circles — publish ratings per group.** New table **`rating_circle_shares`** (`user_id`, `tmdb_id`, `media_type`, `circle_id`): a title appears in a circle’s Recent / All / Top feeds only if the member **published** it there. **No backfill** — existing circles start empty until users publish. **Leave circle** (trigger on `circle_members` delete) removes that member’s shares for that circle only; global **`ratings`** rows unchanged.
- **RPCs** **`get_circle_rated_strip`**, **`get_circle_rated_all_grid`**, **`get_circle_rated_top_grid`** now join **`ratings`** through **`rating_circle_shares`** for the requested `circle_id`. **`viewer_score`** only when the viewer has published to that circle.
- **Client:** After a **first-time** rating from detail, **Publish to circles** modal (skip allowed; defaults include circle when opened from circle flow). **Publish to circles…** on detail when already rated. Helpers **`syncRatingCircleShares`**, **`fetchRatingCircleShareIds`** in **`src/circles.js`**. Apply migration **`20260524120000_rating_circle_shares.sql`** on Supabase (Edge **`get-circle-rated-titles`** unchanged — redeploy not required for RPC-only change).

## 5.5.23

- **Watchlist ⋯ menu.** Dropdown is **vertically centered** on the row (was opening above the button and clipping under the header). **`z-index: 2190`** so it paints above **primary nav** / drawer while staying below Circles sheet/modal layers.

## 5.5.22

- **Circles — Ratings tabs (Recent / All / Top).** Fixed **active tab label** contrast on **iOS Safari**: sticky **`:hover`** no longer overrides **`color`** on the selected tab (hover only applies to inactive tabs). Active rule uses **two-class** specificity; tabs use **`appearance: none`** and narrower **`transition`** props to avoid native button / transition glitches.

## 5.5.21

- **Watchlist ⋯ menu.** Reorder actions: **⇈ Top**, **↑ Up**, **↓ Down**, **⇊ Bottom** (with **Details** and **Remove**). Top/bottom use a new **`sort_index`** above/below the current extremes; up/down swap with the adjacent row (same as before for **Up**).

## 5.5.20

- **Watchlist strip / list meta.** Type, year, TMDB score, and genre are combined into **one line** under the title (e.g. `Movie · 2024 · TMDB 7.2 · Drama`); narrow strip cards still ellipsis when needed.

## 5.5.19

- **Watchlist order (database).** New column **`sort_index`** on **`public.watchlist`** (migration **`20260523120000_watchlist_sort_index.sql`**). List order syncs across devices; **Move up** updates **`sort_index`** in Supabase. Removed local-only ordering via localStorage.
- **Profile watchlist strip + list rows.** Under each title: line 1 = **type · year**; line 2 = **TMDB score** and **first known genre** (from TMDB genre ids when the title is in the catalogue). If metadata is missing, lines may show **—** or omit the second line.

## 5.5.18

- **Watchlist ⋯ menu.** Row menu now has **Details** (opens title detail), **Move up** (swap with the row above; disabled on the first row), and **Remove**. Order is stored per account in **localStorage** so it survives refresh on this device (Profile strip and list stay in sync).

## 5.5.17

- **Profile — header.** Removed the duplicate **page top bar** (wordmark + small avatar) under the primary nav; the **name / stats** band stays as the profile hero.
- **Bottom nav.** Active tab uses a **subtle circular highlight** behind the icon for **Mood**, **Watchlist**, and **Profile** (no text labels), keeping the bar a consistent height.
- **Watchlist screen.** **List layout**: poster thumbnail, title, **Movie/TV · year**, optional **Group** hint, row divider, **⋯** menu with **Remove from watchlist**. **Primary nav** (desktop links + hamburger drawer) includes **Watchlist**.
- **Watchlist data.** Rows and Profile strip show **type · year**; **detail** shows **Watchlist · from …** with the **circle name** when the item was saved from a circle (or “from a circle” if the name is not available).

## 5.5.16

- **Navigation — Watchlist in bottom bar.** The bottom nav **center** slot is now **Watchlist** (list icon + label when active). Community / ratings counts are removed from the bottom bar (can be restored elsewhere later). New **`watchlist`** screen shows the same list as Profile’s watchlist. **Title detail** includes the bottom bar so Watchlist is reachable from detail; switching tab clears the detail overlay when needed.

## 5.5.15

- **Circles — Ratings tabs on circle detail.** **Ratings** row with **Recent** (horizontal strip, unchanged cap/behavior), **All** (Discover-style **3-column** grid, **10** titles per page + **More**), and **Top** (same grid, sorted by **highest circle average** with ties by rater count then recency, **max 25** titles + **More**). Edge **`get-circle-rated-titles`** accepts **`view`**: `recent` | `all` | `top`. New RPCs: **`get_circle_rated_all_grid`**, **`get_circle_rated_top_grid`**. Migration: **`supabase/migrations/20260522120000_circles_rated_all_top_grid.sql`** (apply on Supabase). Redeploy Edge **`get-circle-rated-titles`**.

## 5.5.14

- **Circles — Recent activity strip.** `get_circle_rated_strip` orders titles by **latest circle rating** (`last_at` only), not “together before solo.” **Circle** score shows for **every** title (including a single rater; the average is that member’s score). When the circle has **more than two members**, each card shows **how many members rated** (e.g. `2 rated`) without naming them. **Re-rating** a title updates **`rated_at`** (trigger on `ratings` score change) so the strip reflects edits. Migration: `supabase/migrations/20260506120000_circles_strip_recent_activity.sql` (apply on Supabase).

## 5.5.13

- **Circles — Rate a title.** On **circle detail** (active circles), a centered **Rate a title** pill below the strip opens **Discover** unchanged. Opening a title from Discover and submitting a rating (or back) returns to **this circle** via `detailReturnScreenRef` + `rateTitleReturnCircleIdRef`. **Open Discover** in the post–20-cap hint uses the same return behavior.

## 5.5.12

- **Circles — strip copy & card.** Section header is **Recent activity** (skeleton + loaded strip). Empty state unchanged: **No shared ratings in this circle yet.** **Circle** score (muted label + gold number) sits **centered above the title** for **together** rows; bottom line is **solo only** (Cinemastro), so no duplicate Circle line.

## 5.5.11

- **Circles — circle detail hero.** Avatar, title, and member subtitle are **centered** as a block between back and info (identity column no longer stretches full width; title/subtitle text aligned center).

## 5.5.10

- **Circles — circle detail hero (chat-style).** Header is a single row: **back** · **avatar** (two-letter initials) + **circle name** (one-line ellipsis) + **subtitle** (people icon + member count) · circular **(i)** button for **Circle info**. **+ Invite more** moved into the **Circle info** modal (creator, active circles); opening invite closes the info sheet. Frosted bar (`backdrop-filter`) on the header strip.

## 5.5.9

- **Circles — create name rules.** Circle names are **2–32** characters (was 40). Allowed characters: **letters** (Unicode), **spaces**, **hyphen**, **apostrophe**; **digits** only after a leading letter; no emoji or other symbols. Pasted **smart quotes** and **Unicode dashes** normalize to `'` and `-`. Validation lives in **`validateCircleName`** / **`normalizeCircleNameInput`** (`src/circles.js`) and runs on create. DB: migration **`20260505120000_circles_name_length_2_32.sql`** tightens **`circles.name`** to length **2–32** (apply on Supabase when ready).

## 5.5.8

- **Circles — circle detail hero.** Circle name in the top bar again uses the same **font size** as before (**32px** / **26px** on narrow viewports), inheriting **DM Serif Display** from `.circle-hero__name`; compact layout and meta alignment from **5.5.7** unchanged.

## 5.5.7

- **Circles — circle detail hero (tighten).** More compact top bar and hero body padding; **members / Circle info / Invite more** aligned on one baseline (**grid** `align-items: center`, flex cells); slightly smaller invite pill; less gap before **Rated in this circle**. Circle title uses **DM Sans** semibold at **34px** (desktop) / **28px** (narrow), **★** scaled to match.

## 5.5.6

- **Circles — circle detail hero.** **Back** (left) and **circle name** centered in the top bar with a small **★** before the name for creators (replaces **👑**). **Members** (left), **Circle info** (center), and **+ Invite more** (right when creator + active) share one **bottom** row; full-circle cap copy stays under the invite control.

## 5.5.5

- **Circles — circle detail hero.** Single **top bar** (grid): **Back** (left), creator **👑** (center, aligned with controls), **+ Invite by email** (right when applicable). **Circle name** is centered alone below; back/invite are no longer absolutely positioned over the title.

## 5.5.4

- **Circles — circle detail (mobile).** Narrow viewports: circle name uses **DM Sans** at a slightly smaller clamp; creator **crown** is **top-right** in the title row (absolute) with reduced size so wrapped titles don’t sit beside the emoji.

## 5.5.3

- **Circles — Circle info member names.** The Circle info modal lists each member’s display name from `profiles.name`. Direct client `select` on `profiles` only returns rows visible under RLS (usually just yourself), so the app now calls **`get_circle_member_names(p_circle_id)`** (SECURITY DEFINER, gated on `is_circle_member`) and merges any gaps with the legacy `profiles` query. Apply migration **`supabase/migrations/20260503120000_get_circle_member_names.sql`** on Supabase before relying on names for co-members.

## 5.5.2

- **Title detail (TMDB-style).** Centered hero title (smaller title + smaller year); poster vertically centered on backdrop; inline two-column scores with stacked range/confidence and Cinemastro meter; shaded facts bar (cert, US date, runtime, genres) from TMDB `append_to_response`; centered tagline, overview, and Where to Watch panel. Rating block: default **5**, value bubble on slider, **“Select your rating and submit”**, centered controls.
- **Primary nav (recap).** Mobile detail: back on first row, no hamburger; Discover drops duplicate top bar; bottom bar shows public stats between Mood and Profile; Profile opens account menu app-wide.

## 5.5.0

- **Watchlist — group hint.** `watchlist.source_circle_id` (optional FK to `circles`). When you save from title detail opened **from a circle** (`circle-detail` → strip card), the row stores the circle id; **Profile → Watchlist** shows a small **Group** label (no circle name). Migration: `supabase/migrations/20260501120000_watchlist_source_circle_id.sql`.
- **Match / Your Picks.** `your_picks_page` hydrates whenever you have ratings and a non-empty catalogue (not only certain tabs). Edge payload prefers `catalogueForRecs`, with **fallback to full `catalogue`** when filters leave the filtered list empty. Responses from `supabase.functions.invoke` are normalized via `unwrapMatchFunctionData`. Prediction overlays merge string/number scores and `neighbor_count` / `neighborCount`; `yourPicksPredictions` is always replaced (including `{}`) to avoid stale maps.

## 5.4.4

- **Circles — Circle info UX.** Hero: **vibe**, **member count**, and **Circle info** on **one row** (left cluster + link right). Circle info opens as a **centered modal** over the circle view (`z-index: 2300`), not a bottom sheet. Circle name in the hero uses a **2-line clamp** so long titles don’t dominate the card.

## 5.4.3

- **Circles — Circle info sheet.** Hero layout **B**: vibe on its own row; **members** count left and **Circle info** link right on the row below. Sheet lists members (names from `profiles` when RLS allows) with Creator/Member labels; **Leave circle** moved here (removed from main detail body). Reuses existing leave confirmation.

## 5.4.2

- **Circles strip UI.** Single horizontal row for **Rated in this circle** (together + solo in server order). **Load more** is a trailing **›** tile at the end of the strip (no separate second section; cap 20 unchanged).

## 5.4.1

- **Circles strip performance.** `get_circle_rated_strip` now calls `get_cinemastro_title_avgs` only for titles on the **current page** (not every solo title in the circle). Edge `get-circle-rated-titles` uses **two batched reads** from `user_title_predictions` (movie + tv) and **no longer** invokes `match_predict_neighbor_raters` per title (cold cache → `prediction: null`, same as other strips). Migration: `supabase/migrations/20260430120000_circles_strip_site_avgs_page_only.sql`. Redeploy Edge after pull.

## 5.4.0

- **Circles — Phase C strip pagination.** The circle-detail strip loads **10** most recently rated titles first, then **Load more** fetches **5** at a time up to a **20**-title cap. `get_circle_rated_strip` now takes `p_limit` / `p_offset` (defaults 10 / 0) and returns `total_eligible` and `has_more`. After 20 titles, copy points users to **Discover** to search by title. Migration: `supabase/migrations/20260429120000_circles_strip_pagination.sql`. Redeploy Edge: `get-circle-rated-titles`.

## 5.3.0

- **Circles — Phase C strip UI (`circle-detail`).** Replaces the ≥2-member placeholder with live data from `fetchCircleRatedTitles`. When the circle has fewer than two members, the original explainer stays. With two or more members, the screen loads the Edge response (skeleton while loading), then renders two horizontal strips — **Rated in this circle** (together: ≥2 circle raters, shows circle average + your `StripPosterBadge`) and **Also watched here** (solo: one circle rater, shows Cinemastro site average + your badge). Titles not already in the merged catalogue map are hydrated via TMDB detail (`normalizeTMDBItem`). Tap a card to open the standard title detail (`openDetail`). Empty state when no qualifying titles. Strip errors surface as a banner without blocking the rest of the page.

## 5.2.0

- **Circles — Phase C backend (rated strip API).** Adds `public.get_circle_rated_strip(circle_id uuid)` (SECURITY DEFINER, `auth.uid()` membership check) implementing the Phase C display contract from `20260422120000_circles_schema.sql`: ≥2 members to return strip rows; **together** (≥2 distinct circle raters per title, group average) vs **solo** (exactly one circle rater, Cinemastro site-wide average via `get_cinemastro_title_avgs`); archived circles filter ratings to `rated_at < circles.archived_at`; up to 60 titles ordered by section then recency. Ensures `public.ratings.rated_at` exists when missing (for archive cutoff).
- **New Edge function `get-circle-rated-titles`.** Authenticated callers invoke it with `{ circle_id }`; it runs the RPC with the user JWT, then fills per-title CF predictions (`match_predict_neighbor_raters` + `user_title_predictions` read-through cache) when the viewer has not rated. `npx supabase@latest functions deploy get-circle-rated-titles --project-ref lovpktgeutujljltlhdl`.
- **Client helper `fetchCircleRatedTitles({ circleId })`** in `src/circles.js` (same `invoke` + `FunctionsHttpError` parsing as invite flows). **Strip UI** ships in **v5.3.0**.
- **Migration:** `supabase/migrations/20260426120000_circles_phase_c_get_circle_rated_strip.sql` — apply in Supabase SQL editor (or your usual migration path) before relying on the RPC or Edge function.

## 5.1.0

- **Circles — Phase B (invite by email).** The bell icon on the Circles header is now live. Tap it to open a slide-down Invites panel that lists every pending invite for you (newest first) with the sender's name, the circle's name + vibe badge, and the current member count. Each row has two buttons: **Decline** (direct client update to `circle_invites.status = 'declined'`, recipient is the only one RLS-permitted to flip it) and **Join circle** (calls the new `accept-circle-invite` Edge function). Accepted circles are prepended into the Circles list in place — no refetch. The bell turns solid gold when there's at least one pending invite.
- **Invite composer on circle detail (creator only).** Active-circle creators see a new "+ Invite by email" pill under the hero. It opens a bottom sheet with an email field + "Send invite" CTA that calls the new `send-circle-invite` Edge function. Success drops a center-bottom toast ("Invite sent to X"). If the recipient is at their 10-active-circle cap the Edge auto-declines per spec §3.2 and the toast switches to the warn tone ("Their circles are full — invite was auto-declined."). The button disables at 25/25 members and surfaces the cap banner.
- **Two new Edge functions.** `supabase/functions/send-circle-invite` (creator auth → resolves email → profile id → runs all the cap + duplicate + archived checks → upserts the invite as pending or auto_declined, re-using the existing row if the `circle_invites_unique_pending` constraint already has a terminal one) and `supabase/functions/accept-circle-invite` (recipient auth → re-validates circle is still active and under cap → inserts `circle_members` as service role → flips the invite to accepted). Accept-time user-cap race returns an error and leaves the invite pending (spec §3.3 confirmation); send-time cap breach auto-declines. Stale-archived circle accepts decline the invite as cleanup. Both functions run as `service_role` behind the caller's JWT for ownership checks.
- **Two new SECURITY DEFINER helpers.** `public.resolve_profile_id_by_email(text) → uuid` is called by send-circle-invite only (execute is revoked from `anon`/`authenticated` to prevent email enumeration; service role retains access via the bypass role). `public.get_my_pending_invites() → table` returns every pending invite for `auth.uid()` pre-joined with the circle's display fields, member count, and the sender's `profiles.name`, so the bell panel renders in a single round-trip without fighting SELECT RLS on profiles.
- **New migration:** `supabase/migrations/20260424120000_circles_phase_b_helpers.sql`. Apply via the Supabase SQL editor (no schema changes — functions only).
- **Deploy commands.** `npx supabase@latest functions deploy send-circle-invite --project-ref lovpktgeutujljltlhdl` and `npx supabase@latest functions deploy accept-circle-invite --project-ref lovpktgeutujljltlhdl`. Both require `SUPABASE_SERVICE_ROLE_KEY` in the project's Edge secrets (already configured for the existing `match` / `compute-neighbors` functions).
- **Unchanged.** Creator-leave → archive flow, Phase A RLS model (the three SECURITY DEFINER helpers from the v5.0.0 hotfix still fully gate the client-side invite INSERT / decline UPDATE paths), circle + member cap math, vibe design tokens. Phase C strip UI landed in **v5.3.0** (after this release).

## 5.0.0

- **Circles — Phase A UI (the real Circles page).** The `/circles` placeholder (`"Something exciting is happening here…"`) is gone; the landing screen now renders an actual Circles feature. Header shows "Circles" (DM Serif Display) + live "X of 10 circles" subtitle (count is the user's rows in `circle_members` against `circles.status = 'active'`; archived circles don't count toward the cap). A "+ New Circle" pill opens a bottom sheet (Name required, 1–40 chars; Description optional, ≤100 chars; Vibe dropdown of the 9 spec values, default "Mixed Bag"). Create runs as two sequential inserts — `circles` then `circle_members(role='creator')` — under the "creator can seed own membership" RLS policy; if the membership insert fails, the orphan circle row is deleted best-effort and the error surfaces in the sheet. The 10-circle cap disables the button and shows a warning banner when reached.
- **Circles list + empty state.** Active circles render as cards (DM Serif name, description, vibe badge in the vibe's accent color, member count, 👑 creator crown if you created it), ordered by `created_at desc`, with an ambient radial tint from the vibe's background-tint token (spec §8). Empty state shows a 10-slot visualization plus a "Create a circle" CTA. Archived circles are filtered out of the main list for this pass (a separate Archived section is a later polish pass). Bell icon + pending-invites count is stubbed at 0 for Phase A (invites flow lands in Phase B).
- **Circles — stub dashboard (`/circle-detail`).** Tap a circle → new `circle-detail` screen with a tinted hero (name, vibe badge, member count, creator crown), a "Rated in this circle" placeholder explaining the ≥2 member gate, and a "Leave circle" button. No rated-titles strip, members avatar stack, or settings sheet yet (Phase C). The Circles link in the primary nav stays highlighted while you're drilled in; ← Back returns to the list.
- **Leave flow (client-side, Phase A).** Non-creator leave → single `delete from circle_members where circle_id = $1 and user_id = auth.uid()`. Creator leave → flip `circles.status = 'archived', archived_at = now()` first (required so the "creator can update own circle" USING clause on `status = 'active'` still lets it through), then delete the creator's own row. Last-member-leaves-archived hard-delete is deferred to Phase B's Edge function — archived circles with zero members stay as ghost rows until then, which is fine because none of them surface in any query.
- **New module `src/circles.js`.** Centralizes the 9-vibe catalog + accent/tint colors, the 10-active / 25-member caps, and all four supabase calls (`fetchMyCircles`, `fetchCircleDetail`, `createCircle`, `leaveCircle`). No Edge function changes shipped here — every call is direct RLS-enforced client reads/writes.
- **No schema changes** — the `circles` / `circle_members` / `circle_invites` migration landed on the server in `184c0e0` (pre-bump) and is fully honored by this UI. `watchlist.source_circle_id`, `circles.icon_emoji`, `circles.color`, and the cover-image Storage bucket remain deferred per the migration comment header.
- **Version jump rationale (4.0.10 → 5.0.0).** Circles is the first primary-surface feature since the v4 page architecture shipped, and it introduces a net-new screen type (`circle-detail`), a net-new schema domain, and a social data contract that every subsequent feature hangs off of. Treating it as a 5.0 cut rather than 4.1 matches how the rest of the changelog has marked major-feature introductions.

## 4.0.10

- **Hotfix v4.0.9.** The mobile hamburger commit referenced `React.useState` / `React.useEffect` in `AppPrimaryNav`, but `src/App.jsx` only imports the hooks as named exports (no `React` namespace). That threw `React is not defined` at render time and broke the entire app shell. Switched both calls to the named `useState` / `useEffect` imports. No behavior change beyond "the page now loads again".

## 4.0.9

- **Mobile hamburger menu for the primary nav.** On viewports below 900px the horizontal section links row is replaced by a ☰ button in the top-left; tapping it opens a slide-down drawer containing the same items (Circles / Pulse / In Theaters / Streaming / Your Picks, plus the regional label when a secondary region is set). The drawer dismisses on link tap, scrim tap, the ✕ close button, or Escape. Desktop (≥900px) is untouched — logo, inline section links, and the 🔍 Discover icon still render exactly as before. Also auto-closes if the viewport widens past the breakpoint mid-session (rotate / resize). Client-only; no Edge, no RPC, no prop plumbing changes.

## 4.0.8

- **Home retired; Circles is the landing.** The `home` screen has been removed entirely. Post-login routing, the wordmark tap, back-from-legal, onboarding exit, and the mood back button all now land on `/circles`. The `navTab === "home"` value remains as the idle bottom-nav sentinel (meaning "neither Mood nor Profile is active"), which keeps the page-agnostic state model intact. `SPA_DEEPLINK_READY_SCREENS` now includes `circles`, `secondary-region`, and `your-picks`; `home` is out.
- **Secondary Region moved to its own page.** The theaters + streaming block that used to live under Home now has a dedicated `/secondary-region` route mirroring the In Theaters / Streaming page pattern: top tabs (In Theaters / Streaming), sub-tab under Streaming (Series / Movies), `secondaryStripRecsVisible` strip, skeleton while loading, empty state per pool. Page title is dynamic — uses `V130_SECONDARY_HOME_TITLE[secondaryRegionKey]` (Indian / Asian / Latam / European) falling back to "Region". Nav link only appears when a secondary region is set (as before); deep-linking to the page without one set shows a friendly "pick a region in your profile" empty state.
- **Removed the What's hot strip from the app's primary surface.** Pulse / In Theaters already cover the trending + theatrical shelves. `whatsHot*` data plumbing is retained (still feeds `recMap`, `catalogueForRecs`, and Discover) but no longer rendered as its own strip anywhere.
- **Per-page predict gating moved with the page.** `predict_cached` for `secondaryRecs` now fires on `/secondary-region` (was `/home`). `whatsHotRecs` predict is dropped. `homePicksLoadFailed` memo removed (every remaining page owns its own empty/error states).

## 4.0.7

- **Your Picks hydration: one round-trip.** New Edge action `your_picks_page` combines the prior two sequential calls (`recommendations_only` → `predict_cached` over rec IDs) into a single response. Server-side runs `runRecommendationsOnly` (`match_recommendations_from_neighbors` RPC + worth-a-look pool) and a bulk indexed read from `user_title_predictions` concurrently via `Promise.all`, filters the cached predictions down to the rec IDs the client will render, and returns `{ recommendations, worthALookRecs, predictions }` in one payload. Fixes the ~15s first-load stall (and intermittent 3rd-try failures) caused by cold-cache compute across ~120–280 titles blowing past Edge timeouts — we now overlay strictly from cache, which warms over time from detail-page + other-strip `predict_cached` writes. Client keeps legacy fallbacks (`recommendations_only` + `predict_cached`, and `full` with `omitStripRecs`) so new clients hitting an older Edge continue to work.

## 4.0.6

- **Your Picks is now page-local** — no more borrowing from In Theaters / Streaming / Pulse pools. The 🔥 For you + ✨ Worth a Look strips source exclusively from `recommendations_only` (`recommendations` + `worthALookRecs`) with a page-local `predict_cached` overlay applied on top, matching the pattern Pulse / In Theaters / Streaming already use. The overlay fills in `neighborCount` on rows where `match_recommendations_from_neighbors` returned a TMDB popularity fallback (thin `user_neighbors` / new account), so the blue predicted badge now renders on every row that has a cached per-title prediction.
- **Per-page predict gating (perf).** Every `predict_cached` strip call is now scoped to the screen that actually renders it: `theaterRecs` / `inTheatersPagePopularRecs` → `/in-theaters`; `whatsHotRecs` / `secondaryRecs` → `/home`; `pulseTrendingRecs` / `pulsePopularRecs` → `/pulse`; `streamingMovieRecs` / `streamingTvRecs` → `/streaming-page`; `recommendations_only` + `yourPicksPredictions` → `/your-picks`. Eliminates ~5 unrelated sequential round-trips per route change (Your Picks landing used to wait on theaters + in-theaters popular + what's hot + pulse trending + pulse popular + secondary before firing its own predict). Non-active routes resolve from TMDB fallbacks exactly as before.
- **Bounded Your Picks `predict_cached` set.** The `predict_cached` overlay now runs on just the IDs `recommendations_only` actually returned (~120–280 titles) instead of a speculative top-500 catalogue slice — cold-cache paths were pushing the Edge function into timeout territory on first load. The two Your Picks round-trips run sequentially (CF recs first, then the bounded predict_cached), which is both reliable and cheap.
- **Predicted rows first in For you / Worth a Look.** 🔥 For you and ✨ Worth a Look now partition by prediction quality: **rows with `neighborCount ≥ 1` (blue pill) always render before TMDB-only fallback rows**, even when the fallback has a higher `predicted` score. Each partition is sorted by `predicted` desc. Strip rotation (`topPickOffset` / refresh) cycles within each partition independently so blue pills stay at the top across refreshes.

## 4.0.5

- **Your Picks page:** Primary nav opens a dedicated screen with **🔥 For you** (refreshable via the offset button) and **✨ Worth a Look**, using the same CF + worth-a-look + provider-aware strip builder the Home segment used. No new match / Edge changes—CF `recommendations` and `worthALookRecs` come from the existing `recommendations_only` path; streaming and theater rec pools already on `matchData` backfill as before.
- **Home simplification:** Dropped the Home secondary nav (Now Playing / Your picks / Friends). Home now renders the Now Playing shelves only—Your Picks moved to its own page and Friends is deferred (Circles covers the social surface).

## 4.0.4

- **Streaming page:** Primary nav opens a dedicated **Streaming** screen with two strips over the same US subscription-style pool—**Now Streaming** (newest release / air-date order) and **What’s popular in streaming** (TMDB popularity order)—gated by a Series/Movies toggle. `predict_cached` scores overlay both strips on this route only; fetch and strip predictions no longer run from Home. Home **Now Playing** keeps What’s hot (+ optional Region block); empty-state logic no longer depends on the removed streaming strip.

## 4.0.3

- **In Theaters page:** Primary nav opens a dedicated screen with **Now Playing** (newest US limited/theatrical releases first) and **Popular in theaters** (same gated pool, TMDB popularity order)—both strips use `movie/now_playing` + US release-type window + `predict_cached` (order preserved). The duplicate theatrical block is removed from Home **Now Playing**; What’s hot / Streaming / Region unchanged. `?detail=` deep links work from this screen.

## 4.0.2

- **Pulse:** Dedicated Pulse screen with TMDB week **Trending** and **Popular** (movies + TV), `predict_cached` scores overlaid without reordering strips (TMDB order preserved). Pulse routes from primary nav; Home no longer masquerades as Pulse in the menu.

## 4.0.1

- **Primary navigation:** Replaced the hamburger drawer with a TMDB-style fixed top bar (wordmark, horizontal section links, Discover shortcut). Narrow viewports scroll links horizontally. Circles placeholder copy updated to a “something exciting…” teaser.

## 4.0.0

- **Page architecture scaffold (Step 0):** Added top-left hamburger navigation and shifted bottom fixed bar to Mood/Profile quick access. Introduced shell screens for Circles, In Theaters, Streaming, Your Picks, and conditional Secondary Region, while keeping the existing Home implementation intact as the Pulse baseline during migration.

## 3.5.6

- **For you / Worth a look reliability path:** Added `match` action `recommendations_only` backed by SQL RPC `match_recommendations_from_neighbors`, so home now fetches lightweight recommendation rows without loading full neighbor rating maps in Edge. Client keeps sequential `predict_cached` strip updates and falls back to legacy `full` (`omitStripRecs`) only if the lightweight action fails.

## 3.5.5

- **Home Now Playing — all strips get predictions:** Sequential `predict_cached` runs **In Theaters → What’s hot → streaming movies → streaming TV → secondary region**, then `full` with `omitStripRecs` for **For you** / **Worth a look** + catalogue CF. `matchData` adds `whatsHotRecs` and `secondaryRecs` for strip parity with TMDB fallbacks until each batch returns.

## 3.5.4

- **`match` `full` + home:** Optional body flag `omitStripRecs: true` skips recomputing In Theaters / streaming strip scores (client already has them from `predict_cached`). Response carries `recommendations` and `worthALookRecs` only; the app merges into existing `matchData`.

## 3.5.3

- **Home: strip-by-strip predictions before full:** The app runs batch `predict_cached` **in order** — In Theaters → streaming movies → streaming TV — merging each strip as its response returns, then calls `match` `full` for recommendations, worth-a-look, and a consistent full payload. If `full` fails, previously merged strip scores are kept when present.

## 3.5.2

- **Predicted badge correctness:** Personal blue badges now require real neighbor evidence (`neighborCount >= 1`) on strip, Discover, and Mood cards. Titles falling back to TMDB/Cinemastro no longer appear as personal predictions, matching detail-screen behavior.

## 3.5.1

- **Badge priority + color clarity:** Card badges now prioritize **your predicted score** (when present) over Cinemastro/TMDB crowd scores, while still keeping **your own rating** highest priority. Predicted badges use a distinct blue treatment across home strips, Discover, and Mood results; Cinemastro stays gold and rated stays green.

## 3.5.0

- **Two-function neighbor architecture:** Added `public.user_neighbors` storage + new `compute-neighbors` Edge Function to precompute cosine neighbors offline. Seed subjects are excluded using `profiles.name` (`seed%`), while seed accounts may still appear as neighbors.
- **Faster detail predict:** `match` now reads precomputed neighbors, and detail predict uses SQL RPC `match_predict_neighbor_raters` (neighbors ∩ title raters) instead of heavy runtime neighbor scans. Added optional `ratings (media_type, tmdb_id, user_id)` index migration for large-title performance.
- **Safer prediction behavior:** `match` keeps the no-fabrication rule (`prediction: null` when no real neighbor raters). Read floor aligns with stored neighbors (`0.10`), and prediction cache model version bumps to avoid stale null carryover.
- **On-rating neighbor refresh (deferred):** App now schedules `compute-neighbors` after successful rating writes, but defers execution while onboarding/rate-more/loading flows are active so a batch of onboarding ratings triggers one recompute at the end.

## 3.4.4

- **Predict contributor retention (target merge):** For detail `predict` requests, `match` now explicitly fetches the requested title's ratings for selected top neighbors and merges them into neighbor maps before scoring. This avoids losing target-title contributors to full-map paging limits and improves real prediction hit rate for titles with known overlap.

## 3.4.3

- **Predict candidate composition fix:** For detail `predict` requests, `match` now builds the overlap candidate pool by first including overlap users who already rated the requested target title, then filling the remaining slots with top overlap users. This prevents target-raters from being dropped before candidate slicing and improves real neighbor-backed prediction hit rate without changing TBD behavior when no contributors exist.

## 3.4.2

- **Predict reliability (target-aware neighbor selection):** `match` now uses larger, deterministic candidate windows for detail `predict` requests and prioritizes candidate users who already rated the requested title before final similarity ranking. This improves real neighbor-backed predictions for established users without fabricating a personal score when neighbor evidence is absent.

## 3.4.1

- **Match auth hardening:** `invokeMatch` now validates that the session token looks like a Supabase access token before calling the `match` Edge Function. If a provider token shape is detected, it attempts a session refresh and fails fast with a clear client error instead of sending unsupported JWT algorithms to Edge.

## 3.4.0

- **Title detail cards (copy + clarity):** Left card label is now **For you** in all states. In predicted state, the range and confidence move to compact chips (**`low–high`** + **High/Medium/Low**) and the long tastometer sentence is removed. **TBD** helper text is shortened to **“Rate more to predict.”**
- **Prediction CTA wording:** Predicted-state action text is now confidence-aware — **High:** “Rate more”, **Medium/Low:** “Rate to refine”.
- **Community card labels:** Removed the generic **Crowd** label. Right card now titles by source: **TMDB Score** (TMDB fallback) or **Cinemastro** (community score). Cinemastro subtext is **“TMDB-based”**; TMDB fallback no longer repeats a redundant sublabel.

## 3.3.0

- **Title detail (layout):** **Backdrop hero** with **poster** overlapped on the **lower right**, aligned with the **title** row. **Year** + **type** chips and optional **tagline** (TMDB `tagline` via detail fetch). **No** runtime or certification yet.
- **Title detail (scores):** **Two cards** — **You** (saved rating, or predicted + confidence / range, or **TBD** + rate-more cue) and **Crowd** (**Cinemastro** with meter when available, else **TMDB**). Previous stacked community + prediction blocks removed in favor of this row.

## 3.2.1

- **Title detail:** Opening a title **no longer waits** on the Edge **`predict`** call before navigation. The screen switches immediately; the **“Predicted rating for you”** block shows a **strip-style skeleton** (shimmer) until the prediction returns or fails, then shows the real score or **TBD**.

## 3.2.0

- **Rate now (title detail):** Suggested titles come from **neighbor overlap** (`public.ratings`) even when those titles are **not** in the main CF catalogue. Candidates are ranked the same way as before (overlap count + neighbor avg score + same–media-type boost); **TMDB detail** hydrates metadata for ids missing locally. **Animation** is still excluded after hydrate. **Catalogue-only** popularity fallback unchanged when overlap yields no queue.

## 3.1.2

- **Discover search:** **Clear** control (**×**) appears when the search field is not empty; one tap clears the query and results so you can start a new title without deleting character by character. Input is refocused after clear.

## 3.1.0

- **Cinemastro vote weight (v3.1.0):** RPC **`get_cinemastro_title_avgs`** now returns **`rating_count`** per title alongside **`avg_score`**. Home strips, Discover, mood posters, and title detail show a **gold underline meter** (tiered fill: 0–49, 50–200, 200–500, 500–1500, 1500–3500, 3500–5000 ratings). **No line** when there is no community row; **outline-only / 0% fill** for the lowest tier. Apply **`20260418120000_get_cinemastro_title_avgs_rating_count.sql`** on Supabase (includes **`statement_timeout`** on the function for large `ratings` tables).
- **Safari tab resume:** **`TOKEN_REFRESHED`** no longer calls **`setUser`**, avoiding unnecessary **match** refetch and “main refreshed” feel when switching back to the tab.

## 3.0.0

- **Community score (Cinemastro vs TMDB):** Batch RPC **`get_cinemastro_title_avgs`** returns average **`public.ratings`** score per title (no count shown). **Home strips**, **Discover** cards, and **mood results** badges prefer **Cinemastro** when data exists; otherwise **TMDB**, then predicted. **Cinemastro** uses the same pill as TMDB with a **subtle gold border** (Option B). **Title detail** shows one community block (**Cinemastro** or **TMDB**, labeled); **predicted for you** unchanged. Apply the migration in Supabase before shipping the client.

## 2.1.1

- **Title detail (mobile):** Horizontal layout now follows the same **20px + safe-area** gutters as home **strips** and **section headers** — poster is **slightly inset** with rounded corners; body copy and controls align to the same edge. Desktop (≥900px) layout unchanged.

## 2.1.0

- **Navigation / Safari:** Title **detail** and **legal** overlays now use **distinct URLs** (`?detail=movie-769`, `?legal=privacy`, etc.) on `history.pushState` so **iOS edge swipe** and **Mac trackpad back** can pop the overlay reliably (same-URL `pushState` worked with toolbar ← but not gestures). **Go home** and in-app back when no stack entry use **`replaceState`** to strip those query keys. **Cold loads** with `?detail=` or `?legal=` open the right screen once the user reaches a main surface (home / discover / profile / rated / mood results) and the title resolves from catalogue + strips.

## 2.0.8

- **Your picks / Worth a Look:** When **streaming providers** are selected in Profile, **Worth a Look** (strip 2) no longer receives titles that **are** on those services. The earlier TMDB flatrate pass was correct, but **top-up** and **rebalance** filled strip 2 from the scored pool **without** re-checking providers; rebalance could also move an **on-service** title from **For you** into strip 2. Strip 2 growth now uses **`topUpYourPicksStripsRespectingStreaming`** (provider-aware top-up + off-service-only rebalance).

## 2.0.7

- **Your picks (For you / Worth a Look):** **Pick** vs **Popular** shown as **icon-only** pills (**✨** / **📈**) on the **lower-left** of the poster (same dark pill treatment as the score on the lower-right). Loading skeleton uses a small placeholder in that corner instead of a text line below the title.

## 2.0.6

- **Home strips (Now Playing + Your picks):** Removed per-card **predicted low–high range** and **confidence** lines. The **poster badge** still shows the single score (or your rating); **range and confidence** remain on **title detail** only.

## 2.0.5

- **Title detail:** **Predicted rating for you** (numeric + range) only when **`neighborCount` ≥ 1** — i.e. a real neighbour-based score from `match`. If the only signal is the TMDB fallback (`neighborCount` 0), show **TMDB Average Rating** + **TBD** / **Rate more titles to unlock** instead of reusing TMDB as “predicted for you.”

## 2.0.4

- **Your picks badges:** **✨ Pick** again uses only the strict **`match` `recommendations`** (CF neighbour list). Unioning worth-a-look / theater / streaming ids made **every** strip row a Pick.

## 2.0.3

- **Match / Edge auth:** `invokeMatch` now **refreshes the session** when the access token is missing/expiring soon and **retries once** after a **401** from the `match` function. Stale `getSession()` tokens often caused **Invalid JWT** at the Edge gateway and inside `getUser()`.

## 2.0.2

- **Your picks badges:** **✨ Pick** if the title id appears in **any** Edge `match` rec list (`recommendations`, `worthALookRecs`, `theaterRecs`, `streamingMovieRecs`, `streamingTvRecs`). **📈 Popular** only for **client `tmdbOnlyRec`** rows when the server did not return that pool. (v2.0.1 used `neighborCount` ≥ 1, but the Edge function often emits **0** when `predictRatingRange` has no per-title overlap, so everything looked Popular.)

## 2.0.1

- **Your picks badges:** **✨ Pick** now means either the strict **`match` `recommendations`** list **or** any title with **neighbor-based scores** (`neighborCount` ≥ 1). **📈 Popular** is reserved for **TMDB-only** filler rows with **no** neighbor overlap. IDs for the CF list use **`mediaIdKey`** so labels stay correct after JSON. (Earlier 2.0.0 logic labeled most neighbor-scored strips as Popular because only the small `recommendations` array counted as Pick.)

## 2.0.0

- **Your picks (For you / Worth a Look):** Row badges distinguish **✨ Pick** (titles in **`match` `recommendations`** — collaborative picks) from **📈 Popular** (worth-a-look / theater / streaming / pad pool scored rows not in that CF list).

## 1.3.11

- **Your picks:** **Strip source** is now CF **`recommendations` first**, then **worth-a-look + theater + streaming** predictions **deduped**, so a small CF list no longer **replaces** a larger pre-match pool (fixes **full row for a moment then only a couple of cards**). **`match`** optional arrays use a **stable empty reference** (`EMPTY_MATCH_RECS`) so memos/effects are not retriggered every render when data is missing.

## 1.3.10

- **Your picks:** With **streaming providers** selected, **For you** first keeps titles on those services, then **pads to the row cap** with the next-best predictions from the same scored list (so the strip is not stuck at 1–2 cards when few catalogue titles match the provider filter). **`topUpYourPicksStrips`** now grows **partial** strips toward caps, not only empty ones.

## 1.3.9

- **Build:** `topUpYourPicksStrips` reassigned `strip1Recs` / `strip2` after `const` declarations; switched to **`let`** so **`npm run build`** (Vite / Rolldown) succeeds on Vercel.

## 1.3.8

- **Your picks — For you / Worth a Look:** Strips stay populated from the same **`match`** scored pools when strict CF **`recommendations`** is empty: merged **worth-a-look + theater + streaming** predictions, **`topUpYourPicksStrips`** so a strip is not left empty when data exists, and a **Refresh** control whenever any strip source exists. Cards show **predicted range** (low–high) and a short **confidence** line.
- **Edge `match`:** **`worthALookRecs`** catalogue buffer increased (**30 → 48**) for client de-dupe / filters. Comments document optional tuning of **neighbor / overlap fetch caps** if results are still insufficient (tradeoff: DB + latency).

## 1.3.7

- **iPhone / slow networks:** Initial catalogue bootstrap uses **2 TMDB calls** (movie + TV **popular** only) so **sign-in and first route** unblock sooner; **top_rated** lists load **in the background** and merge into `catalogue` / `obCatalogue`.
- **Fonts:** Google Fonts load from **`index.html`** with **preconnect** (removed `@import` from the giant inline style block) so text styling can start earlier and the main thread does less work during hydration.
- **Code splitting:** Legal pages (**Privacy / Terms / About**) are **`React.lazy`**-loaded; **`AppFooter`** lives in **`src/appFooter.jsx`** so the lazy chunk is not pulled into the main bundle.
- **Home streaming strip:** Fetch starts after a **short defer** (with **ready** flags cleared immediately so skeletons show) so the first TMDB wave isn’t competing with catalogue bootstrap on cellular.

## 1.3.6

- **Post-login / cold load:** First catalogue bootstrap is tracked explicitly (`catalogueBootstrapDone`) with a **~22s safety timer** so users are **not stuck** on **“Loading Cinemastro…”** if TMDB never returns. Returning users can reach **Home** even when the catalogue array is still empty after a failed fetch; new users on **pref-primary** see **try again** instead of an endless “Loading catalogue…”.
- **Loading screen:** After **10s** on the post-login loading screen, a short **slow-network** hint is shown.
- **Mobile-friendly sequencing:** **What’s hot** and **secondary Region** TMDB fetches start after a **brief defer** so sign-in routing and first paint are less likely to compete with that work on slow devices.

## 1.3.5

- **Auth (Sign in / Sign up / Forgot password / Update password):** If a Supabase auth call **throws** (e.g. flaky network on mobile Safari), the primary button no longer stays stuck on **“Please wait…”** — loading state is cleared in **`finally`**, and a short error message is shown when the request fails unexpectedly.

## 1.3.4

- **Your picks + secondary region:** When a **home secondary region** is set in Profile, **For you** / **Worth a Look** (`match` catalogue) now **includes** titles from that secondary market even if **Regions to show** would exclude them (e.g. Hollywood-only regions + Indian secondary). **Genres to show** still applies to those adds. No secondary selected → unchanged behavior.

## 1.3.3

- **Secondary Region block:** Removed **Load more**; each tab (**In Theaters**, **Streaming → Series/Movies**) shows at most **25** titles. TMDB secondary fetches now target up to 25 per pool so the strip can fill when data exists.

## 1.3.2

- **Secondary Region row (Now Playing):** **In Theaters** and **Streaming** top-level tabs; under Streaming, **Series** and **Movies** (same pattern as the primary Streaming block). Removed per-poster “In theaters” pills — the tab indicates context. Catalogue still unions all fetched titles for ratings / detail.

## 1.3.1

- **“In theaters” pill:** TMDB `now_playing` can still list older titles while metadata shows the original year (e.g. 2014). The pill now requires **plausibly current** release metadata (calendar year within two years of today, and full `release_date` not more than ~two years in the past). Applies to **What’s hot** and the **secondary Region** strip.

## 1.3.0

- **V1.3.0 — Home “second region” strip:** Hollywood / US remains primary for In Theaters, What’s hot, and Streaming. Profile adds **optional single secondary** (`profiles.secondary_region_key`: indian | asian | latam | european). When set, **Now Playing** shows a fourth block titled **Indian / Asian / Latin · Iberian / European** with meta **Theaters & streaming**: merged **theatrical + streaming movies + TV** for that TMDB market (parallel fetch, theaters-first merge, up to **40** titles, **20** visible then **Load more**). Cards use the same small **In theaters** pill as What’s hot when the title is in that market’s theatrical list.
- **DB:** New column `profiles.secondary_region_key` (see `supabase/migrations/20260410120000_profiles_secondary_region_key.sql`).

## 1.2.28

- **Now Playing → What’s hot:** New row **between In Theaters and Streaming** with TMDB **trending movie + TV (day)**, interleaved (~18 titles). Titles are **not** removed just because they also appear in theaters or streaming — overlap is shown with a small **In theaters** pill when a card matches the current **In Theaters** list. Gives users something to scroll while the streaming strip finishes loading.

## 1.2.27

- **Strip & Discover (movies):** When TMDB provides a full `release_date`, home strips and Discover now show a readable **release date** (e.g. `Apr 10, 2026`) instead of year only; year remains the fallback when no full date exists.

## 1.2.26

- **Now Playing → Streaming (Movies):** When TMDB digital discover returns no rows (strict `with_release_type=4`, date window, or profile language filters), the app now falls back in order: same query without language filter, broader discover without release-type in the same date window, then **trending movies (week)** so the strip stays populated.

## 1.2.25

- **Now Playing → Streaming:** Digital-release movie strip now uses `primary_release_date` through **today** (was capped at ~46 days ago), so fast-to-streaming titles are included and the row is less likely to be empty.
- **Now Playing → Streaming tabs:** **Series** is the default tab and appears first; **Movies** second.

## 1.2.24

- **Loading UX polish:** Added shimmering strip skeleton placeholders so recommendation rows are visible immediately while data is loading, instead of showing blank space.
- **Your picks responsiveness:** Low-latency placeholders now render for both **For you** and **Worth a Look** while match/provider work is in flight.
- **Now Playing streaming row:** Movies/Series loading states now use strip skeletons for smoother perceived performance.

## 1.2.23

- **Rate now return path:** After using **Rate now** from a title’s detail prediction card, completing or exiting the rating flow now returns users to that same detail page (context-preserving) instead of redirecting to Your picks. Generic “Rate More Titles” entry points keep returning home.

## 1.2.22

- **Confidence follow-up action:** Detail cards with **low/medium confidence** now show **“Rate more titles to improve”** plus a **Rate now** CTA. Tapping it opens a focused rating flow titled **“Rate Similar titles.”**
- **Neighbor-overlap title queue:** The Rate now queue is now built from collaborative overlap around the current title: find users who rated that title, gather what else they rated, rank unseen candidates by overlap strength (with same-type boost), and surface those first; falls back to popular unseen titles when overlap is sparse.

## 1.2.21

- **Your picks strips:** When **For you** or **Worth a Look** is short of the row cap, **backfill** from **unrated popular** catalogue titles (`appendPopularRows`). **No streaming providers:** append by popularity until 15 / 20. **With providers:** strip 1 only adds popular titles that **stream on selected services**; strip 2 only adds popular titles **not** on those services (same rule as CF Worth a Look). Rows carry **`kind`**: **✨ Pick** (CF / server-scored pool) vs **📈 Popular** (popularity filler), with compact styles and `aria-label` on cards.

## 1.2.20

- **Your picks → Worth a Look:** When CF **`recommendations`** is shorter than the first strip (e.g. only a handful of neighbors), strip 2 was often empty. **Backfill** from Edge **`worthALookRecs`** (same `MORE_TAB_OFF_SERVICE_PRED_MIN` floor, deduped) up to **20** titles. **No streaming providers:** merge immediately. **With providers:** after scoring strip 2 from CF, continue through **`worthALookRecs`** with the same TMDB “not on selected services” rule until full or exhausted.

## 1.2.19

- **Your picks loading UX:** Track **`match`** in-flight (`matchLoading`) and TMDB watch-provider resolution for More strips (`moreStripsLoading`). When both strips are still empty, show **“Loading recommendations…”** or **“Checking where titles stream for your picks…”** instead of the **Rate more titles** empty state. Match invoke clears loading in **`finally`**; effect cleanup clears loading when deps change. Provider-based strip rebuild uses **`try`/`finally`** so loading always clears.

## 1.2.18

- **Tastometer copy:** Detail prediction subtitle **“Based on your tastometer”** (replaces taste-match count). Onboarding: **“Creating your tastometer.”** Post-onboarding load: **“Using your tastometer to predict”** with **“Scoring titles for you.”**

## 1.2.17

- **Home segments (internal):** Rename state ids from legacy `picks` / `more` to `nowPlaying` / `yourPicks` (with named constants) so code matches **Now Playing** / **Your picks** tab labels; rename header helper class to `home-header--no-hero-tagline`. ESLint: optional `catch` binding in `openDetail`.

## 1.2.16

- **More → Your picks:** Raise on-service cap to **15**. When provider-filtered CF leaves gaps, **backfill** from theater + home streaming strips + worth-a-look candidates with **predicted ≥ 6.5** that still match the user’s selected streaming providers (deduped, sorted by prediction).

## 1.2.15

- **Home streaming strip:** Fetches a **broad** US streaming pool (same TMDB paths as before). It does **not** use profile **streaming provider** selection and no longer **re-fetches** when those providers change — personalization by provider stays on **More → Your picks**. Home label updated to reflect this.

## 1.2.14

- **More tab:** First strip (**Your picks**) shows collaborative picks that stream on the user’s **selected** subscription providers (when set); falls back to top CF picks if none match. Second strip (**Worth a Look**) shows other **high-predicted** CF titles **not** on those providers (or beyond the first strip when no providers are selected). Cold start with no CF still uses popularity fallback for the first strip.

## 1.2.13

- **Discover recency sort:** Sort Discover results by release year descending so newer titles appear first; entries without a year remain at the end.
- **Discover All breadth:** Keep the full two-page fetch on **All** (up to 40 movies + 40 TV) instead of trimming the blended list.

## 1.2.12

- **Discover search depth:** Merge two TMDB search pages per medium (deduped by id) so titles ranked past the first ~10–20 can appear. **All** now shows up to **20 movies + 20 TV** (was 10+10). **Movies** / **TV Shows** show up to **40** from the merged pages. Failed TMDB responses show a clear message instead of looking like “no results.”

## 1.2.11

- **Home streaming load UX:** Fetch streaming movies and series in two phases so movies can render first; show per-tab “Loading…” until each phase completes; only show the global “Couldn’t load picks” state after both phases finish with no titles (avoids false errors while TV is still loading).

## 1.2.1

- **Mood era options:** Added `Modern (3–15 years)` to the vibe card and renamed classic copy to `Classic (15+ years)` to match actual logic.
- **Deterministic era precedence:** Mood date filters now resolve predictably as `Modern` > `Just released / Last 3 years` > `Classic`, preventing conflicting selections from producing ambiguous windows.

## 1.2.0

- **Mood relevance and clarity:** Added `Animation & Anime` as an explicit mood opt-in while keeping animation excluded by default. Tightened **Critically acclaimed** with an absolute `vote_count >= 200` floor to avoid low-sample titles.
- **Prediction display polish:** Normalized predicted scores and ranges to one decimal place across Home, Mood, Discover, and Detail views.

## 1.1.9

- **Mood animation opt-in:** Add a dedicated **Animation & Anime** vibe chip. Mood keeps animation excluded by default, but selecting this chip lifts the genre-16 exclusion for that mood run (including fallback discover fetches). Family-friendly remains a separate intent.

## 1.1.8

- **Default animation exclusion:** Exclude TMDB Animation genre (`16`) across core selection surfaces (home catalogue strips, in-theaters, streaming, onboarding regional picks, and mood discover). Discover search now also excludes animation by default; animation-intent queries (e.g. "anime", "cartoon", "animation") switch to animation-only results.

## 1.1.7

- **Mood classic ranking:** Add classic-specific edge ranking on top of the 15+ year TMDB pool. Classics now prioritize top-quality titles (top ~15% TMDB vote average in the candidate set), require stronger vote-count validation, and boost "foundational" picks when many nearest neighbors rate them highly.

## 1.1.6

- **Mood acclaimed vs hidden logic:** Pass selected vibes into the Edge `match` mood action and rank candidates differently by vibe using neighbor counts + TMDB vote stats. **Critically acclaimed** now favors broadly validated titles (higher neighbor support / vote-count strength), while **Hidden gem** favors high-quality, lower-exposure picks (1-2 neighbor loves + lower vote-count percentile).

## 1.1.5

- **Mood quick watch:** When only **Quick watch** is selected (or combined with **Critically acclaimed**), use `sort_by=vote_average.desc` and a `vote_count` floor so TMDB ordering diverges from **Critically acclaimed** alone (`popularity.desc` + `vote_average.gte`), which often returned the same top picks for sub‑105‑minute blockbusters.

## 1.1.4

- **Mood fine-tune:** Wire **Hidden gem** and **Quick watch** to TMDB discover (`sort_by=popularity.asc` + `vote_average` / `vote_count` floors for hidden; `with_runtime.lte` for short). Previously hidden had no effect, so it often matched **Critically acclaimed** (popularity + `vote_average.gte` only).

## 1.1.3

- **Mood genre step:** Stop pre-selecting chips from profile `show_genre_ids` when opening Mood, so the genre card starts empty like region and fine-tune—only explicit taps count.

## 1.1.2

- **Home scrollport (iOS):** Make `.app` a column flex container and give `.home` `flex: 1 1 0` with `min-height: 0` so the main feed forms a bounded vertical scroller inside the fixed viewport shell (matching Mood/Profile behavior).

## 1.1.1

- **Discover mobile parity:** Keep Discover as a full-height in-shell vertical scroller so mobile can reach the full result list consistently after search focus and results load.

## 1.1.0

- **iOS viewport expansion hardening:** Added a fixed `viewport-shell` wrapper so visual viewport shifts cannot expand the app beyond intended mobile width.
- **Input-focus stability:** Enforced iOS-safe form control sizing/text behavior (`text-size-adjust` + 16px controls) and updated auth/search input styling so focusing fields does not trigger persistent layout expansion.
- **Discover-specific fix:** Raised `.search-input` to 16px with native appearance reset to stop Safari focus expansion on Discover/Rated search bars.

## 1.0.37

- **iOS overflow hardening (drift recovery):** Keep intentional horizontal scrollers (`.strip`, `.filter-row`) but aggressively re-clamp page viewport X back to `0` after touch/scroll/resize/pageshow and key screen transitions. Fixes cases where Safari remained shifted to the right even after the earlier gesture-blocking fix.

## 1.0.36

- **Root-cause iOS overflow resolution:** Replace continuous scroll-clamp workaround with gesture-level prevention. Horizontal touch gestures are now blocked at page level and only allowed inside intentional x-scrollers (`.strip`, `.filter-row`). This prevents Safari viewport drift while preserving horizontal card/chip scrolling.

## 1.0.35

- **iOS overflow lock (continuous):** Add runtime horizontal-scroll clamp listeners (`scroll`, `touchmove`, `touchend`, `resize`) that force viewport/document `scrollLeft` back to `0`. This prevents persistent sideways drift on landing/home after Safari gesture bounce.

## 1.0.34

- **Safari drift clamp:** Add a UI-transition fail-safe that resets horizontal scroll (`window/document x=0`) on screen/search/home-segment changes. Prevents persistent left/right viewport shift after gestures, especially around Discover/Home transitions on iOS Safari.

## 1.0.33

- **Discover search trigger:** Results now fetch only on explicit submit (tap search icon or keyboard Search/Enter), not while typing. Added submitted-query state and search form button; status/empty messages now reference submitted query.

## 1.0.32

- **Stabilization rollback:** Revert v1.0.31 Discover grid tweak (`repeat(minmax)` + forced card width) after regression reports on Home mobile overflow. Returns Discover grid to prior sizing baseline while preserving earlier global overflow hardening.

## 1.0.31

- **Discover results overflow fix:** Use `grid-template-columns: repeat(2, minmax(0, 1fr))` for mobile Discover results and constrain cards to `width/max-width:100%`. Prevents result columns from expanding horizontally as search results populate.

## 1.0.30

- **Mobile overflow hardening:** Use `overflow-x: clip` (with existing `hidden`) at root/app/screen shells to prevent Safari from retaining sideways viewport drift. Horizontal strip/filter scrolling remains enabled.

## 1.0.29

- **Mobile horizontal-pan lock:** Prevent viewport sideways drag by setting app shell `touch-action: pan-y`; keep intentional horizontal scrolling on strips/filter chips via `touch-action: pan-x`. Fixes Home clipping/drag state where “In Theaters” and top controls appeared partially off-screen.

## 1.0.28

- **Discover typing overflow fix (mobile):** Harden result cards against intrinsic-width growth while typing. `disc-card` now has `min-width:0`; `disc-title` and `disc-meta` hard-wrap long/unbroken text. This prevents horizontal pan when search results appear.

## 1.0.27

- **Mobile overflow (home/login path):** Hide `public-site-stats` inside mobile `home-header` (logo remains). This removes immediate horizontal overflow on login/home without changing desktop stats placement.

## 1.0.26

- **Mobile overflow guard (top bars):** Hide the small **community/ratings** stats block inside mobile `page-topbar` (Discover/Profile/Detail/etc) to avoid Safari width overflows. Logo remains; desktop and home hero behavior unchanged.

## 1.0.25

- **Profile save reliability:** Preference writes now use `update(...).eq(id)` (not upsert) and show an in-app error banner in Profile when a save fails. This makes streaming-provider save failures visible and avoids conflict-path quirks.

## 1.0.24

- **Profile settings save fix:** Revert to **single-field upserts** for streaming/genre/region (DB-only source remains). This avoids stale in-memory payloads accidentally writing `streaming_provider_ids` back to empty.

## 1.0.23

- **Profile sync fix (cross-device):** Preference saves now upsert **all three profile arrays together** (`streaming_provider_ids`, `show_genre_ids`, `show_region_keys`) on every save to prevent partial writes from wiping the other fields.

## 1.0.22

- **Profile settings sync:** Remove localStorage fallback for streaming/genre/region preferences. App now always loads these from `profiles` in Supabase (DB is the single source of truth across devices). Saves still upsert to `profiles`.

## 1.0.21

- **Discover/mobile overflow fix:** Tighten **`page-topbar`** on narrow screens (2-column grid, smaller brand cluster footprint) so entering Discover does not push horizontal pan state across screens. Also hard-wrap **`search-status`** for long queries and enforce `min-width:0` for Discover header/search box.

## 1.0.20

- **Home (mobile):** Picks tagline uses **fluid `font-size`** (`clamp`) so it scales with viewport width; **desktop** tagline unchanged.

## 1.0.19

- **Home (desktop):** Hide **`topbar-brand-cluster`** inside **`home-header`** when **`home-topbar`** is visible — removes duplicate community/ratings next to the tagline. Mobile unchanged (no top home bar).

## 1.0.18

- **Community stats (marketing):** Next to the wordmark in **top bars** and **home hero** — two lines (**community** = `profiles` count, **ratings** = `ratings` row count). Fetched once via Supabase RPC **`get_public_site_stats`** (apply migration **`20260407140000_get_public_site_stats.sql`**). Compact format (e.g. `1.2k`) when large; hidden until first successful load.

## 1.0.17

- **Mobile overflow (follow-up):** Horizontal strips use explicit **`width:100%`** + **`min-width:0`**; **`top-picks-block`** constrained. Section headers use **safe-area padding**; **`section-meta`** is **full-width + `text-align:right`** on narrow screens (was `align-self:flex-end` on a too-wide ancestor). Slightly tighter meta typography. **`overscroll-behavior-x: none`** on `html` / `body` / `#root`. Main shells (`home`, `discover`, `profile`, `mood`, `detail`) get **`width:100%`**.

## 1.0.16

- **Mobile overflow:** Remove **`100vw` / `86vw`** from header and splash logos (use **`%` / `100%`** so sizing tracks the `.app` shell — iOS Safari often treats `100vw` wider than the painted column). **`minmax(0, …)`** on top bar grids, **`min-width: 0`** on home hero / section headers, **`overflow-wrap`** on tagline and section meta, and **bottom nav** centered with **`left:0; right:0`** instead of **`translateX(-50%)`** to avoid subpixel horizontal pan.

## 1.0.15

- **Detail (desktop):** Poster stays **one grid-card wide**; **title, prediction, synopsis, where to watch** use a **wider column** (two Discover cards + gap, same math as `.disc-grid`). **Slider + rating buttons** capped at **380px** centered. Mobile: unchanged full-width flow (rules scoped to `min-width: 900px`).

## 1.0.14

- **Detail (desktop):** Main column matches **one Discover grid card width** (`detail-inner` uses the same `calc` as `.disc-grid` for 4- and 5-column breakpoints). Poster uses **2:3** aspect ratio and card-style border/radius like grid posters. Mobile unchanged.

## 1.0.13

- **Onboarding / rate-more:** Responsive layout — no `flex:1` stretch between card and controls; poster uses **16:9** + **viewport-capped height** (`vh` + `clamp`); card and rating block **max-width** and centered on larger screens; **safe-area** padding; scroll the step on short viewports.

## 1.0.12

- **Onboarding:** **Sign up** with an active session now uses **`loading-catalogue` → pref** (same as sign-in) so the **catalogue is loaded** before cinema prefs; avoids **empty `obMovies`** and a blank rating step. **Continue** is disabled until the catalogue is ready. **Email-confirm-only** signups (no session) show a notice instead of a broken pref screen. Fallback **“Preparing titles…”** if onboarding opens before titles are ready; tighter onboarding metadata checks and try/catch on post-login routing.

## 1.0.11

- **Onboarding:** New accounts that **sign in** (or confirm email then sign in) now get the same flow as immediate sign-up: if onboarding is not finished, load goes to **cinema preference** then ratings. Completion is stored in auth **`user_metadata.onboarding_complete`**; existing users with **at least one saved rating** are treated as already onboarded.

## 1.0.10

- **Auth / recovery:** Password reset for **PKCE**: stop `getSession()` from overwriting the reset screen; route recovery via `PASSWORD_RECOVERY`, URL `?recovery=1` (add this redirect URL in Supabase), and stronger JWT recovery detection. Enter the app from splash/auth only through `onAuthStateChange`.

## 1.0.9

- **Auth / recovery:** Fix **password reset** flow so recovery sessions are not sent straight to the app (JWT `amr` recovery + URL `type=recovery`). After a successful new password, continue into the app. Log **rating save** errors to the console when `upsert` fails.

## 1.0.8

- **Brand / splash:** **`cinemastro-logo.svg`** wordmark and tagline use **centered text** (`text-anchor="middle"`, `x="200"`) so the tagline sits under the title and aligns with centered CTAs; remove splash-only `translateX` workaround in `App.jsx`.

## 1.0.7

- **Splash:** Center the wordmark with the **Get Started** / **Sign In** buttons (splash-only `object-position` + light horizontal nudge; `splash-logo` uses full width for alignment).

## 1.0.6

- **Auth:** Sign-in / sign-up form constrained on **desktop** (`max-width` + centered) so email, password, and primary button are not full viewport width.

## 1.0.5

- **Auth:** **Forgot password** on sign-in (email reset link via Supabase). Recovery links open in-app so the user can set a **new password** before signing in again.

## 1.0.4

- **Home:** Hero tagline (“Movies and Shows - Picked for your TASTE!”) only on **Picks**; **More** and **Friends** show no tagline. Tighter mobile header when tagline is hidden; desktop hides the empty hero strip on More/Friends (wordmark stays in `home-topbar`).

## 1.0.3

- **Footer** on main tabs (above bottom nav): links to **About**, **Privacy**, **Terms**, **Contact** (`mailto` placeholder), **©** line with placeholder legal entity, placeholder site URL, and **TMDB API attribution** (required-style wording + link).
- **Placeholder pages** for Privacy Policy, Terms of Use, and About (`src/legal.jsx`, copy in `src/legalConstants.js`). **Browser Back** returns to the previous screen (history integration like title detail).

## 1.0.2

- **Navigation:** Opening a title from Picks/More/Discover/etc. now **`history.pushState`s** a dedicated step. **Browser Back** returns to that screen inside Cinemastro instead of the previous site in the tab history.

## 1.0.1

- **Title detail screen:** Removed the in-app **← Back** control; exit via browser/OS back (aligned with catalog sites like TMDB).
- **Title detail screen:** Added the same **top bar** as other main tabs — **Cinemastro wordmark** (left) and **account avatar** (right). Poster, title, and body content render **below** that bar.
- **Title detail screen:** Top bar is **sticky** with **safe-area** padding for notched devices; dropped the old centered sticky brand strip and floating back pill (`.detail-sticky-brand`, `.back-btn`).

## 1.0.0

- Initial semver; Profile shows app version from `package.json`.
