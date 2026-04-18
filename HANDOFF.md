# Cinematch — session handoff (for the next chat)

This file is the **source of truth** for what to do when you pick up work. In Cursor, open it from the repo or reference it with **`@HANDOFF.md`** (or **`@HANDOFF`**) so the model sees full context.

---

## How the next chat should use this

1. **Read this file first** — `HANDOFF.md` at the repository root:  
   `/Users/tlmahesh/Library/Mobile Documents/com~apple~CloudDocs/Cinematch/HANDOFF.md`
2. In Cursor chat, attach it: type **`@HANDOFF.md`** and select the file, or paste: *“Follow `HANDOFF.md`.”*
3. **Version bump rule for the next vertical slice:** current release in repo is **5.3.0** (unchanged for docs-only or handoff-only commits). When **`watchlist.source_circle_id`** + dashboard attribution, **Phase D**, or the **next real feature** ships, bump to **`5.4.0`** and add a matching **`CHANGELOG.md`** section in the **same release commit** as the first shipping change—not in a handoff-only or docs-only commit.

---

## Current state (as of last update)

- **`main` is pushed** to `origin` (includes Circles Phase A + RLS hotfix + Phase B + Phase C strip backend + Phase C strip UI).
- **`package.json` version:** `5.3.0` — **Circles Phase C** complete on `circle-detail` (RPC + Edge + `fetchCircleRatedTitles` + two horizontal strips + TMDB hydrate).
- **Prod DB:** Phase A circles schema + RLS recursion hotfix + Phase B SQL helpers + Phase C `get_circle_rated_strip` / `ratings.rated_at` migration (apply `20260426120000_circles_phase_c_get_circle_rated_strip.sql` if not already).
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
| Product spec | `Architechture/cinemastro-circles-requirements.md` (path spelling as in repo) |

**Supabase project ref:** `lovpktgeutujljltlhdl`

---

## What’s next (priority)

1. **`watchlist.source_circle_id`** (schema + UI) when adding a title from the circle dashboard with attribution — called out in `20260422120000_circles_schema.sql` header.

2. **Phase D — Search & invite by handle** — blocked on `public.profiles.handle` (not in schema yet).

3. **Phase E — Polish** — animations, cover upload, `icon_emoji`, per-circle color, archived circles section.

4. **Backlog:** split `App.jsx` into `pages/*` (pure refactor, ~7k lines).

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

Expected version line: **`"version": "5.3.0"`** until the next release bump (→ **`5.4.0`** for attribution / Phase D / next feature).

If this file overwrote older notes, recover the previous text with: `git show HEAD~1:HANDOFF.md` (adjust `HEAD~1` if needed).
