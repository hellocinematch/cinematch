# Cinematch — session handoff (for the next chat)

This file is the **source of truth** for what to do when you pick up work. In Cursor, open it from the repo or reference it with **`@HANDOFF.md`** (or **`@HANDOFF`**) so the model sees full context.

---

## How the next chat should use this

1. **Read this file first** — `HANDOFF.md` at the repository root:  
   `/Users/tlmahesh/Library/Mobile Documents/com~apple~CloudDocs/Cinematch/HANDOFF.md`
2. In Cursor chat, attach it: type **`@HANDOFF.md`** and select the file, or paste: *“Follow `HANDOFF.md`.”*
3. **Version bump rule:** trust **`package.json`** / **`CHANGELOG.md`** for the current release (now **5.6.1**). Bump both whenever you ship product code; add **`CHANGELOG.md`** in the **same release commit** as the first shipping change—not in a handoff-only or docs-only commit.

---

## Current state (as of last update)

- **`main` is pushed** to `origin` (includes Circles Phase A + RLS hotfix + Phase B + Phase C strip backend + Phase C strip UI).
- **`package.json` version:** **`5.6.1`** — see **`CHANGELOG.md`**; circle feeds use **`rating_circle_shares`**; Recent strip layout + copy in **5.6.1**.
- **Prod DB:** Circles schema through strip/grids + watchlist + **rating publish** — ensure **`20260524120000_rating_circle_shares.sql`** is applied (feeds join through shares; leave-circle trigger clears shares for that member+circle). Earlier migrations as in repo / **`PASSDOWN-NEXT-CHAT.md`** checklist.
- **Edge functions:** `send-circle-invite`, `accept-circle-invite`, and **`get-circle-rated-titles`** must be deployed manually; **git push does not deploy Edge Functions** (`npx supabase@latest functions deploy … --project-ref lovpktgeutujljltlhdl`).

---

## Architecture rules (do not break)

- **Landing page is Circles** — no Home-shaped shared shelf.
- **No `React.useState` / `React.useEffect`** in `App.jsx` — use named imports only (prod bundle lesson from v4.0.9).
- **Each page owns its RPC path** — no cross-page borrowing.
- **Circle membership for anyone other than creator seed** → **Edge** + service role; RLS allows creator-seed-self only.
- **Creator leave:** `circles.status = 'archived'`, `archived_at = now()` **before** deleting creator’s `circle_members` row (update policy gates on `status = 'active'`).
- **Invite caps:** send-time 10-circle cap → `auto_declined`; accept-time cap → **error**, invite stays `pending` (spec in migration header).

---

## Key paths

| Area | Location |
|------|----------|
| Main app | `src/App.jsx` — Circles UI ~search `screen === "circles"`, `circle-detail`, `showInvitesPanel`, `showInviteSheet` |
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
- **Edge:** deploy after changing `supabase/functions/**`.  
- **Do not git push / deploy** unless the user asks (house rule).

---

## Quick verify commands

```bash
cd "/Users/tlmahesh/Library/Mobile Documents/com~apple~CloudDocs/Cinematch"
git status && git log -5 --oneline
grep '"version"' package.json
```

Expected version line: match **`package.json`** / **`CHANGELOG.md`** (currently **`5.6.1`**).

If this file overwrote older notes, recover the previous text with: `git show HEAD~1:HANDOFF.md` (adjust `HEAD~1` if needed).
