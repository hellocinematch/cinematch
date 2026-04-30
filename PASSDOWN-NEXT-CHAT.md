# Passdown for next chat (Cinematch)

**Last updated:** 2026-04-29 — trust **`package.json` / `CHANGELOG.md`** (**7.0.18**). **Priority 1 product:** US geo banner / residency notice (see **Master list**). **`git pull`** **`main`** **and** **`staging`** — **`git status`** for local drift. **Deep history:** **`PASSDOWN-ARCHIVE.md`**. **Stable product depth:** **`HANDOFF.md`**.

**Recent releases (high level):** **7.0.18** — public **Beta** labeling: nav pill (**`product-beta-pill`**), **About** / **Profile** version lines; **`index.html`** title + **`application-name`**; **`site.webmanifest`** display **name**; toggle **`src/productLabels.js`** **`PUBLIC_BETA_LABEL`** for GA. App commit **`34c645d`**; branch tips may include later docs (**e.g.** passdown **`e8372d4`**). **7.0.16–7.0.17** — **`aboutPage.jsx`** **`/about`** hub; **`AppFooter`** removed; **Terms** §23–27 incl. **TMDB API Usage**. Earlier — **`CHANGELOG`**.

**Single checklist:** Use **§ Master list (maintained)** below as the one place to track next work (product + ops + analytics). Older § breakdowns were folded into it.

---

## Tell the next chat (copy from here)

> Cinematch — trust **`package.json`** / **`CHANGELOG.md`** (**7.0.18**). **`git pull`** **`origin/main`** **and** **`origin/staging`**. **`git status`** if unsure. Read **`@PASSDOWN-NEXT-CHAT.md`** + **`.cursor/rules/cinematch-discussion-first.mdc`** + **`.cursor/rules/cinematch-handoff.mdc`**. **Don’t change app code** unless *code now* / *implement* / *fix* / *do it*.
>
> **Git / Vercel:** **`staging`** branch → **staging** Vercel project (Production branch **`staging`**, e.g. nine-sigma **`*.vercel.app`**). **`main`** → **prod** Vercel (**`www.cinemastro.com`**). Ship **staging**: push commits to **`staging`**. Ship **prod**: merge **`staging` → `main`** then push **`main`** (or PR).
>
> **Shipped (app tip `34c645d`):** **Beta** UI (**`src/productLabels.js`** **`PUBLIC_BETA_LABEL`**), **`/about`**, nav **About**, Terms §23–27 / TMDB. Analytics migrations **`20260606`**/**`07`** — **commit** + prod/staging apply when instrumenting (**check untracked** **`git status supabase/migrations`**).
>
> **Prod backend:** Separate prod Supabase (often cloned from staging); Vault **`project_url`** / **`supabase_anon_key`** / **`compute_neighbors_cron_secret`** must match **prod** (not staging refs). Edge functions deployed to prod; **`pg_cron`**/**`pg_net`** jobs — **`COMPUTE-NEIGHBORS-CRON.md`**.
>
> **Master list:** **P1** US geo banner; **Account & data** — delete rating / account; analytics **`log_analytics_*`** wire; Circles §8/§9; rest in **`PASSDOWN-NEXT-CHAT.md`**.
>
> **Ops:** **`COMPUTE-NEIGHBORS-CRON.md`** — **`jobs × limit`** vs MAU. **Edge** invite **1.0.2**. **`git push` does not deploy** Edge — **`supabase functions deploy`** per **`HANDOFF.md`** project ref.

---

## Snapshot (read this first)

| Item | State |
|------|--------|
| **App version** | **7.0.18**; **Beta** toggle **`src/productLabels.js`** **`PUBLIC_BETA_LABEL`**. Confirm **`CHANGELOG`**. |
| **Git / Vercel** | **`staging`** branch → **staging** site (Vercel Production branch **`staging`**). **`main`** → **prod** (**`www.cinemastro.com`**). **`7.0.18`** app **`34c645d`**; **`main`** may be ahead with docs-only commits (**e.g.** **`e8372d4`** passdown). **`git pull`** both branches when switching machines. |
| **Supabase — apply if missing** | See **migrations checklist** below. Analytics **`20260606`**/**`07`** may still need **`git add`**/**commit** — align repo; apply per env (**staging** vs **prod**). |
| **Analytics instrumentation** | DB + RPCs when migrations applied; **client** **`log_analytics_event`** / **`log_watch_chain_event`** — **not wired** in **`App.jsx`** yet. |
| **Edge** | Invite fns **1.0.2**. Bump **`EDGE_FUNCTION_VERSION`** when behavior changes; redeploy **per Supabase project** (**staging** vs **prod**). |
| **Client deploy** | **Vercel** builds from Git branch per project; SQL migrations **not** auto-applied. |

**Where detail lives:** **`HANDOFF.md`**, **`CHANGELOG.md`**, **`PASSDOWN-ARCHIVE.md`**.

---

## Master list (maintained)

*One checklist — product, ops, analytics. § numbers reference legacy HANDOFF/passdown numbering.*

### Priority 1 — US geo / availability (product)

- [ ] **Geo-blocking banner or notice:** Infer location (**IP / Edge / CDN**, optional **user confirms US residency**) and show non-US users: **"Cinemastro is currently available to US users only."** Choose **warn-only (proceed at own risk)** vs **hard block** — **TBD** with Terms/privacy. *(Not implemented — discussion in chat.)*

### Repo / ops / parity

- [ ] **Branches:** Routine — commit on **`staging`**, push **`origin/staging`** → test staging URL; merge **`staging` → `main`**, push **`origin/main`** → prod. Keep **`staging`** rebased/merged from **`main`** periodically if both diverge.
- [ ] **Git:** Ensure **`supabase/migrations/20260606120000_analytics_and_watch_chain_events.sql`** and **`20260607120000_log_analytics_watch_chain_rpc.sql`** are **committed on `main`** if prod (or team) expects them in repo — fix **`git status`** drift.
- [ ] **Prod migrations:** Apply any checklist rows still missing (below); verify **`20260605`** (**`latest_share_at`**), **`20260606`** (analytics tables), **`20260607`** (analytics RPCs) on prod when instrumenting.
- [ ] **Neighbors / MAU:** **`COMPUTE-NEIGHBORS-CRON.md`** — audit `compute-neighbors-w*` coverage as users grow.

### Analytics / BD (instrumentation)

- [ ] **Client:** Wire **`supabase.rpc('log_analytics_event', …)`** (funnel: impression, detail open, **`providers_visible`** / **`streaming_section_rendered`**, **`exposure_surface`**, **`circle_id`** when known).
- [ ] **Client:** Wire **`supabase.rpc('log_watch_chain_event', …)`** on rating submit (**`prior_rating_exists`**, influencer + **`last_qualifying_exposure_at`**, **`viewer_rated_at`** per product rules).
- [ ] **Admin reporting:** **`scripts/sql/analytics-admin/*.sql`** — edit date windows; optional BI later.

### Product — prioritized next builds

**Circles**

- **§8 — Invites at max circles:** Today **`auto_declined`** — recipient never sees invite. *Goal:* muted row (“at cap”) + creator pending until resolved.
- **§9 / 4b — Remove member:** Hosts remove another member (**`circle_members` DELETE`** is **self-only** today).

**Watchlist / invites / ratings**

- **§17 — Watchlist:** Show **circle name** via **`source_circle_id`** (partial today).
- **§18 — Invite → non-user email:** Full path beyond copy-to-mail — **TBD**.
- **§19 — Bayesian normalization:** **TBD**.

**Account & data**

- [ ] **Delete a rating:** User-facing control to remove a title rating (detail / scores UX); define cascade (**circles**, **`rating_circle_shares`**, neighbors / predictions recompute, analytics — **TBD**).
- [ ] **Delete account:** Self-service account deletion (**Supabase Auth** + rows cleanup / retention); align copy with **Privacy** and legal.

**Security**

- **§20 — `ACCOUNT-SECURITY.md`:** OAuth, CAPTCHA, optional phone.

**Engineering — platform (§21–30)**

- **§21** Code-splitting (**`lazy()` + `Suspense`**).
- **§22** Fetch waterfalls / skeletons first.
- **§23** Split **`App.jsx`** → **`pages/*`** (Circles intentionally remain in **`App.jsx`**).
- **§24–27** Caching / image opt / thumbs / prefetch (optional).
- **§28** Supabase hot paths (indexes, N+1, RLS cost).
- **§29** Fonts subset / **`font-display`**.
- **§30** PWA service worker (optional).

**Polish**

- **§36 — Circle strip tabs:** **Top** vs **Most rated** copy (**`HANDOFF.md`** item 11).

### Locked decisions (don’t reopen without explicit ask)

- **Circle invites:** Keep **email-based** invites for now (no WhatsApp-style name-only discovery).

### Parked — revisit later

*Not in prioritized queue; many partially shipped — see **`CHANGELOG`***

**Circles / feeds:** §1 tail (at-cap overlaps §8); §2 full mail path → §18; §6 Phase B push/Realtime; §6b strip **`predict_cached`**; §7 unseen polish; §10/4c unpublish; §11/4d polish; §12/4e solo grace.

**Discovery / polish:** §13 **`profiles.handle`**; §14–§16 archived UI / Phase E / watchlist on Circles landing.

**Ops / quality:** §31 prod migrations docs; §32 docs sync; §33 marketing stats; §34 cron vs MAU; §35 **`AppPrimaryNav`** lint.

---

## How the user wants to work

**Unless they clearly ask for code in the same message**, treat messages as **discussion only** — no repo edits. **Implement** after **`code now`**, **yes** to “implement now?”, or **implement / fix / migrate / do it** for that task. Full rule: **`.cursor/rules/cinematch-discussion-first.mdc`**.

**When you ship product code:** bump **`package.json`** + **`CHANGELOG.md`** in the same release. **Edge:** bump **`EDGE_FUNCTION_VERSION`** + redeploy.

**HANDOFF.md** — may lag version — trust **`package.json`** for release.

---

## For the assistant (every Cinematch session)

1. Read **this file** early — prioritize **Priority 1** (US geo banner) then **Master list** rest.
2. **Neighbors / MAU:** **`COMPUTE-NEIGHBORS-CRON.md`**. Audit:  
   `select jobname, schedule from cron.job where jobname like 'compute-neighbors-w%';`
3. **Passdown updates:** edit **this file**; **commit + push** for remote. On **“update passdown”** / handoff: same reply must include **“What to tell the next chat”** (see **`.cursor/rules/cinematch-handoff.mdc`**).
4. **Last note:** merge the session’s **final** user note into **Open / follow-ups** — not only a version bump.

---

## Keep in mind every session

- **`COMPUTE-NEIGHBORS-CRON.md`** — Vault, secrets, `pg_net`, staggered schedules.
- Do not assume one cron wave covers everyone forever — add jobs / **`offset`** as MAU grows.

---

## Supabase migrations checklist (hosted DB)

Apply any that are missing on prod (user often uses SQL editor):

| Migration | Purpose |
|-----------|---------|
| **`20260607120000_log_analytics_watch_chain_rpc.sql`** | **`log_analytics_event`**, **`log_watch_chain_event`**, **`_analytics_metadata_clamp`**. |
| **`20260606120000_analytics_and_watch_chain_events.sql`** | **`analytics_events`**, **`watch_chain_events`**, enums, RLS. |
| **`20260605120000_get_my_circle_unseen_counts_latest_share_at.sql`** | **`latest_share_at`** on **`get_my_circle_unseen_counts`**. |
| **`20260604120000_get_circle_pending_invite_labels.sql`** | RPC **`get_circle_pending_invite_labels`** — Circle info **Invites pending** (**6.1.5**). |
| **`20260603120000_leave_circle_admin_only.sql`** | **`leave_circle`**, admin-only roles, last member deletes circle (**6.1.4**). |
| **`20260602120000_get_circle_title_publishers.sql`** | RPC **`get_circle_title_publishers`** — **3b** / **Rated by**. |
| **`20260601120000_circle_members_admins_moderator_rls.sql`** | **`admin`**, **`is_circle_moderator`**, RLS (**6.0.28** / **6.1.4**). |
| **`20260527120000_circle_member_last_seen.sql`** | **last_seen** + unseen badges (**5.6.33**). |
| **`20260529120000_creator_leave_transfer_ownership.sql`** | Legacy creator-leave era; apply if DB predates admin-only work. |
| **`20260528120000_circle_strip_share_activity_order.sql`** | Strip ordering (share **`created_at`**). |
| **`20260524120000_rating_circle_shares.sql`** | **`rating_circle_shares`** + feeds — **required** for circle rated titles. |
| **`20260523120000_watchlist_sort_index.sql`** | **`watchlist.sort_index`**. |
| **`20260525120000_watchlist_max_30.sql`** | **30** rows cap + trigger. |
| **`20260526120000_watchlist_rls_update_own.sql`** | RLS **update** own watchlist (reorder). |
| **`20260522120000_circles_rated_all_top_grid.sql`** | All/Top RPCs; redeploy **`get-circle-rated-titles`**. |
| **`20260506120000_circles_strip_recent_activity.sql`** | Strip ordering. |
| **`20260505120000_circles_name_length_2_32.sql`** | Name length. |
| **`20260503120000_get_circle_member_names.sql`** | **`get_circle_member_names`**. |
| **`20260504120000_profiles_name_not_null.sql`** | Optional. |

**Edge:** **`get-circle-rated-titles`** — **`git push` does not deploy** — `supabase functions deploy` (project ref in **`HANDOFF.md`**).

---

## Open / follow-ups

**Handoff rule:** merge the prior session’s **last user note** here under **Last session** when you update this file. **Shipped truth:** **`CHANGELOG`** / **`package.json`**.

**Last session (2026-04-29)**

- **Last note:** User asked to **update passdown** after **merge `staging` → `main`** and prod ship. **Shipped:** **`7.0.18`** **Beta** labeling (**`34c645d`** on **`main`**/**`staging`**); **`staging`**/**`main`** workflow + dual Vercel (staging branch vs **`www.cinemastro.com`** prod); prod Supabase/Vault/Edge/cron/domain work completed this arc (verify cron waves vs MAU). **GA:** set **`PUBLIC_BETA_LABEL`** **`false`** and revert **`index.html`** / **`site.webmanifest`** names if dropping Beta from tab/install title.
- **Prior:** **`ecd4f15`** era — About hub, Terms TMDB, no footer. **Open:** analytics migrations **git parity** + client **`log_analytics_*`**; **P1** US geo banner; **`COMPUTE-NEIGHBORS-CRON.md`** coverage as users grow; Account delete rating/account backlog.

---

*Trim **Open / follow-ups** to the last one or two sessions when updating; archive older bullets to **`PASSDOWN-ARCHIVE.md`** if they contain unique decisions.*
