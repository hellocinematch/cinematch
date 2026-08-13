# Passdown for next chat (Cinematch)

**Last updated:** 2026-08-13 — trust **`package.json`** / **`CHANGELOG.md`**. **Staging + prod web:** **7.0.82** @ **`90b9b0d`**. **`git pull`** **`origin/main`** **`origin/staging`** **`origin/capacitor/v1`**. **Deep history:** **`PASSDOWN-ARCHIVE.md`**. **Stable product depth:** **`HANDOFF.md`**.

**Recent releases (high level):** **7.0.82** — remove public Beta label; native **email confirm** → `com.cinemastro.app://localhost/` (Safari may ask Open in app). **7.0.81** Beta off / titles. **7.0.76–7.0.80** badge + APNs banners. Earlier — **`CHANGELOG`**.

**Single checklist:** Use **§ Master list (maintained)** below as the one place to track next work (product + ops + analytics). Older § breakdowns were folded into it. **Google Play:** full checklist in **§ Google Play** below (parked until user starts Android).

---

## Tell the next chat (copy from here)

> Cinematch — trust **`package.json`** / **`CHANGELOG.md`**. **Staging + prod web:** **7.0.82** @ **`90b9b0d`**. Routine ships → **`origin/staging`**; push **`main`** only when user explicitly asks. **`git pull`** **`origin/main`** **`origin/staging`** **`origin/capacitor/v1`**. Read **`@PASSDOWN-NEXT-CHAT.md`** + handoff rules. **Don't change app code** unless *code now* / *implement* / *fix* / *do it*.
>
> **CRITICAL — local `.env`:** Often left on **PROD** after native archives. **Switch back to staging** before any staging native build. Native **`npm run build:app`** bakes `.env` at build time.
>
> **Git / Vercel:** Web → **`origin/staging`** (routine) / **`origin/main`** (prod, when asked). App Store / Play = separate upload. **Prod + staging Vercel:** **`APPLE_TEAM_ID=ADXNR3G5F8`**. AASA live.
>
> **Hosted DB:** **staging ≠ prod** Supabase. **`device_push_tokens`** + **`push-circle-badge` `1.1.0`** + **`APNS_*`** + Auth redirects **`com.cinemastro.app://localhost/`** (+ recovery) on both.
>
> **App Store:** **Submitted for review** (2026-08-12). Listing = private Circles / groups positioning; US-only availability; **$0.00**; App Privacy published; age rating kept **13+** (content) while privacy copy still mentions 18+. Demo **`apple.review@…`** (recreated fresh — do not onboard). Local Xcode: **iPhone-only** (`TARGETED_DEVICE_FAMILY = 1`), Build ~**14**. Watch ASC / email for Apple.
>
> **Google Play:** **Not started.** Full phased checklist in **`PASSDOWN-NEXT-CHAT.md` § Google Play** — signing/AAB → internal test → listing/Data safety → US production; optional FCM later. ~2–3 days min without push parity.
>
> **`pg_net` / compute-neighbors:** **`COMPUTE-NEIGHBORS-CRON.md`** — scale **`jobs × limit`** as MAU grows.
>
> **Master list (product):** **1a–1e** CF diversity; **§1f** circle strips; **§1g.1** Discover transliteration; **P2** US geo.

---

## Snapshot (read this first)

| Item | State |
|------|-------|
| **Web app (staging)** | **7.0.82** **`90b9b0d`** — Beta label off; native email-confirm redirect. |
| **Web app (prod)** | **7.0.82** **`90b9b0d`** — **www.cinemastro.com**. |
| **Native app** | **Capacitor 8**, **`com.cinemastro.app`**, **iPhone-only**. Push + badge + banners. Local Build ~**14**. |
| **Apple / App Store** | **Submitted** (Waiting for Review). Org **Cinemastro LLC** / Team **ADXNR3G5F8**. |
| **Google Play** | Not started — see **§ Google Play** checklist. |
| **Supabase auth** | Staging + prod: site URLs + **`com.cinemastro.app://localhost/`** (+ recovery); signup confirm uses same scheme on native. |
| **Supabase** | Separate staging/prod projects. **`device_push_tokens`** + push RPCs on both. |
| **Edge** | **`push-circle-badge` `1.1.0`** (+ invite suite, match, compute-neighbors, pulse-catalog). Bump version + redeploy on change. |
| **Client deploy** | **Vercel** (web); native = Xcode / Play (not Vercel). |

**Where detail lives:** **`HANDOFF.md`**, **`CHANGELOG.md`**, **`PASSDOWN-ARCHIVE.md`**.

---

## Capacitor native app (§30 — shipped to staging + prod web; TF internal)

*Bundled shell; backend = whatever **`.env`** was at **`npm run build:app`**.*

**Shipped (through **7.0.82**, `90b9b0d`; `main` / `staging` aligned):**

- **Capacitor 8** — **`com.cinemastro.app`**, **iPhone-only**, safe areas, strip scroll, auth deep links, email confirm → app scheme, universal **`/join`**, icons, export-compliance plist flag.
- **Badge Phase 1 (7.0.76):** **`@capawesome/capacitor-badge`** — icon = sum of circle unseen; clear on sign-out.
- **Badge Phase 2 (7.0.78–7.0.79):** APNs via **`push-circle-badge`**; **`device_push_tokens`**; **AppDelegate** APNs token handoff (required).
- **Banners (7.0.80):** publish → alert (circle name + “Someone shared a rating.”) + badge + sound; unpublish → badge only; tap → open circle.

**Local dev / re-archive:**

```bash
cd "<repo>"
git checkout staging
# .env MUST match intended backend:
#   staging: VITE_PUBLIC_SITE_URL=https://cinematch-staging-nine-sigma.vercel.app
#   prod:    VITE_PUBLIC_SITE_URL=https://www.cinemastro.com
npm run build:app && open ios/App/App.xcodeproj
# Archive: Any iOS Device → Product → Archive → Distribute → Upload
# Bump Build each upload; upload the NEW archive (Organizer keeps old build #s)
```

**Next engineering (ordered):**

- [x] **App Store** — submitted 2026-08-12 (watch review).
- [ ] **Restore staging `.env`** after prod native bakes.
- [ ] **Google Play** — follow **§ Google Play** below when user starts Android.
- [ ] **External TestFlight** (optional).
- [ ] Optional: staging bundle id variant to run staging+prod side-by-side (not set up).

**Parked / discussed:** Anonymous non-circle “new rating on Cinemastro” pushes; Web Push-only PWA; simplified app icon mark (Option B); OAuth / phone for multi-account (user OK with email for now on mobile).

---

## Google Play (parked checklist — start when user asks)

*Capacitor Android scaffold exists (`com.cinemastro.app`). Push today is APNs-first; FCM optional for parity. Min path ~**2–3 days** without push; +FCM ~**4–6 days**.*

### Phase 0 — Prep
- [ ] Prod vs staging `.env` discipline (bake decides backend)
- [ ] Play Console account + app record: **Cinemastro**, **`com.cinemastro.app`**, Free, **US**
- [ ] Create app in Play Console if missing

### Phase 1 — Signing & build (required)
- [ ] Create **upload keystore**; back up passwords/alias
- [ ] Wire release signing in Android Gradle
- [ ] Set **`ANDROID_SHA256_FINGERPRINT`** (release) on **prod + staging** Vercel for `/join` App Links
- [ ] Prod `.env` → **`npm run build:app`**
- [ ] Build **release AAB**; upload → **Internal testing**
- [ ] Smoke on device: auth, onboarding, rate, Circles, join link

### Phase 2 — Store listing (required)
- [ ] Short + full description (Circles / private groups copy from App Store)
- [ ] Icon 512×512, feature graphic 1024×500, phone screenshots
- [ ] Privacy: `https://www.cinemastro.com/privacy`
- [ ] Category **Entertainment**; contact **`support@cinemastro.com`**

### Phase 3 — Policy forms (required)
- [ ] Content rating (IARC)
- [ ] Target audience — not primarily children
- [ ] **Data safety** (email, name, user ID, device ID when FCM, app activity; no ads)
- [ ] Ads: No; demo account for reviewers; other declarations as applicable

### Phase 4 — Release
- [ ] Internal → Closed (optional) → **Production**
- [ ] Countries: **United States** only
- [ ] Submit for Play review

### Phase 5 — Push parity (optional)
- [ ] Firebase + `google-services.json` + FCM
- [ ] Edge/client Android path for circle badge/banners
- [ ] New AAB after FCM

**Suggested min order:** keystore → AAB → internal smoke → listing + Data safety → US production → FCM later.

---

## Master list (maintained)

*One checklist — product, ops, analytics. § numbers reference legacy HANDOFF/passdown numbering.*

### Priority 1 — Your Picks / **For you** CF (backlog sequence)

*Context: deterministic CF sort + **same titles** surfacing weeks; clearing **specific** **`user_neighbors`** does not wipe recs when **many other neighbors** still weight those titles. **Another user clearing a rating** only schedules **`compute-neighbors`** for **them**, not automatically for you until **your** cron chunk / rating / manual Edge invoke.*

- [ ] **1a — Refresh (UX honest):** **“Different picks”** messaging + explicit behavior — **reuse** **`topPickOffset` / seeded shuffle** pattern; clarify **rotation / variation**, **not** “better” scores vs current model.

- [ ] **1b — Tier-local shuffle + diversity tie-break (cheap):** Within **confidence tiers** (or prediction bins), **shuffle** or **alternate** similarly scored titles; when neighbors/predictions **tie**, break toward **genre / franchise / decade** breadth (lite **MMR**-style) — **no impression logging required**.

- [ ] **1c — Impression decay:** After minimal **shown-in-strip** telemetry storage, suppress **same title within N days**; define **relaxation order** when the pool dries (widen tiers → popularity tail → exploration).

- [ ] **1d — Explainability:** **“Why?”** / similarity to **“You rated X”** once **`match`/Edge** can return **cheap anchor title(s)** per rec.

- [ ] **1e — Not interested + interaction design (optional, pairs with above):** Dismiss rows; tune order with **1b–1c** so strips don’t empty.

**One-line priority:** Ship **labeled refresh + within-tier shuffle / diversity tie-breaks** before **decay/explainability**, which need **storage** / **payload** plumbing.

---

### Your Picks — circle-driven sections (§1f; discussed 2026-05-28, not built)

*Today **`/your-picks`** has one strip — **🔥 For you** (`match` **`your_picks_page`** + optional **`predict_cached`**). Circles already expose per-circle feeds via **`get_circle_rated_strip`** / **`get_circle_rated_top_grid`** / **`fetchCircleRatedTitles`** (member-only, **≥2** members, group avg not individual scores). **`rating_circle_shares` RLS** = user sees **own** share rows only; other members’ activity comes through **SECURITY DEFINER** circle RPCs. **Watchlist is private** — no true “others are watching” without a new share model.*

**Product copy (honest):** Prefer **“Recent in your circles”** / **“Top in your circles”** over **“watching”** unless shared watchlist ships.

#### Phase 1 — Member circles only (~**medium**, ~1–2 weeks for 2–3 strips)

*Reuses existing circle RPCs + strip UI; filter out titles in **`userRatings`**; optional **`predict_cached`** for circle title ids; don’t block **For you** on circle fetches.*

- [ ] **1f.0 — UX decision:** **One merged strip** (“From your circles”) vs **one strip per circle** (up to **10** active) vs **single “primary” circle** only (smallest scope).

- [ ] **1f.1 — Recent in your circles:** Others’ **`rating_circle_shares`** / ratings activity you **haven’t rated** — source **`get_circle_rated_strip`** (recent / **`activity_at`**). Empty when **0 circles**, **under 2 members**, or gated.

- [ ] **1f.2 — Top in your circles (unrated):** High **circle average** titles you haven’t rated — source **`get_circle_rated_top_grid`** + client filter **`userRatings`**.

- [ ] **1f.3 — Client:** New **Your Picks** sections under **For you** (headers, skeletons, empty states, dedupe vs **For you** pool).

- [ ] **1f.4 — Performance (optional but recommended):** **`get_your_picks_circle_feed`** (or similar) **RPC** merging member circles in SQL — avoids **N×** strip RPC + simplifies caps.

- [ ] **1f.5 — Cards:** Show **circle name** (which circle surfaced the title), **group avg**, **your** prediction or “rate to see” — same privacy rules as Circles strip (no other members’ individual scores).

**Not in Phase 1 without new product:**

- **“Watching”** from others’ **watchlist** (RLS-private today).
- **Popular / highly rated in circles you’re not in** — see Phase 2.

#### Phase 2 — “Other circles” / global circle trends (~**large–XL**)

*Contradicts closed-circle model today. Needs product + legal (k-anonymity, no **`circle_id`** / member leakage) before engineering.*

- [ ] **2f.0 — Policy:** Global anonymized **“Trending among Cinemastro circles”** vs **never** vs cohort (vibe/region) — **TBD**.

- [ ] **2f.1 — Backend:** Materialized aggregates over **`rating_circle_shares`** / ratings (min **N** circles or **M** users per title); **`SECURITY DEFINER`** read RPC; no PII.

- [ ] **2f.2 — Your Picks strip:** **Highly rated / popular** from that aggregate, excluding **`userRatings`**.

- [ ] **2f.3 — Optional:** Shared **“intent to watch”** published to circle (new table + RLS) if true **“watching”** is required — **large**, separate from 1f.

**Effort snapshot:** Phase **1f** = **medium**; Phase **2f** = **large–XL** + privacy review. **1f** can ship without **2f**.

---

### Discover — title search quality (§1g; discussed 2026-05-28, not built)

*User-reported gap: misspelled or alternate **transliteration** (e.g. query **`karthavya`** for film **Kartavya**) returns wrong/empty in **Discover**; **IMDB** surfaces correct variants. Today **Discover** = TMDB **`/search/movie`** + **`/search/tv`** only (`fetchTmdbSearchPages`, **2** pages, cap **40**/type, animation filter). **No** fuzzy match, **no** “did you mean”, **no** IMDB/alt-title pass, **no** search over Cinemastro **`ratings`** or catalogue. **Your Ratings** search = local filter on rated rows only.*

**Root cause:** TMDB search is **literal** on their index; Cinematch does not retry or correct queries.

**Suggested fix order (stay on TMDB `tmdb_id` identity):**

- [ ] **1g.0 — UX (tiny):** When few/zero results — “Try shorter spelling or poster title”; optional link to try without extra letters.

- [ ] **1g.1 — Low-results retry (small–medium, best ROI):** If hits under **N**, auto-run **2–4 query variants** (transliteration heuristics: `th`→`t`, collapse doubles, common vowel variants for Indian/Latin titles); merge + dedupe TMDB results.

- [ ] **1g.2 — Optional year / type** on Discover search form — disambiguation, not typos.

- [ ] **1g.3 — “Did you mean”** — edit distance against corpus (catalogue + rated titles on platform) — **medium**.

- [ ] **1g.4 — Hybrid IMDB / own index** — **large** (licensing, compliance); only if **1g.1** insufficient.

**Not in scope for 1g:** Mood (uses **discover**, not keyword search); Circles (points users to Discover).

---

### Priority 2 — US geo / availability (product)

- [ ] **Geo-blocking banner or notice:** Infer location (**IP / Edge / CDN**, optional **user confirms US residency**) and show non-US users: **"Cinemastro is currently available to US users only."** Choose **warn-only (proceed at own risk)** vs **hard block** — **TBD** with Terms/privacy. *(Not implemented.)*
- [ ] **Multi-market availability (discussed 2026-05-28, not designed in passdown depth):** Today **taste** = **`show_region_keys`** + **`secondary_region_key`**; **availability** = hardcoded **US** TMDB (`region` / `watch_region`, **`fetchWatchProviders` → `results.US`**, US provider IDs). Real multi-region needs **`profiles.availability_region`** (or similar) threaded through discover, WTW, detail cert/release, provider maps; **CF/ratings** can stay global by **`tmdb_id`** (cold start in new markets). Phases: (0) policy → (1) profile market + WTW + detail → (2) strips/onboarding → (3) regional scores/CF → (4) geo gate + per-region pulse. See chat before coding.

### Repo / ops / parity

- [ ] **Branches:** Default: commit push **`origin/staging`** only; push **`origin/main`** **when user explicitly wants production**. See **`.cursor/rules/cinematch-handoff.mdc`** item 6.
- [ ] **Staging URL leakage:** Beta users may still open old **`*.vercel.app`** hostnames. Prefer **Vercel Deployment Protection** on the **staging** project. Set **`VITE_PUBLIC_SITE_URL`** on staging build for consistent **`/join`** links.
- [ ] **Git:** Ensure **`20260606120000_*`** and **`20260607120000_*`** analytics migrations are **committed** if team expects them — fix **`git status`** drift.
- [ ] **Prod / staging migrations:** Verify **`20260615120000`** (growth + **`ratings.created_at`**) + **`20260614120000`** (**`get_my_circles`**) + **`20260613`** (invite links) + **`20260612`** (leave) + **`20260611`** + **`20260610120000`** + analytics **`20260606`**/**`07`** **per env**.
- [ ] **Deploy cache (optional engineering):** Short **`Cache-Control`** on **`index.html`** / entry document on Vercel — reduces stale **`APP_VERSION`** (*discussed, not shipped*).
- [ ] **Neighbors / MAU:** **`COMPUTE-NEIGHBORS-CRON.md`** — **20** jobs × **`limit: 10`** = **200**/week; scale when **`totalEligible`** grows.

### Analytics / BD (instrumentation)

- [ ] **Client:** Wire **`log_analytics_event`** (funnel surfaces).
- [ ] **Client:** Wire **`log_watch_chain_event`** on rating submit.
- [ ] **Admin reporting:** **`scripts/sql/analytics-admin/*.sql`**.
- [ ] **Growth stats:** Query **`public.platform_growth_daily`** (UTC); cron **`platform-growth-daily-utc`** — see migration **`20260615120000`**.

### Product — prioritized next builds

**Onboarding / first-run (mobile)**

- [x] **`onboarding`** + **`rate-more`** poster tile (**~2:3**, **`contain`**, tighter height) — **shipped 7.0.36**.
- [x] **Onboarding title pool (TMDB only for `obCatalogue`):** **7.0.60** — Hollywood/side **discover ~6 mo**, **`vote_count` ≥ 200**, popularity; secondary cinema **`vote_count` ≥ 40**, **release / first-air desc**; English side uses same Hollywood discover in mixed path; main **`catalogue`** still popular + top_rated + theaters.

**Circles**

- [x] **Ghost “My circles” after leave (creator SELECT + empty nested members):** **Shipped 7.0.49** — **`get_my_circles()`** RPC + **`fetchMyCircles`** uses **`supabase.rpc`** (*optional follow-up:* **`fetchCircleDetail`** still table **`select`*).
- [x] **Recent strip “Earlier” scroll jump:** **Shipped 7.0.54** — prepend width restores **`scrollLeft`**.
- [x] **Zero active circles nudge (returning raters):** **Shipped 7.0.56** — Circles banner + modal (**2-day** modal cooldown); resets when user has an active circle.
- **§8 — Invites at max circles:** Today **`auto_declined`** — recipient never sees invite. *Goal:* muted row (“at cap”) + creator pending until resolved.
- **§9 / 4b — Remove member:** Hosts remove another member (**`circle_members` DELETE`** is **self-only** today).

**Watchlist / invites / ratings**

- **§17 — Watchlist:** Show **circle name** via **`source_circle_id`** (partial today).
- **§18 — Invite → non-user email (deferred row):** **Partially unblocked:** **share link** **`/join/:token`** shipped (**7.0.44**); in-app email path still requires existing account (**`send-circle-invite`**). **Parked:** DB deferred-invite row + email-outreach without account; phone / contact-hash / scoped display-name search remain backlog.
- **§19 — Bayesian normalization:** **TBD.**

**Account & data**

- [x] **Auth — show password (7.0.59):** Eye toggle on sign-up / sign-in / reset (**`aria-label`** show/hide); mode change resets visibility.

- [x] **Clear / delete a rating (per title):** **Shipped 7.0.42** — title detail **Clear rating** + migration.

- [ ] **Delete account:** Self-service + legal alignment.

**Security**

- **§20 — `ACCOUNT-SECURITY.md`:** OAuth, CAPTCHA, optional phone.

**Engineering — platform (§21–30)**

- **§21** Code-splitting (**`lazy()` + `Suspense`**).
- **§22** Fetch waterfalls / skeletons first.
- **§23** Split **`App.jsx`** → **`pages/*`** (Circles stay in **`App.jsx`**).
- **§24–27** Caching / image opt. **Circles perf** through **7.0.29** backoff; **`PERFORMANCE-CIRCLE-CACHE.md`** step 5 optional.
- **§28** Supabase hot paths.
- **§29** Fonts subset / **`font-display`**.
- **§30** PWA — **7.0.58** Circles-tab install education modal; service worker backlog.
- [x] **Native shell (Capacitor) through 7.0.80:** Auth, `/join`, icons, badge Phase 1+2, publish banners; **staging + prod web** @ **`8f99f15`**. Next: confirm prod TF **build 10**, App Store when asked. **§ Capacitor** above.

**Your Picks (page)**

- [x] **For you strip only today:** **`your_picks_page`** + batch reveal (**5**→**20**); CF / popular kinds — see **§1a–1e**.
- [ ] **Circle strips on Your Picks:** **§1f** Phase 1 (member circles) then optional Phase 2 (global / other circles) — full checklist under **§1f** above.

**Discover**

- [x] **Search today:** TMDB **`/search/movie|tv`**, **2** pages, **40** cap/type, default **animation** excluded — see **§1g**.
- [ ] **Typo / transliteration tolerance:** **§1g** — user report **`karthavya`** vs **Kartavya**; prioritize **1g.1** low-results variant retry.

**Mood**

- [x] **Feels tab (7.0.66):** Genre card **Genres | Feels** when **Hollywood** selected; **10** chips + TMDB **`with_keywords`**; tab UI + genre/feel tinted chips; shipped **staging + prod**.
- [ ] **Similar from named titles (discussed):** User picks **2–3 movies** → TMDB **`/recommendations`** merge — Mood entry or separate flow; not built.

**Polish**

- [x] **Title detail — cast & crew (7.0.64–7.0.65):** After **Overview**, **Cast** (up to **6** billed names) then **Director** / **Directors** / **Created by** (TV); text-only; lazy TMDB **`append_to_response=credits`**; **grey panels** match facts bar. **Staging + prod** **2026-05-28**.
- [ ] **In-app “new version” nudge (optional):** Fetch **`/version.json`** or compare build id vs deployed — *discussed, not shipped*.
- **§36 — Circle strip tabs:** **Top** vs **Most rated** copy (**`HANDOFF.md`**).

### Locked decisions (don’t reopen without explicit ask)

- **Circle invites:** **Email (existing account)** + **share link** (**one-recipient token**) shipped; **phone / global contact matching** = backlog unless user reopens.

### Parked — revisit later

- **§18** residual: deferred **email** invite row / outbound mail to non-users without link flow.
- **Phone / contact discovery** — invitation-only vs opt-in hash matching (**security**: enumeration, graph leakage, retention).
- **Display-name “search”** — only meaningful **scoped** + disambiguation (not global directory).


*See **`PASSDOWN-ARCHIVE.md`** for long § tails.*

---

## How the user wants to work

**Unless they clearly ask for code in the same message**, treat messages as **discussion only**. **Implement** after **`code now`**, **yes**, or **implement / fix / migrate / do it**. Full rule: **`.cursor/rules/cinematch-discussion-first.mdc`**.

**When you ship product code:** bump **`package.json`** + **`CHANGELOG.md`**. **Edge:** bump **`EDGE_FUNCTION_VERSION`** + redeploy.

**HANDOFF.md** — may lag version — trust **`package.json`**.

---

## For the assistant (every Cinematch session)

1. Read **this file** early — **1a–1e** CF diversity; **§1f** circle strips; **§1g** Discover search; then **P2** US geo and full **Master list**.
2. **Neighbors / MAU:** **`COMPUTE-NEIGHBORS-CRON.md`**. Audit: `select jobname, schedule from cron.job where jobname like 'compute-neighbors-w%';`
3. **Passdown updates:** edit **this file**; **commit + push** if remote should track. On **“update passdown”**: reply must include **Tell the next chat** block (see **`.cursor/rules/cinematch-handoff.mdc`**).
4. **Last note:** merge the session’s **final** user note into **Open / follow-ups**.

---

## Keep in mind every session

- **`COMPUTE-NEIGHBORS-CRON.md`** — Vault, secrets, `pg_net`, staggered schedules.
- Staging-only **`git push`** unless user asks for production.

---

## Supabase migrations checklist (hosted DB)

| Migration | Purpose |
|-----------|---------|
| **`20260731120000_device_push_tokens_circle_badge.sql`** | **`device_push_tokens`** + register/unregister RPCs + **`get_user_circle_unseen_total`** — APNs badge/banner (**7.0.78+**). **Applied staging + prod.** |
| **`20260616120000_circle_site_rating_together_rows.sql`** | **`site_rating`** on **together** circle strip/grid rows (**`get_circle_rated_strip`**, **all**, **top** RPCs) — **7.0.62**; apply on each hosted DB. |
| **`20260615120000_platform_growth_daily.sql`** | **`platform_growth_daily`** UTC stats (cumulative + **`new_*`**); **`ratings.created_at`**; refresh RPCs; optional **`pg_cron`** **`platform-growth-daily-utc`**. |
| **`20260614120000_get_my_circles_rpc.sql`** | **`get_my_circles()`**: membership-only list + full **`circle_members`** JSON (**fixes ghost list** vs **`creator can read own circle`** + nested RLS). |
| **`20260613120000_circle_invite_share_links.sql`** | Link invites: nullable **`invited_user_id`**, **`invite_token`**, **`invite_email`**, **`expires_at`**, **`revoked`**; pending-label tweak; recipient DELETE declined. |
| **`20260612120000_leave_circle_delete_bypass_rls.sql`** | **`leave_circle`**: **`row_security = off`**, row-count asserts; last-member **DELETE circles** reliable. |
| **`20260611120000_ratings_rls_delete_own.sql`** | **`ratings` DELETE** own row (title detail **Clear rating**). |
| **`20260610120000_profiles_sync_display_name_from_auth_users.sql`** | **`profiles.name`** from **`auth.users`** metadata (+ backfill); email-confirm signup path. |
| **`20260609120000_circles_active_name_unique_ci.sql`** | Globally unique **active** **`circles.name`** (**`lower(trim(name))`**). |
| **`20260608120000_pulse_catalog_daily.sql`** | Shared **Pulse** catalog per UTC day; Edge **`pulse-catalog`** fills. |
| **`20260607120000_log_analytics_watch_chain_rpc.sql`** | **`log_analytics_event`**, **`log_watch_chain_event`**. |
| **`20260606120000_analytics_and_watch_chain_events.sql`** | **`analytics_events`**, **`watch_chain_events`**. |
| **`20260605120000_get_my_circle_unseen_counts_latest_share_at.sql`** | **`latest_share_at`** on **`get_my_circle_unseen_counts`**. |
| **`20260604120000_get_circle_pending_invite_labels.sql`** | **Invites pending** (6.1.5). |
| **`20260603120000_leave_circle_admin_only.sql`** | **6.1.4** leave / admin (**`leave_circle`** baseline). |
| **`20260602120000_get_circle_title_publishers.sql`** | **3b** / **Rated by**. |
| **`20260601120000_circle_members_admins_moderator_rls.sql`** | Admin / moderator RLS. |
| **`20260527120000_circle_member_last_seen.sql`** | **last_seen** + unseen (**5.6.33**). |
| **`20260529120000_creator_leave_transfer_ownership.sql`** | Legacy creator-leave. |
| **`20260528120000_circle_strip_share_activity_order.sql`** | Strip ordering. |
| **`20260524120000_rating_circle_shares.sql`** | Feeds — **required** for circle rated titles. |
| **`20260523120000_watchlist_sort_index.sql`** | **`sort_index`**. |
| **`20260525120000_watchlist_max_30.sql`** | **30** cap. |
| **`20260526120000_watchlist_rls_update_own.sql`** | Watchlist RLS update. |
| **`20260522120000_circles_rated_all_top_grid.sql`** | All/Top RPCs; **`get-circle-rated-titles`**. |
| **`20260506120000_circles_strip_recent_activity.sql`** | Strip ordering. |
| **`20260505120000_circles_name_length_2_32.sql`** | Name length. |
| **`20260503120000_get_circle_member_names.sql`** | **`get_circle_member_names`**. |
| **`20260504120000_profiles_name_not_null.sql`** | Display **`profiles.name`** NOT NULL + backfill. |

**Edge:** **`push-circle-badge`**, **`get-circle-rated-titles`**, **`pulse-catalog`**, **invite suite** — deploy after changes; **`git push` does not deploy**.

---

## Open / follow-ups

**Last session (2026-08-13)**

- **Last note:** User asked to **keep the Google Play checklist** in passdown for later. App Store **submitted** (2026-08-12). Play **not started**.

- **Immediate:** Watch Apple review; restore **staging `.env`** if still prod; commit/push this passdown if not on remote.

- **Next:** Google Play when user asks (**§ Google Play**); backlog **1a–1e**, **§1f**, **§1g.1**, **P2**.

---

*Trim **Open / follow-ups** when updating; archive older narrative to **`PASSDOWN-ARCHIVE.md`** if needed.*
