# Passdown for next chat (Cinematch)

**Last updated:** 2026-04-28 — **`package.json` at 7.0.8**. **`git pull`** **`main`** — **`git status`** for local drift. **Deep history:** **`PASSDOWN-ARCHIVE.md`**. **Stable product depth:** **`HANDOFF.md`** § **Stable product reference**.

**Recent releases (high level):** **7.0.0–7.0.8** — **7.x** line: presentational **`src/pages/`** — **`PulsePage`**, **`InTheatersPage`**, **`SecondaryRegionPage`** (state/effects stay **`App.jsx`**; user preference to **keep Circles** in **`App.jsx`** for now). **7.0.4** — **Your Picks** **For you** **Refresh** = gold **`button`** + **`aria-label`**. **7.0.5–7.0.8** — **Circles list:** removed row **Edit** (edit via **Circle info**); unseen = solid **WhatsApp-style** green disc (**`#25d366`**, black digit); **last activity** from **`get_my_circle_unseen_counts`** **`latest_others_share_at`** (today → local time, **Yesterday** no time, weekday, then short date); **7.0.8** **`.circle-card__trail`** column (time above badge) so timestamp **doesn’t shift left** when unseen shows. Earlier **6.1.x** streaming / secondary Indian / stagger / genres — **`CHANGELOG`**.

---

## Tell the next chat (copy from here)

> Cinematch — trust **`package.json`** / **`CHANGELOG.md`** (**7.0.8**). **`git pull`** (latest **`main`** includes this passdown). **`git status`** if unsure. Read **`@PASSDOWN-NEXT-CHAT.md`** + **`.cursor/rules/cinematch-discussion-first.mdc`** + **`.cursor/rules/cinematch-handoff.mdc`**. **Don’t change app code** unless I say *code now* / *implement* / *fix* / *do it* (or clearly ask for code). **Passdown edits** on request; after those, give **“What to tell the next chat”**.  
> **Shipped (high level):** **7.0.0–7.0.8** — **`pages/`** extracts (Pulse, In Theaters, Secondary Region); **Your Picks** refresh control; **Circles list** UX (trail + unseen + last activity). Prior **6.1.x** streaming / regions — **`CHANGELOG`**.  
> **Backlog:** **§ Prioritized** = **§8**, **§9 / 4b**, **§17–20**, **§21–30**, **§36**. **§ To be decided later** = rest (**§6b**, **§10 / 4c**, **§12 / 4e**, **§13–16**, **§31–35**, …).  
> **Ops:** Prod migrations if missing (**`20260603`**, **`20260604`**, … — § checklist). **Edge** invite fns **1.0.2**. **Vercel** = **`main`**. **cron/MAU** → **`COMPUTE-NEIGHBORS-CRON.md`**.

(Adjust or shorten if the next task is something else.)

---

## Snapshot (read this first)

| Item | State |
|------|--------|
| **App version** | **7.0.8**; **Cinemastro** = **`APP_VERSION`**. Confirm **`CHANGELOG`**. |
| **Git** | **`main`** through **7.0.8** (page extracts, Circles list, Your Picks refresh). |
| **Supabase — apply if missing** | See **migrations checklist** below. |
| **Edge** | Invite fns **1.0.2** (**6.1.4+** host = **`admin`** only). Bump **`EDGE_FUNCTION_VERSION`** when behavior changes; redeploy. |
| **Client deploy** | **Vercel** on **`main`** push; SQL migrations **not** auto-applied. |

**Where detail lives:** **`HANDOFF.md`**, **`CHANGELOG.md`**, **`PASSDOWN-ARCHIVE.md`**.

---

## How the user wants to work

**Unless they clearly ask for code in the same message**, treat messages as **discussion only** — no repo edits. **Implement** after **`code now`**, **yes** to “implement now?”, or **implement / fix / migrate / do it** for that task. Full rule: **`.cursor/rules/cinematch-discussion-first.mdc`**.

**When you ship product code:** bump **`package.json`** + **`CHANGELOG.md`** in the same release. **Edge:** bump **`EDGE_FUNCTION_VERSION`** + redeploy.

**HANDOFF.md** — may lag version — trust **`package.json`** for release.

---

## For the assistant (every Cinematch session)

1. Read **this file** early for workflow, **backlog**, **ops checklist**, **last session**.
2. **Neighbors / MAU:** **`COMPUTE-NEIGHBORS-CRON.md`**. Audit:  
   `select jobname, schedule from cron.job where jobname like 'compute-neighbors-w%';`
3. **Passdown updates:** edit **this file**; **commit + push** for remote. On **“update passdown”** / handoff: same reply must include **“What to tell the next chat”** (see **`.cursor/rules/cinematch-handoff.mdc`**).
4. **Last note:** merge the session’s **final** user note into **Open / follow-ups** — not only a version bump.
5. **Backlog:** **§ Prioritized** vs **§ To be decided later** — keep them consistent when priorities shift.

---

## Keep in mind every session

- **`COMPUTE-NEIGHBORS-CRON.md`** — Vault, secrets, `pg_net`, staggered schedules.
- Do not assume one cron wave covers everyone forever — add jobs / **`offset`** as MAU grows.

---

## Supabase migrations checklist (hosted DB)

Apply any that are missing on prod (user often uses SQL editor):

| Migration | Purpose |
|-----------|---------|
| **`20260604120000_get_circle_pending_invite_labels.sql`** | RPC **`get_circle_pending_invite_labels`** — Circle info **Invites pending** lines (**6.1.5**). |
| **`20260603120000_leave_circle_admin_only.sql`** | **`leave_circle`**, admin-only roles, last member deletes circle; drops **`creator_leave_circle`** (**6.1.4**). |
| **`20260602120000_get_circle_title_publishers.sql`** | RPC **`get_circle_title_publishers`** — **3b** / **Rated by**. |
| **`20260601120000_circle_members_admins_moderator_rls.sql`** | **`admin`**, **`is_circle_moderator`**, RLS — hosts / edit+invite (**6.0.28**; evolved in **6.1.4**). |
| **`20260527120000_circle_member_last_seen.sql`** | **last_seen** + unseen badges (**5.6.33**). |
| **`20260529120000_creator_leave_transfer_ownership.sql`** | Legacy **creator leave** RPC era; **6.1.4+** uses **`leave_circle`** — apply if DB predates admin-only work (repo order / prod history). |
| **`20260528120000_circle_strip_share_activity_order.sql`** | Recent strip ordering (forward / share `created_at`). |
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

## Prioritized backlog (next builds)

*Legacy § numbers in parentheses. Trust **`package.json`** / **`CHANGELOG`** for what shipped.*

### Circles

- **Invites at max circles (§8):** Today **`auto_declined`** — recipient never sees invite. *Goal:* muted row (“at cap”) + creator pending until resolved.
- **Remove member / 4b (§9):** **Hosts** **remove** another member (today **`circle_members` DELETE** is **self-only**).

### Watchlist, invites, ratings

- **Watchlist rows — circle name (§17):** Show circle name via **`source_circle_id`** (partial today).
- **Invite → non-user email — full path (§18):** Beyond copy-to-mail — **TBD**.
- **Bayesian normalization (§19):** **TBD**.

### Security & trust

- **`ACCOUNT-SECURITY.md` (§20):** OAuth, CAPTCHA, optional phone — see file.

### Engineering — performance & platform (§21–30)

21. **Code-splitting:** **`lazy()` + `Suspense`**.  
22. **Fetch waterfalls:** shell + skeletons first.  
23. **Split `App.jsx`:** → **`pages/*`** (**`HANDOFF.md`**). *In progress:* **`PulsePage`**, **`InTheatersPage`**, **`SecondaryRegionPage`**; **Circles** intentionally still in **`App.jsx`**.  
24. **Caching:** Vercel CDN; optional short TTL.  
25. **Vercel Image Optimization (optional).**  
26. **Smaller thumbs (optional):** e.g. **`w185`**.  
27. **Prefetch (optional)** — careful on cellular.  
28. **Supabase hot paths:** indexes, avoid N+1, RLS cost.  
29. **Fonts:** subset / **`font-display`**.  
30. **PWA service worker (optional).**

### Small product polish

- **Circle strip tabs (§36):** **Top** vs **Most rated** copy — **`HANDOFF.md`** item 11.

**Scan — remove member:** [ ] **4b**

---

## To be decided later

*Not in **Prioritized backlog** right now. Many shipped in whole or part — see **`CHANGELOG`**. Revisit when prioritizing.*

### Circles & feeds (parked)

- **§1 — Invite list & activity — *shipped 6.0.22*.** *Tail:* at-cap UX (overlaps §8).
- **§2 — Copy-to-mail v1 — *shipped 6.0.23–6.0.27*.** Full path = **§18** prioritized.
- **§3 / 4a — Admin hosts — *shipped 6.0.28*.** Superseded in part by **6.1.4+** **`leave_circle`**.
- **§3b — Rated by — *shipped 6.0.29+*.**
- **§4 — Detail Rate this / Rate more — *shipped 6.1.0+*.**
- **§5 — Score chips — *shipped 6.1.1+*.**
- **§6 — Circle activity Phase B:** push, Realtime, Web Push.
- **§6b — Strip `predict_cached` without detail** — deferred post-beta.
- **§7 — Unseen activity polish.**
- **§10 / 4c — Request unpublish.**
- **§11 / 4d — Leave / delete circle** — *shipped 6.1.4+* (last member deletes circle; any extra delete-group UX = polish).
- **§12 / 4e — Solo grace after exodus.**

### Product — discovery & polish (parked)

- **§13 — `profiles.handle`** — schema.
- **§14 — Edit circle** — *shipped*; optional archived UI.
- **§15 — Phase E:** animations, cover, **`icon_emoji`**, color, archived section.
- **§16 — Watchlist on Circles landing.**

### Ops, quality, docs (parked)

- **§31 — Prod migrations** (e.g. watchlist RLS).
- **§32 — Docs sync.**
- **§33 — Marketing stats.**
- **§34 — Cron vs MAU — `COMPUTE-NEIGHBORS-CRON.md`.**
- **§35 — Lint:** **`AppPrimaryNav`** hooks rule.

**Historical:** 4a · 3b · 4 · 5 · 4d — **shipped**; **4c** · **4e** — parked; **4b** — **prioritized**.

---

## Open / follow-ups

**Handoff rule:** merge the prior session’s **last user note** here under **Last session** when you update this file. **Shipped truth:** **`CHANGELOG`** / **`package.json`**.

**Last session (2026-04-28)**

- **Last note:** User asked to **update passdown** after **7.0.8** shipped (**`162fd29`**): Circles list **timestamp alignment** — **`.circle-card__trail`** stacks **last activity** above **unseen** disc so time stays **right-aligned** with cards that have no badge. Prior same arc: **7.0.5–7.0.7** Circles (no list **Edit**, green badge, **`formatCircleListLastActivity`**); **7.0.4** Your Picks **Refresh**; **7.0.1–7.0.3** **`src/pages/`** extracts; **7.0.0** major bump.
- **Passdown:** this file refresh for next chat; commit + push with passdown.

---

*Trim **Open / follow-ups** to the last one or two sessions when updating; archive older bullets to **`PASSDOWN-ARCHIVE.md`** if they contain unique decisions.*
