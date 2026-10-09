# Passdown for next chat (Cinematch)

**Last updated:** 2026-10-08 — trust **`package.json`** / **`CHANGELOG.md`**. Local **7.0.129** (not committed, not shipped). Live App Store and public Play listing verified **7.0.87** (the older “live binary is **7.0.82**” note is stale). Store CA/IN only after this build is live. **Trademark:** **§ USPTO trademark**. India filing is the user’s own next step (agent in India); not required to release. **`git pull`** **`origin/main`** **`origin/staging`** **`origin/capacitor/v1`**. **Deep history:** **`PASSDOWN-ARCHIVE.md`**. **Stable product depth:** **`HANDOFF.md`**. **§ Priority 2 multi-market paragraph is updated below** (local catalogs for CA/IN are in **7.0.89–7.0.113**; prod SQL for those columns is in).

**Recent releases (high level):** **7.0.87** — Circles title cards: no poster-corner badge; **1 of 11 rated** under the orange pill (staging + prod web; no new AAB). **7.0.86** — self-service **Delete account** (Profile + `/privacy#delete-account`; Edge **`1.0.0`** + SQL **`20260918153000`** applied **staging + prod**; throwaway smoke both envs; no new AAB). **7.0.85** — web **Open in Cinemastro** on `/join` + **`/join` wins over recovery** (staging + prod; no new AAB). **7.0.84** — Android FCM circle banners; Edge **`push-circle-badge` `1.2.0`** (redeployed); **`assetlinks.json`** SHA-256 colon format. Earlier — **`CHANGELOG`**.

**Single checklist:** Use **§ Master list (maintained)** below as the one place to track next work (product + ops + analytics). **Google Play:** **§ Google Play**. **7.0.83:** iOS confirm→Circles was already fine (**7.0.82**). Overflow after confirm was **Android-only** (user 2026-09-22); code is Capacitor-wide. Next native = new archive/AAB for delete + circle cards.

---

## Tell the next chat (copy from here)

> Cinematch — trust **`package.json`** / **`CHANGELOG.md`**. Local **7.0.129**, not committed, not shipped. Remotes **`origin/staging`** and **`origin/main`** are still **7.0.87**. User is on local **`main`** with that uncommitted work. Live App Store binary verified **7.0.87** (released **2026-09-25**; archive **7.0.87 (16)** uploaded **2026-09-24**). Public Play listing verified **7.0.87**, updated **2026-09-24** (“first Android prod build”, listing still says **US only**). The older “live binary is **7.0.82**” note is stale. User leaves for India in 3 days from **2026-10-08** and wants this local version released before they go. Do not commit or push unless asked. Routine ships → **`origin/staging`** only. Production web and a new store build only when they explicitly ask. Do not add Canada or India as store countries until this build is live. Next native upload needs marketing **7.0.129**, an iOS build above **16**, and Android **versionCode** above **3**. Read **`@PASSDOWN-NEXT-CHAT.md`**.
>
> **Local `.env`:** Prefer **staging-only** day-to-day. Play AAB on disk is still **versionCode 3** / **7.0.87**. Archive already uploaded: `~/Library/Developer/Xcode/Archives/2026-09-24/Cinemastro 7.0.87 (16).xcarchive`. Xcode project **MARKETING_VERSION 7.0.87** / **CURRENT_PROJECT_VERSION 16** (local, not committed). Android Gradle **versionCode 3** / **versionName 7.0.87**.
>
> **App Store:** Live **7.0.87** (id **6796027034**). Store text still says “Currently intended for users in the United States.” Demo **`apple.review@…`** (do not onboard).
>
> **Google Play:** Public listing **7.0.87**, updated **2026-09-24**, text says **US only**. Delete-account URL **`https://www.cinemastro.com/privacy`**. CA/IN store countries after the **7.0.129** build is live.
>
> **Supabase refs (do not swap):** **staging** **`lovpktgeutujljltlhdl`**; **prod** **`uwexmfmkaifvddnfuvpg`**.
>
> **7.0.86 delete-account:** Edge **`delete-account` `1.0.0`** on **staging + prod**. SQL **`20260918153000_prepare_account_deletion.sql`** applied **staging + prod**. Throwaway delete tested on **staging and prod** (Auth user gone).
>
> **Prod backend (user, 2026-10-08, project `uwexmfmkaifvddnfuvpg`):** SQL **`20260924120000`** (profile Where you watch), **`20260924130000`** + **`20260924140000`** (Pulse India/Canada), **`20260925120000`** (season ratings) — user said none of these failed. Edge redeployed: **`pulse-catalog` `1.2.0`**, **`match` `1.0.1`**, **`compute-neighbors` `1.0.2`**. Confirm signup and Reset password templates include **`{{ .Token }}`**. Staging was not re-checked tonight.
>
> **Local 7.0.124–7.0.129 (uncommitted):** About says available to users in the **US, India, and Canada**. Terms §5 lists **United States, India, and Canada**; Terms “Last updated” **October 8, 2026**. Title screen **From your circles** card (final **7.0.129**): green label matching **Your rating saved**, text like **2 ratings from your circles** (**circle** if the user belongs to one circle; **1 rating** if one other person), second line **Click to view**. Count and list exclude the current user. Hidden when nobody else has published. Window keeps the film title and **X** fixed; list scrolls; TV uses the same season lines as **Rated by**. Store listing copy in App Store Connect and Play Console is still US-only.
>
> **Parked — next is Profile text size.** Do not build unless asked. **Text size** (2026-10-05): Small = today, Medium, Large; reading text only; do not follow the phone setting. **Confirm password** (2026-10-04, reconfirmed 2026-10-08): signup only, local match check, both at least 6 characters, no server change; sign-in stays one field. Circle rating notifications that name the rater (2026-09-26). **New this week** landing (2026-09-26, mock only). Startup login flash (2026-09-26). Also still parked: confirm-email https interstitial; Discover iOS keyboard (**§1g.k**); Android status-bar overlap (needs AAB); product **1a–1e**, **§1f**, **§1g.1**. Store CA/IN territories wait until **7.0.129** is live. India trademark is the user’s own errand; not a release blocker. US serial **99792884**, filed **2026-04-28**; India priority window about **2026-10-28**.
>
> **USPTO trademark:** When user asks where to check status → **https://tsdr.uspto.gov** (login) → serial **99792884**. Filed **2026-04-28**. As of **2026-08-28**, examining-attorney queue was **Mar 28–Apr 5**.
>
> **`pg_net` / compute-neighbors:** **`COMPUTE-NEIGHBORS-CRON.md`**.

---

## Snapshot (read this first)

| Item | State |
|------|-------|
| **Web app (staging / prod)** | Remotes **7.0.87**. Local uncommitted **7.0.129**. |
| **Native app** | **Capacitor 8**. Live App Store **7.0.87 (16)**. Xcode project still **7.0.87 / 16**. Play public listing **7.0.87**. Gradle still **versionCode 3 / 7.0.87**. |
| **Apple / App Store** | Live **7.0.87**, current-version date **2026-09-25**. Listing still “United States.” |
| **Google Play** | Public listing **7.0.87**, updated **2026-09-24**, text **US only**. CA/IN after **7.0.129** is live. |
| **Supabase auth** | Staging + prod: **`com.cinemastro.app://localhost/`** (+ recovery). |
| **Edge** | Prod **2026-10-08**: **`pulse-catalog` `1.2.0`**, **`match` `1.0.1`**, **`compute-neighbors` `1.0.2`**. **`push-circle-badge` `1.2.0`** and **`delete-account` `1.0.0`** already staging + prod. |
| **Client deploy** | **Vercel** (web); native = Xcode / Play. |
| **USPTO trademark** | TSDR **https://tsdr.uspto.gov** (login) → serial **99792884**. Filed **2026-04-28**. Queue as of **2026-08-28**: examining **Mar 28–Apr 5**. |

**Where detail lives:** **`HANDOFF.md`**, **`CHANGELOG.md`**, **`PASSDOWN-ARCHIVE.md`**.

---

## USPTO trademark

*When the user asks **where to check trademark status** (or USPTO / TSDR / mark status), always show this — do not make them hunt.*

1. Open **https://tsdr.uspto.gov**
2. **Log in**
3. Enter serial **`99792884`**

**Filing:** submitted **2026-04-28**.  
**Queue (user-noted 2026-08-28):** USPTO was reviewing applications filed **Mar 28–Apr 5**. This serial is **after** that window (about one month behind that published range — expect lag; do not treat the Mar/Apr range as “your mark is being examined now”).

---

## Capacitor native app (§30 — shipped to staging + prod web; TF internal)

*Bundled shell; backend = whatever **`.env`** was at **`npm run build:app`**.*

**Shipped (through **7.0.86** web on staging + prod; native binaries through **7.0.84**):**

- **Capacitor 8** — **`com.cinemastro.app`**, **iPhone-only**, safe areas, strip scroll, auth deep links, email confirm → app scheme, universal **`/join`**, icons, export-compliance plist flag.
- **7.0.86** — Self-service **Delete account** (Profile + Privacy). Circle transfer to next host; ratings wiped. Web-only.
- **7.0.85** — Web **Open in Cinemastro** on `/join` (Android `intent://` + iOS custom scheme; hidden in native shell). **`/join` wins over recovery**. No new AAB.
- **7.0.84** — Android FCM circle-publish banners; Edge **`1.2.0`** redeployed; **`assetlinks.json`** colon SHA-256. Play Internal AAB **versionCode 2**.
- **7.0.83** — **`src/nativeViewport.js`**: scrub auth URL + burst viewport reset after email-confirm / app resume. Changelog said iOS; **user: overflow was Android-only**. Code is **Capacitor-wide** (not iOS-gated). iOS confirm→Circles already worked in **7.0.82**. Play Internal **7.0.84** bake should already include this file.
- **Badge Phase 1–2 + banners (7.0.76–7.0.80):** as before.

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

- [x] **7.0.83 overflow:** **Android-only** (user 2026-09-22). iOS confirm→Circles already OK on live **7.0.82**. No separate iOS verify gate.
- [x] **App Store** — approved; **Ready for Distribution** (auto-release). Live = **7.0.82** archive.
- [ ] **New App Store archive** — local **7.0.87 (16)** prod bake done 2026-09-24 (`Cinemastro 7.0.87 (16).xcarchive`). Upload from Organizer. ASC needs a **new version 7.0.87** (live store version is **1.0**). Then TF / store. Web already on **`origin/main`**.
- [ ] **Google Play** — local AAB **7.0.87** / **versionCode 3** ready. Upload Internal, smoke, then Production **US** (first public version). Do not promote **7.0.84**.
- [ ] **Discover keyboard (§1g.k)** — after Play **production** submitted (not before).
- [ ] **External TestFlight** (optional).
- [x] **Delete account (7.0.86 staging + prod web):** Profile + `/privacy#delete-account`. Edge **`delete-account` `1.0.0`** + SQL **`20260918153000`** applied **staging + prod**. Throwaway delete tested both envs (Auth user gone).
- [ ] Optional: staging bundle id variant (not set up).

**Parked / discussed:** Anonymous non-circle pushes; Web Push PWA; OAuth/phone multi-account (OK for now); **CA/IN** store + **`availability_region`** until **after** Play Production (P2).

---

## Google Play (internal live — 2026-08-25)

*Local signed AAB **7.0.87** (**versionCode 3**) baked 2026-09-22 (prod `.env`). **Not uploaded yet.** Live Internal is still **2 (7.0.84)** until Console upload. Then Production **US**. CA/IN later.*

**Identity:** Play login = Google account on **`dev@cinemastro.com`** (Namecheap mailbox + “use my current email”). **Organization**; **DUNS** = same as Apple. Developer name **Cinemastro, LLC**. Org contact **`support@cinemastro.com`**. Search Console owner **`tlmahesh`**; **`dev@`** extra **Owner**. Website/identity/phone **verified**.

**Signing (never commit secrets):** upload keystore **`~/cinemastro-upload.jks`**, alias **`cinemastro`**. Local **`android/keystore.properties`** (gitignored). Gradle release signing is **wired locally** (`android/app/build.gradle` **versionCode 2** / **versionName 7.0.84**) — **not pushed** to `origin/staging` yet. Back up `.jks` + password off this Mac.

**AAB:** `android/app/release/app-release.aab` (gitignored). **New local file:** **7.0.87** / **versionCode 3** (4.3 MB, 2026-09-22). Console Internal still **2 (7.0.84)** until you upload. Temporary name **`com.cinemastro.app (unreviewed)`** is normal.

**Testers:** **Veena** downloaded + logged in (2026-08-26). **Moto** (`dimanicontacts@gmail.com`, 2026-09-18): Internal worked after Publishing overview drafts (same “not invited” as Ramesh). `/join` first opened Chrome; Open by default had supported links **off**; enabling **www.cinemastro.com** opened the app and they joined. New users will still land in Chrome → **7.0.85** web button.

**Listing / policy (filled in Console):** App Store subtitle **Private groups for film**; full ASC description. Icon **`assets/play-icon-512.png`**. Feature graphic **`assets/play-feature-1024x500.png`**. Video skipped. Tablet shots optional. AI assets: **Don’t label**. Delete-account URL **`https://www.cinemastro.com/privacy`**. Data safety: name (collected+shared), email (collected only), user IDs (collected+shared), UGC ratings (collected+shared); no ads / AD_ID / location. Advertising ID **No**.

**Do not:** commit `keystore.properties` / `*.jks` / `*.aab`. Don’t click Open-testing “Create new release.”

### Phase 0 — Prep
- [x] Play Console developer account (`dev@`) + org/website/identity/phone verification
- [x] Prod vs staging `.env` discipline — user unstacked to **staging-only** (2026-08-26); switch to prod before next Play bake
- [x] Create app: **Cinemastro**, **`com.cinemastro.app`**, Free, **US**

### Phase 1 — Signing & build
- [x] Upload keystore + local `keystore.properties`
- [x] Wire release signing (local; commit when user asks — no secrets)
- [x] Set **`ANDROID_SHA256_FINGERPRINT`** / **`ANDROID_SHA256_FINGERPRINTS`** on **prod** Vercel (Play app-signing + upload). Staging project optional. Colon format requires **7.0.84** web build.
- [x] Prod bake → **`npm run build:app`** → signed **AAB** → Internal testing
- [ ] Smoke (Veena / Moto): auth **done**; onboarding, Discover, Circles. **7.0.85** prod `/join` Open-in-app retest with App Links **off**.

### Phase 2 — Store listing
- [x] Short + full description (App Store copy)
- [x] Icon 512 + feature graphic 1024×500 + phone screenshots
- [x] Privacy + Entertainment + **`support@cinemastro.com`**

### Phase 3 — Policy forms
- [x] Content rating, target audience, Data safety, ads/AD_ID, gov/finance/health **No**
- [ ] Demo **`apple.review@…`** in Sign-in details if not already saved (same as Apple; do not onboard)

### Phase 4 — Release
- [x] Internal testing live
- [ ] Closed (optional)
- [ ] **Production** + Play review — **next after break** (US only). Closed optional. Do not add CA/IN store countries in this first Production pass.

### Phase 5 — Push parity (7.0.84)
- [x] Client: register FCM token on Android (`nativePush.js`)
- [x] Edge: FCM HTTP v1 in **`push-circle-badge` `1.2.0`**
- [x] Firebase Android app **`com.cinemastro.app`** + SHA-1/256 in Firebase
- [x] **`android/app/google-services.json`** in repo
- [x] Edge secret **`FCM_SERVICE_ACCOUNT_JSON`** + redeploy **1.2.0** staging + prod
- [x] Prod-bake AAB **versionCode 2** / **7.0.84** (upload Internal if not yet)
- [x] Vercel **`ANDROID_SHA256_*`** on prod; colon format in **7.0.84** generator

**Next Play:** Production **US** after break. **7.0.85** is on prod web — retest join in Chrome on Moto (domain off). CA/IN later.

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

- [ ] **1g.k — Discover iOS keyboard (parked until Play *production* submitted):** Accessory-bar **checkmark** is WKWebView **Done** (dismiss only). After Play prod submit: `type="search"` + `enterKeyHint="search"` + hide accessory via **`@capacitor/keyboard`**. Not Spotlight-identical.

**Not in scope for 1g:** Mood (uses **discover**, not keyword search); Circles (points users to Discover).

---

### Priority 2 — US geo / availability (product)

- [ ] **Geo-blocking banner or notice:** Infer location (**IP / Edge / CDN**, optional **user confirms US residency**) and show non-US users: **"Cinemastro is currently available to US users only."** Choose **warn-only (proceed at own risk)** vs **hard block** — **TBD** with Terms/privacy. *(Not implemented.)*
- [x] **Multi-market availability (local 7.0.88–7.0.113, prod SQL 2026-10-08):** Profile **Where you watch** (`US` / `CA` / `IN`) and, for India, **Languages to show first**. Catalogs, certs, dates, and where-to-watch follow that setting. Prod has **`20260924120000`**, Pulse **`20260924130000`** + **`20260924140000`**, and **`pulse-catalog` `1.2.0`**. About (local **7.0.124**) says users in the **US, India, and Canada**. Terms §5 lists those three countries. Store countries still wait until the **7.0.129** build is live. **CF/ratings** stay global by **`tmdb_id`**.

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
- [ ] **Sign-up — confirm password (agreed 2026-10-04, reconfirmed 2026-10-08, not built):** Create account has one password field. Add a second field on **signup only**. Before `signUp`, both must match and each must be at least 6 characters. A mismatch shows an error and does not create the account or send the email. Sign in stays one field. Local check only. No server change. *Do not implement until user asks.*

**Profile**

- [ ] **Text size — Small, Medium, Large (agreed 2026-10-05, not built):** Profile choice. **Small** is today’s size (do not go smaller). **Medium** is about a twelfth larger and **Large** about a sixth larger, on the words people read (titles, scores, names, overview, circle labels). Poster sizes, pill grids, the bottom menu, and button boxes stay the same on all three, so screens do not reflow; a long line may wrap once at Large. Do not follow the phone’s own text-size setting (`text-size-adjust: 100%` stays). *Do not implement until user asks.*

**Home / landing**

- [ ] **Weekend landing page — “New this week” (agreed 2026-09-26, not built):** Shown as the home page **Thursday night through Sunday**; **Monday–Wednesday** keep the usual home. Elegant and sparse: **one featured title**, then a **Just arrived** (streaming) row, then an **In theaters** row (streaming row sits **above** in theaters). **Feature pick:** a new release in the user's **Where you watch** region that someone in their circle already rated; if none, the biggest streaming premiere this week; if none, the widest theatrical opening. The same feature stays up Thursday night through Sunday. Talk and news never qualify. **Ratings are secondary:** small circle score when one exists, no big empty score, TMDB percent (if shown) stays small. **Logged-out visitors** see the page too: no circle, so the feature is the biggest streaming premiere; default region **United States**; no circle scores; a small **Get Started** link; the list is visible before sign-in. **Mock only, not in the app:** `canvases/new-this-week-landing-mock.canvas.tsx` (Cursor project canvases folder, outside the repo; do not move it into the repo). *Do not implement until user asks.*
- [ ] **Startup — no login flash; one rotating Cinemastro icon (agreed 2026-09-26, not built):** Today opening Cinemastro shows the **login screen for a quick second**, then a **circle loading icon** for a while, then **Circles**. *Goal:* don't show the login screen while the app is still checking the saved session; **one rotating Cinemastro icon** covers the whole wait (session check + the following load) until Circles opens. If the person is **actually signed out**, the icon stops and the real login screen appears. It **must not spin forever**. *Do not implement until user asks.*

**Circles**

- [x] **Ghost “My circles” after leave (creator SELECT + empty nested members):** **Shipped 7.0.49** — **`get_my_circles()`** RPC + **`fetchMyCircles`** uses **`supabase.rpc`** (*optional follow-up:* **`fetchCircleDetail`** still table **`select`*).
- [x] **Recent strip “Earlier” scroll jump:** **Shipped 7.0.54** — prepend width restores **`scrollLeft`**.
- [x] **Zero active circles nudge (returning raters):** **Shipped 7.0.56** — Circles banner + modal (**2-day** modal cooldown); resets when user has an active circle.
- **§8 — Invites at max circles:** Today **`auto_declined`** — recipient never sees invite. *Goal:* muted row (“at cap”) + creator pending until resolved.
- **§9 / 4b — Remove member:** Hosts remove another member (**`circle_members` DELETE`** is **self-only** today).
- [ ] **Circle rating notifications — name the rater (agreed 2026-09-26, not built):** Alert should say who rated, e.g. **“Alex rated Reacher, Season 1”** (today it only says a title was rated, so with 3+ raters the new person isn't obvious); opening that title's ratings should show the **newest rating first**; a repeat save from someone who already rated that title stays quiet or folds into the same line, so the circle isn't pinged on every score edit. *Do not implement until user asks.*
- [x] **Title screen — From your circles (shipped locally 7.0.125–7.0.129, not committed):** Card when at least one *other* person in a shared circle has published the title. Green label matches **Your rating saved**. Text is **2 ratings from your circles** (**circle** if the viewer belongs to one circle; **1 rating** if one other person). Second line **Click to view**. The current user’s rating is excluded from the count and the list. **X** closes the window and leaves the title open. List scrolls; film title and **X** stay fixed. Circle name on a line when the viewer belongs to more than one circle. TV uses the same season lines as **Rated by**. Hidden when nobody else has published.

**Watchlist / invites / ratings**

- **§17 — Watchlist:** Show **circle name** via **`source_circle_id`** (partial today).
- **§18 — Invite → non-user email (deferred row):** **Partially unblocked:** **share link** **`/join/:token`** shipped (**7.0.44**); in-app email path still requires existing account (**`send-circle-invite`**). **Parked:** DB deferred-invite row + email-outreach without account; phone / contact-hash / scoped display-name search remain backlog.
- **§19 — Bayesian normalization:** **TBD.**

**Account & data**

- [x] **Auth — show password (7.0.59):** Eye toggle on sign-up / sign-in / reset (**`aria-label`** show/hide); mode change resets visibility.

- [x] **Clear / delete a rating (per title):** **Shipped 7.0.42** — title detail **Clear rating** + migration.

- [x] **Delete account (7.0.86 staging + prod web):** Self-service + privacy copy. Edge **`1.0.0`** + SQL **`20260918153000`** applied **staging + prod**. Throwaway smoke both envs (Auth user gone).

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
5. **Trademark status:** If the user asks where to check USPTO / TSDR / trademark status, immediately show **https://tsdr.uspto.gov** + serial **99792884** (see **§ USPTO trademark**).

---

## Keep in mind every session

- **`COMPUTE-NEIGHBORS-CRON.md`** — Vault, secrets, `pg_net`, staggered schedules.
- Staging-only **`git push`** unless user asks for production.

---

## Supabase migrations checklist (hosted DB)

| Migration | Purpose |
|-----------|---------|
| **`20260925120000_season_ratings.sql`** | Season scores, `ratings_effective`, circle publisher lines. **User: applied prod 2026-10-08.** Redeploy **`match` `1.0.1`** and **`compute-neighbors` `1.0.2`** (done on prod that night). |
| **`20260924140000_pulse_catalog_daily_region_ca.sql`** | Pulse region check allows **CA**. **User: applied prod 2026-10-08** after **`20260924130000`**. |
| **`20260924130000_pulse_catalog_daily_region.sql`** | Pulse key **`(utc_date, region)`**, regions **US** / **IN**. **User: applied prod 2026-10-08.** |
| **`20260924120000_profiles_availability_region.sql`** | **`profiles.availability_region`** + **`show_language_first`**. **User: applied prod 2026-10-08** (column check had returned no rows before the run). |
| **`20260918153000_prepare_account_deletion.sql`** | **`prepare_account_deletion()`** — leave/transfer circles, wipe public user rows before Edge **`delete-account`**. **Applied staging + prod.** |
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

**Last session (2026-10-08)**

- **Last note (2026-10-08):** Local **7.0.129** is not committed. Circle card is accepted: green label like **Your rating saved**, first line **2 ratings from your circles**, second line **Click to view**, current user excluded. User reconfirmed **confirm password** is a local check only; it stays parked. **Next backlog item is Profile text size.** They still want this local version released before leaving for India (about **2026-10-11**). Ship only when they ask. Do not add Canada/India store countries until that build is live. Prod SQL and the three Edge functions are in; email templates have **`{{ .Token }}`**. India trademark they will start themselves; not required to release. US serial **99792884**, filed **2026-04-28**, priority window about **2026-10-28**.

- **Last note (2026-10-05):** User asked to **park** (not build) a Profile **text size** choice: **Small** (today’s size), **Medium**, **Large**. Reading text only; posters, pills, bottom menu, and button boxes stay put. Do not follow the phone text-size setting. Logged under **§ Master list → Product — prioritized next builds → Profile**.

- **Last note (2026-10-05), shipped locally 2026-10-08:** **In your circles** was parked, then built and revised through **7.0.129**. See the **2026-10-08** last note. Do not rebuild it.

- **Last note (2026-10-04):** User asked to **park** (not build) a **confirm password** field on Create account. Logged under **§ Master list → Product — prioritized next builds → Onboarding / first-run**. Profile “saved” confirmation was discussed and left as-is.

- **Last note (2026-09-26):** User asked to **park** (not build) the startup **login flash** fix — one rotating Cinemastro icon instead of login flash + circle spinner, login only if actually signed out, never spins forever. Logged under **§ Master list → Product — prioritized next builds → Home / landing**.

- **Last note (2026-09-26):** User asked to **park** (not build) the **New this week** weekend landing page (Thu night–Sun home; feature + Just arrived + In theaters). Logged under **§ Master list → Product — prioritized next builds → Home / landing**; mock is in the Cursor canvases folder only.

- **Last note (2026-09-26):** User asked to **park** (not build) the circle rating notification idea — name the rater, newest rating first, quiet repeat saves. Logged under **§ Master list → Product — prioritized next builds → Circles**.

- **Last note (2026-09-24):** **7.0.89** local — India In Theaters + title cert/date/where-to-watch. Streaming and Pulse not switched yet. SQL **`20260924120000`** applied on staging. Not committed. iOS **7.0.87 (16)** in review. Play **Production in review**. Store CA/IN after Play is live. Check **`COMPUTE-NEIGHBORS-CRON.md`** if MAU jumps after approval.

- **Shipped:** **7.0.87** on **`origin/staging` + `origin/main`** — Recent posters drop corner badge; **1 of 11 rated** under orange pill; same on All/Top; hidden for solo circles. Web-only.

- **Supabase refs (do not swap):** **staging** **`lovpktgeutujljltlhdl`**; **prod** **`uwexmfmkaifvddnfuvpg`**.

- **Parked:** CA/IN region work; confirm-email custom scheme / https interstitial (Mail works; Cox miss was webmail); **§1g.k**; Android status-bar overlap (needs AAB); **1a–1e**, **§1f**, **§1g.1**.

---

*Trim **Open / follow-ups** when updating; archive older narrative to **`PASSDOWN-ARCHIVE.md`** if needed.*
