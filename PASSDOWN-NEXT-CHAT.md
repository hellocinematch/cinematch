# Passdown for next chat (Cinematch)

**Last updated:** 2026-04-28 — **`package.json` at 7.0.10**. **`git pull`** **`main`** — **`git status`** for local drift. **Deep history:** **`PASSDOWN-ARCHIVE.md`**. **Stable product depth:** **`HANDOFF.md`** § stable product reference.

**Recent releases (high level):** **7.x:** **`src/pages/`** extracts (**`PulsePage`**, **`InTheatersPage`**, **`SecondaryRegionPage`**); Circles stay in **`App.jsx`** for now. **7.0.4** — Your Picks **Refresh**. **7.0.5–7.0.10** — Circles list UX (**trail**, unseen badge **gold**, **DD/MM/YY** dates); **7.0.10** — **`latest_share_at`** (anyone’s share time), unseen still others-only (**RPC** **`get_my_circle_unseen_counts`** + migration **`20260605120000`**). Earlier **6.1.x** streaming / regions — **`CHANGELOG`**.

**Single checklist:** Use **§ Master list (maintained)** below as the one place to track next work (product + ops + analytics). Older § breakdowns were folded into it.

---

## Tell the next chat (copy from here)

> Cinematch — trust **`package.json`** / **`CHANGELOG.md`** (**7.0.10**). **`git pull`** (latest **`main`**). **`git status`** if unsure. Read **`@PASSDOWN-NEXT-CHAT.md`** + **`.cursor/rules/cinematch-discussion-first.mdc`** + **`.cursor/rules/cinematch-handoff.mdc`**. **Don’t change app code** unless I say *code now* / *implement* / *fix* / *do it* (or clearly ask for code). **Passdown edits** on request; after those, give **“What to tell the next chat”**.
>
> **Shipped (high level):** **7.0.0–7.0.10** — **`pages/`**; Circles list (**trail**, gold unseen, **latest_share_at**, DD/MM/YY); Your Picks refresh. **Analytics DB:** **`analytics_events`**, **`watch_chain_events`**, RPCs **`log_analytics_event`** / **`log_watch_chain_event`** (migrations **`20260606120000`**, **`20260607120000`**); admin SQL under **`scripts/sql/analytics-admin/`**. Prior **6.1.x** — **`CHANGELOG`**.
>
> **Master list:** **`PASSDOWN-NEXT-CHAT.md`** → section **Master list (maintained)** (prioritized backlog + ops + analytics wiring + parked).
>
> **Ops:** Prod migrations if missing (checklist in same file). **Edge** invite fns **1.0.2**. **Vercel** = **`main`**. **cron/MAU** → **`COMPUTE-NEIGHBORS-CRON.md`**.

---

## Snapshot (read this first)

| Item | State |
|------|--------|
| **App version** | **7.0.10**; **Cinemastro** = **`APP_VERSION`**. Confirm **`CHANGELOG`**. |
| **Git** | **`main`** includes Circles **7.0.x** + **`scripts/sql/analytics-admin/`**. Ensure **`supabase/migrations/20260606120000_*`** + **`20260607120000_*`** are **committed/pushed** if not already (repo ↔ prod parity). |
| **Supabase — apply if missing** | See **migrations checklist** below + analytics migrations above. |
| **Analytics instrumentation** | DB + RPCs can be applied on prod; **client still must call** **`log_analytics_event`** / **`log_watch_chain_event`** — **not wired** in **`App.jsx`** until implemented. |
| **Edge** | Invite fns **1.0.2** (**6.1.4+** host = **`admin`** only). Bump **`EDGE_FUNCTION_VERSION`** when behavior changes; redeploy. **`get-circle-rated-titles`** — **`git push` does not deploy** Edge. |
| **Client deploy** | **Vercel** on **`main`** push; SQL migrations **not** auto-applied. |

**Where detail lives:** **`HANDOFF.md`**, **`CHANGELOG.md`**, **`PASSDOWN-ARCHIVE.md`**.

---

## Master list (maintained)

*One checklist — product, ops, analytics. § numbers reference legacy HANDOFF/passdown numbering.*

### Repo / ops / parity

- [ ] **Git:** Confirm **`main`** has **`20260606120000_analytics_and_watch_chain_events.sql`** and **`20260607120000_log_analytics_watch_chain_rpc.sql`** committed and pushed if prod/local DB already ran them.
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

1. Read **this file** early — prioritize **Master list (maintained)**.
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

**Last session (2026-04-28)**

- **Last note:** User asked for a **single maintained list** in **`PASSDOWN-NEXT-CHAT.md`** — consolidated **prioritized backlog**, **ops**, **analytics DB/RPC/instrumentation**, **parked** § references, **locked** invite-email decision into **§ Master list (maintained)**; bumped snapshot to **7.0.10** and analytics migrations checklist.

---

*Trim **Open / follow-ups** to the last one or two sessions when updating; archive older bullets to **`PASSDOWN-ARCHIVE.md`** if they contain unique decisions.*
