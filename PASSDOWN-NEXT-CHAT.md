# Passdown for next chat (Cinematch)

**Last updated:** 2026-05-28 — trust **`package.json` / `CHANGELOG.md`** (tip **7.0.65**). **Recent ship:** **title detail** **Cast** + **Director** / **Created by** (text, TMDB **`credits`**, grey panels — **7.0.64**–**7.0.65**); **staging** then **prod** pushed **2026-05-28**. **Backlog item 1 — product:** Your Picks / **For you** CF refresh & diversity (see **Master list**). **`git pull`** **`origin/main`** **and** **`origin/staging`** — both at **`2a4333f`**; **`git status`** for local drift. **Deep history:** **`PASSDOWN-ARCHIVE.md`**. **Stable product depth:** **`HANDOFF.md`**.

**Recent releases (high level):** **7.0.65** — detail **Cast** above **Director** / **Directors** / **Created by**, each in **facts-bar-style** panel. **7.0.64** — same blocks (text-only, **`append_to_response=credits`**). **7.0.63** — Circles strip **circle-only** under-title score. **7.0.62** — Cinemastro/TMDB under-title scores + migration **`20260616120000`**. **7.0.61** — share-invite copy. **7.0.60** onboarding **`obCatalogue`** TMDB discover; **7.0.59** auth **eye** toggle. Earlier — **`CHANGELOG`**.

**Single checklist:** Use **§ Master list (maintained)** below as the one place to track next work (product + ops + analytics). Older § breakdowns were folded into it.

---

## Tell the next chat (copy from here)

> Cinematch — trust **`package.json`** / **`CHANGELOG.md`** (tip **7.0.65**: title detail **Cast** + **Director** / **Directors** / **Created by** — text from TMDB **`credits`**, **Cast** above director block, **grey panels** like facts bar; **7.0.64** first ship). **`git pull`** **`origin/main`** **`origin/staging`** — both at **`2a4333f`** (**7.0.65** on staging + prod). **`git status`** if unsure. Read **`@PASSDOWN-NEXT-CHAT.md`** + **`.cursor/rules/cinematch-discussion-first.mdc`** + **`.cursor/rules/cinematch-handoff.mdc`**. **Don't change app code** unless *code now* / *implement* / *fix* / *do it*.
>
> **Git / Vercel:** Routine ships → **`origin/staging`** only; **`origin/main`** / prod **only when the user explicitly asks**. **`staging`** → staging Vercel; **`main`** → **`www.cinemastro.com`**. **`git pull`** to sync with remote.
>
> **Hosted DB migrations (if behind):** **`20260615120000_platform_growth_daily.sql`** (**`platform_growth_daily`**, **`ratings.created_at`**, **`pg_cron`** **`platform-growth-daily-utc`** at **00:15 UTC** when **`cron`** exists). Plus **`20260614120000`** **`get_my_circles`**; invite / leave migrations per **`CHANGELOG`**. **`/join`:** Edge **`create-circle-invite-link`** / **`preview-circle-invite-link`** (**`verify_jwt = false`**) / **`claim-circle-invite-token`**; **`send-circle-invite`** see repo; **`VITE_PUBLIC_SITE_URL`** on staging for canonical **`/join`** URLs.
>
> **`pg_net` / compute-neighbors:** **`net.http_post`** return id = **`pg_net` queue id** — read **`net._http_response`** for outcome; body `{"mode":"all","offset":N,"limit":K}` chunked until covered (**`COMPUTE-NEIGHBORS-CRON.md`**). Another user clearing a rating recomputes **their** **`user_neighbors`** only until **your** cron / rating / manual invoke.
>
> **Master list:** **Backlog item 1** Your Picks / **For you** diversify + labeled refresh + optional **cap/shuffle/watchlist** tweaks (**Open / follow-ups**). **Priority 2** US geo; analytics **`log_analytics_*`**; Circles §8/§9; **§18** residual; **Resend/SMTP** Auth; optional cache / version nudge; optional **Capacitor / native shell** (stores + native push/badges — **§30**).

---

## Snapshot (read this first)

| Item | State |
|------|-------|
| **App version** | Trust **`package.json`** / **`CHANGELOG`** (**7.0.65** detail cast/crew panels; **7.0.64** TMDB credits text; **7.0.63** circle-only strip score). |
| **Git / Vercel** | **`git pull`** **`origin/main`** & **`origin/staging`**; both at **`2a4333f`** (**7.0.65**) as of **2026-05-28**; **`main`** → **www.cinemastro.com**, **`staging`** → staging Vercel. |
| **Supabase — apply if missing** | **`20260616120000`** (circle RPC **`site_rating`** on **together** rows — **7.0.62**) + **`20260615120000`** (growth stats + **`ratings.created_at`**) + **`20260614120000`** (**`get_my_circles`**) + invite / leave rows — **per env**. |
| **Analytics instrumentation** | Client **`log_analytics_*`** — **not wired** in **`App.jsx`** yet (when DB ready). |
| **Edge** | Invite suite **`create-circle-invite-link`** / **`preview-circle-invite-link`** / **`claim-circle-invite-token`**; **`send-circle-invite`** **1.0.3**; **`pulse-catalog`** `1.0.0`; **`compute-neighbors`** `1.0.1`; **`accept-circle-invite`** **1.0.2** unless bumped. Bump **`EDGE_FUNCTION_VERSION`** when behavior changes; redeploy. |
| **Client deploy** | **Vercel** per branch/project; SQL **not** auto-applied. |

**Where detail lives:** **`HANDOFF.md`**, **`CHANGELOG.md`**, **`PASSDOWN-ARCHIVE.md`**.

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
- **§30** PWA — **7.0.58** shipped **Circles-tab install education modal** (mobile UA); optional **service worker** still backlog unless reopened (**7.0.31** install copy only).
- [ ] **Native shell (Capacitor / Ionic):** Ship **App Store / Play Store** builds pointing at **Vite `dist`** (or hosted origin); unlock **native push**, **badges**, haptics, etc. with minimal React changes — expect **auth / deep-link** hardening + **store review** (thin-wrapper) risk. *Parked — user asked to track; rough revisit ~**3 weeks** from **2026-05-05** (discussion).*

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

1. Read **this file** early — **Backlog item 1 / Priority 1** Your Picks / **For you** diversity; then **Priority 2** US geo then full **Master list**.
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

**Edge:** **`get-circle-rated-titles`**, **`pulse-catalog`**, **invite suite** — deploy after changes; **`git push` does not deploy**.

---

## Open / follow-ups

**Last session (2026-05-28)**

- **Last note:** User asked whether **git** passdown was complete for month-later resume — **no** until this commit; **region-based product** discussion captured under **P2** + above. **Passdown** committed to **`origin/main`** / **`origin/staging`** with tip **`2a4333f`**.

- **Shipped (see `CHANGELOG`):** **7.0.64** title detail **Cast** + **Director** / **Created by** from TMDB **`credits`** (text). **7.0.65** **Cast** above director block; heading + names in **grey panels** (facts-bar style). Flow: **staging** then **prod** at **`2a4333f`**.

- **Git:** **`origin/main`** and **`origin/staging`** at **`2a4333f`** (**7.0.65** app); passdown file tracks same tip after push.

- **Ops (unchanged):** Verify **`20260616120000`** + **`20260615120000`** on hosted DBs if missing; **`pg_cron`** **`platform-growth-daily-utc`**; **`COMPUTE-NEIGHBORS-CRON.md`** as MAU grows.

- **Open:** **Master list** Your Picks **1a–1e**; **P2** US geo; analytics **`log_analytics_*`**; Circles §8/§9; **§18** residual; **Resend/SMTP**; optional cache / version nudge; **Capacitor / native shell** (**§30**) — unchanged unless user reschedules.

---

*Trim **Open / follow-ups** when updating; archive older narrative to **`PASSDOWN-ARCHIVE.md`** if needed.*
