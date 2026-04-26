# Cinematch — session handoff (for the next chat)

This file is the **source of truth** for what to do when you pick up work. In Cursor, open it from the repo or reference it with **`@HANDOFF.md`** (or **`@HANDOFF`**) so the model sees full context.

---

## How the next chat should use this

1. **Read this file first** — `HANDOFF.md` at the repository root:  
   `/Users/tlmahesh/Library/Mobile Documents/com~apple~CloudDocs/Cinematch/HANDOFF.md`
2. **Session handoff:** use **`@PASSDOWN-NEXT-CHAT.md`** for workflow, backlog, ops checklist, and **last session** notes (slim file). Use **this file** for architecture, key paths, and **stable product reference** (PWA, watchlist, caps, circle activity assumptions, strip colors). Deep history: **`PASSDOWN-ARCHIVE.md`**.
3. In Cursor chat, attach it: type **`@HANDOFF.md`** and select the file, or paste: *“Follow `HANDOFF.md`.”*
4. **Version bump rule:** trust **`package.json`** / **`CHANGELOG.md`** for the current release. Bump both whenever you ship product code; add **`CHANGELOG.md`** in the **same release commit** as the first shipping change—not in a handoff-only or docs-only commit. When editing this file, **sync the version called out below** with **`package.json`** so it does not stay stale.

---

## Current state (as of last update)

- **`main` is pushed** to `origin`. Trust **`package.json`** / **`CHANGELOG.md`** for the live version (e.g. **6.1.6** — admin-only **`leave_circle`**, pending invite labels RPC, Circle info layout; see **CHANGELOG**).
- **Prod DB:** apply migrations in **`PASSDOWN-NEXT-CHAT.md`** checklist if missing (includes **`20260603120000_leave_circle_admin_only.sql`**, **`20260604120000_get_circle_pending_invite_labels.sql`**, and earlier Circles + watchlist migrations).
- **Edge functions:** `match`, `compute-neighbors`, `send-circle-invite`, `accept-circle-invite`, and **`get-circle-rated-titles`** must be deployed manually; **git push does not deploy Edge Functions** (`npx supabase@latest functions deploy … --project-ref lovpktgeutujljltlhdl`). Invite fns **1.0.2** with **6.1.4+** admin-only host rules — verify **`edge.version`** in prod. Each function’s `index.ts` has **`EDGE_FUNCTION_VERSION`**; bump the constant whenever that function’s code changes, then redeploy.

---

## Architecture rules (do not break)

- **Landing page is Circles** — no Home-shaped shared shelf.
- **No `React.useState` / `React.useEffect`** in `App.jsx` — use named imports only (prod bundle lesson from v4.0.9).
- **Each page owns its RPC path** — no cross-page borrowing.
- **Circle membership for anyone other than creator seed** → **Edge** + service role; RLS allows creator-seed-self only.
- **Leave circle (6.1.4+):** all members use RPC **`leave_circle`**; last member **deletes** the circle (CASCADE). **`creator_leave_circle`** removed — see **CHANGELOG 6.1.4**. Older “creator leave transfer” narrative applied before admin-only migration.
- **Invite caps:** send-time 10-circle cap → `auto_declined`; accept-time cap → **error**, invite stays `pending` (spec in migration header). **Production numbers** (10 active circles / user, 25 members / circle) and **where to revert** after test-only lower caps: **this file**, § **Circles — production caps (revert from testing)** below.
- **Circle activity (badges + “new activity” on web / PWA):** Product **assumptions** and what happens on **tab switch / resume** — **this file**, § **Circles activity — assumed use (web / PWA v1)** below. Read before tightening lifecycle or moving to **native**.

---

## Key paths

| Area | Location |
|------|----------|
| Main app | `src/App.jsx` — Circles UI ~search `screen === "circles"`, `circle-detail`, `listInvitesShown`, `openInvitesPanel`, `showInviteSheet` |
| Circles helpers | `src/circles.js` — vibes, caps, `fetchMyCircles`, invites, Edge invoke + `FunctionsHttpError` body parsing |
| Circles schema + display contract | `supabase/migrations/20260422120000_circles_schema.sql` (read top comment block before Phase C) |
| RLS hotfix (helpers) | `supabase/migrations/20260423120000_circles_rls_recursion_fix.sql` |
| Phase B RPCs | `supabase/migrations/20260424120000_circles_phase_b_helpers.sql`. Optional: `20260425120000_circles_resolve_email_grant_service_role.sql` (grant-only if DB predates grant line) |
| Edge: invite send/accept / strip | `supabase/functions/send-circle-invite/index.ts`, `supabase/functions/accept-circle-invite/index.ts`, `supabase/functions/get-circle-rated-titles/index.ts` |
| Circle publish (per-group visibility) | `supabase/migrations/20260524120000_rating_circle_shares.sql`; **`syncRatingCircleShares`** / **`fetchRatingCircleShareIds`** in `src/circles.js` |
| Product spec | `Architechture/cinemastro-circles-requirements.md` (path spelling as in repo) |
| Account security roadmap | `ACCOUNT-SECURITY.md` — OAuth, CAPTCHA, optional phone, duplicate-account posture |

**Supabase project ref:** `lovpktgeutujljltlhdl`

---

## Stable product reference

*Moved from the slim **`PASSDOWN-NEXT-CHAT.md`** so the passdown stays small. **CHANGELOG** remains the shipped narrative.*

### PWA / install (5.6.29)

- **`/site.webmanifest`:** `name` / `short_name` **Cinemastro**, **`display: standalone`**, **theme/background** `#0a0a0a`, **`icons`:** **`/pwa-icon-192.png`** then **`/cinemastro-pwa-icon.svg`** (maskable **any**).
- **`/cinemastro-pwa-icon.svg`:** 512×512, **`#0a0a0a`** background, **inlined** wordmark — **larger** type, **~−27°** diagonal (home-screen legibility); **no** “YOUR PERSONAL…” tagline on this asset (still on **`cinemastro-logo.svg`** in-app).
- **`index.html`:** `link rel="manifest"`, `theme-color`, `application-name`, **`apple-touch-icon`** → **`/apple-touch-icon.png`** (180×180).
- **Regenerate PNGs** after editing the master SVG: **`npm run icons:pwa`** (`scripts/generate-pwa-touch-icons.mjs`, **`@resvg/resvg-js`**).
- **Favicon** for tabs/bookmarks: unchanged **`/favicon.svg`**.

### Watchlist (current behavior)

- **DB:** `watchlist` stores **`user_id`**, **`tmdb_id`**, **`media_type`**, **`title`**, **`poster`**, **`sort_index`**, optional **`source_circle_id`**. **Max 30** rows per user — **`WATCHLIST_MAX`** + migration **`20260525120000_watchlist_max_30.sql`** (trim over-cap + insert trigger). At cap: toast; **+ Watchlist** (detail), **Select to Watch** (mood), **Add to watchlist** (circle menu) **disabled**; **Profile** / watchlist screen show **n / 30**. **`toggleWatchlist(movie, { skipGoBack, circleIdForSource })`** for strip/circle.
- **UI meta** (strip + list): **one line** under the title — **`Movie · YYYY · TMDB x.x · Genre`**. Enrichment via **`buildWatchlistFromRows`** + **`catalogue`**. **Detail** = full-fidelity.
- **Profile:** no duplicate **`page-topbar`** under primary nav; hero is **`profile-top`** only.
- **Bottom nav:** **Mood · Watchlist · Profile** — active tab = **faded circle** behind icon (no text labels).
- **Watchlist screen:** vertical **list**, **⋯** = **Details / ⇈ Top / ↑ Up / ↓ Down / ⇊ Bottom / Remove**. **Up** and **Down** swap **`sort_index`** with the adjacent row; **Top** / **Bottom** set **`sort_index`** below the current minimum / above the current maximum for that user (one update each).
- **Reordering (5.6.22–5.6.24):** **`loadUserData`** always rebuilds from **`watchlist`** rows when present (stubs in **`buildWatchlistFromRows`** if catalogue is empty). Keys for Supabase filters: **`watchlistRowKeys`**, **`tmdbId` / `tmdb_id` / `parseMediaKey(id)`**, **`media_type`** → **`movie` \| `tv`**. **Swap** / **Top** / **Bottom** do **not** require non-empty **`UPDATE … RETURNING`**; only a non-null **`error`** from the client is treated as failure. Hosted DB: apply **`20260526120000_watchlist_rls_update_own.sql`** so **`authenticated`** users can **`update`** their own **`watchlist`** rows if RLS was blocking **`sort_index`** updates.
- **Primary nav** (desktop + hamburger): includes **Watchlist**; **`navigatePrimarySection`**: **Watchlist** → `navTab` **watchlist**; **Pulse** → `navTab` **home**; **any other section** (Circles, Streaming, etc.) → **`setNavTab("home")`** + **`setScreen(…)`** so the bottom **Watchlist** ring does not stay on after you leave Watchlist via the top bar (**5.6.8**).
- **Detail:** optional line **Watchlist · from …** (circle name when resolvable) when saved from a circle (`source_circle_id` + **`circleNameById`** from **`circlesList`**).

### Circles — production caps (revert from testing)

- If you **lower** caps locally (e.g. **3** active circles, **4** members per circle), **restore production** to these values everywhere they appear:
  - **10** active circles per user — `CIRCLE_CAP` in **`src/circles.js`**, and **`CIRCLE_USER_ACTIVE_CAP`** in Edge **`supabase/functions/send-circle-invite/index.ts`** and **`supabase/functions/accept-circle-invite/index.ts`**.
  - **25** members per circle — `CIRCLE_MEMBER_CAP` in those same **three** files.
- In **`src/App.jsx`**, avoid hard-coded “10-circle” copy; use **`CIRCLE_CAP`** (or match it when reverting) so UI strings stay correct.
- **Redeploy** both invite Edge functions after any cap change so the client and server stay aligned.
- **No Supabase SQL migration** is required to switch these numbers (enforcement is app + Edge; the circles schema comment documents intent only).

### Circles activity — Phase A (5.6.33+) — summary

**Shipped on web:** `circle_member_last_seen`, **`get_my_circle_unseen_counts`**, **`mark_circle_last_seen`**, **`get_circle_others_activity_watermark`**, `src/circles.js` helpers, **`App.jsx`**: Circles list **🔔 + count** (others’ **`rating_circle_shares`** with `created_at` \> your **last_seen** for that circle); in-circle **“New activity”** as a **76px** strip tile (**Recent**, **left of +**) + **Refresh**; compact line under **All/Top** when applicable; **~10s** visible-document watermark poll. Badges refresh on **login**, **tab focus** / **visibility** / **pageshow**, and **navigate to Circles list**. Body-level pull-to-refresh was **removed** in 5.6.36. **Apply on prod:** **`20260527120000_circle_member_last_seen.sql`** if missing.

### Circles activity — assumed use (web / PWA v1)

- **Session length:** We assume members **do not** keep **circle detail** open for a **very long** continuous visit. Short trips in and out are the norm.
- **Implicit updates are acceptable:** Leaving the circle (**navigation**), switching **tabs** or **apps**, or **focus / visibility** changes can cause the **Recent** strip (or related loaders) to **refetch** or show newer data **without** the user tapping **New activity → Refresh**. That is **OK for v1** on browser / PWA.
- **Explicit path when staying on screen:** The **New activity** tile, the **~10s** watermark check, and **Circles list** badges are the deliberate “something changed” affordances. A stricter contract is **deferred** to **native** or a later WebView / lifecycle pass.
- **Why defer:** PWA and browser **lifecycle** events are inconsistent (especially **iOS**).

### Circles — ratings & strip predictions (5.6.49+)

**Color language (beta):**

- **Green:** **Your** rating.
- **Blue** (`strip-badge--predicted`): **Personal / for you** prediction (neighbor-backed when **`neighborCount ≥ 1`**).
- **Gold:** **Cinemastro** community average, or **TMDB** fallback in `stripBadgeDisplay`.
- **Orange:** **Circle (group)** score — average among **members who published** that title to the circle.
- **Gold** second star under title: **Cinemastro site** average for that title (global), **not** the orange circle field.
- **Active tab** (Recent / All / Top): **brand gold** = navigation chrome, **not** a score.

**Strip vs detail — “blue lags until I open detail”:** Edge **`get-circle-rated-titles`** batch-attaches **`prediction`** from **`user_title_predictions`**; cold row → null → pill shows Cinemastro/TMDB until **detail** runs **`predict_cached` / match** and hydrates cache. **Deferred:** scroll-stop **`predict_cached`** for visible tiles only — see passdown **§ To be decided later** (**§6b**).

### Neighbors & cron (summary)

- **Client:** **`openDetail`** uses authed user for CF; **`runComputeNeighborsNow`** after ratings (debounced).
- **Edge:** **`compute-neighbors`**, **`commit_user_neighbors_swap`**; **`config.toml`** **`verify_jwt = false`** for cron **`pg_net`**.
- **Seed:** **`profiles.name`** prefix **`seed`** (case-insensitive); **`mode: "all"`** skips as subjects.
- **Scale:** **`(# cron jobs) × (limit per job)`** must cover eligible non-seed users as MAU grows — **`COMPUTE-NEIGHBORS-CRON.md`**.

### Product rules (stable)

- Neighbor-backed CF: **`neighborCount ≥ 1`**.
- Gold Cinemastro: community avg from **`cinemastroAvgByKey`**.
- Avoid known regressions (detail preds in all strips, badge order, etc.).

### Primary implementation files (catch-up)

- **`src/App.jsx`**, **`src/App.css`** — screens, Circles UI, detail, watchlist, streaming, etc.
- **`src/circles.js`** — caps, invites, **`fetchMyCircles`**, RPCs, Edge invoke.

---

## What’s next (priority)

1. **Phase D — Search & invite by handle** — blocked on `public.profiles.handle` (not in schema yet).

2. **Circles — edit name & info** — Creator (or whoever `circles` UPDATE policy allows) can change **`circles.name`** and **`circles.description`** from the Circle info entry point; optionally **vibe** if it belongs in that sheet. Reuse **`validateCircleName`** / limits (**`name`** 2–32, letter-led charset rules — see **`src/circles.js`**); **`description`** ≤100; bump **`updated_at`**, and only while **`status = 'active'`** (archived read-only).

3. **Phase E — Polish** — animations, cover upload, `icon_emoji`, per-circle color, archived circles section.

4. **Backlog:** split `App.jsx` into `pages/*` (pure refactor, ~7k lines).

5. **Watchlist on Circles main page** — Move the user’s watchlist onto the Circles landing/main surface. **Where and how** to present it is still being planned.

6. **Watchlist — circle name when sourced from a circle** — Show the **circle name** on watchlist rows when the item was saved from a circle flow (see **`watchlist.source_circle_id`**).

7. **Circle invite → non-user email** — When an invite is sent to an address **with no Cinematch account**, deliver an email that asks them to **join Cinematch** (in addition to or as the path for accepting the circle invite — product detail TBD).

8. **Tightening account security** — See **`ACCOUNT-SECURITY.md`**. **Likely path:** **Sign in with Apple / Google** plus **CAPTCHA** on signup. **Optional stronger anchor:** **phone verification** (Supabase Auth + SMS provider) to further reduce duplicate accounts used for ratings.

9. **Ratings — Bayesian normalization** — Apply a **Bayesian** (or Bayesian-style) formula to **normalize** ratings (design + where in pipeline TBD).

10. **Circle — quick rate pill** — Inside a circle, a **pill** to rate via Discover/detail; after rating, use the same **publish to circles** flow (defaults can include this circle). Global **`ratings`** row; visibility per **`rating_circle_shares`** (**5.6.0**).

11. ~~**Circles — strip tabs on circle detail**~~ **Done in 5.5.15:** **Recent** / **All** / **Top** (see `CHANGELOG.md`). Possible follow-up: rename **Top** copy, combine **Most rated** (by count) if product wants both.

---

## Circle rating publish (shipped **5.6.0**)

**Spec:** One **`ratings`** row per user per title. **`rating_circle_shares`** controls which circles show that pick. Leaving a circle deletes shares for `(user, circle)` via trigger on **`circle_members`** delete. No historical backfill.

| Phase | Status |
|--------|--------|
| 1 — DB table **`rating_circle_shares`**, RLS, indexes | Done — **`supabase/migrations/20260524120000_rating_circle_shares.sql`** |
| 2 — RPCs strip / all / top join through shares | Done — same migration |
| 3 — Edge **`get-circle-rated-titles`** | N/A (calls RPCs only); redeploy optional |
| 4 — Client publish modal + **`syncRatingCircleShares`** / **`fetchRatingCircleShareIds`** | Done — **`src/App.jsx`**, **`src/circles.js`** |
| 5 — Leave circle cleanup | Done — DB trigger (+ copy update on leave confirm) |
| 6 — QA / edge cases | Ongoing |

**Apply on prod:** run migration **`20260524120000_rating_circle_shares.sql`**.

**Follow-ups:** In-circle **quick rate** pill (item 10 above) should open the same publish flow; optional inline multi-select before submit from circle detail.

---

## Ops reminders

- **Supabase SQL:** user often applies migrations via SQL editor; keep repo migrations in sync with prod.  
- **Client-only push** → Vercel auto-deploys.  
- **Edge:** deploy after changing `supabase/functions/**`. Each function’s **`index.ts`** defines **`EDGE_FUNCTION_VERSION`**; every JSON response includes **`edge: { name, version }`**. **Whenever you change a function’s code, bump its version in the same commit and redeploy** — then confirm the live build by inspecting `edge` in a response (or the dashboard deploy time).  
- **Do not git push / deploy** unless the user asks (house rule).

---

## Quick verify commands

```bash
cd "/Users/tlmahesh/Library/Mobile Documents/com~apple~CloudDocs/Cinematch"
git status && git log -5 --oneline
grep '"version"' package.json
```

Expected version line: match **`package.json`** / **`CHANGELOG.md`**.

If this file overwrote older notes, recover the previous text with: `git show HEAD~1:HANDOFF.md` (adjust `HEAD~1` if needed).
