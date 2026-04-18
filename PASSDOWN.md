# Passdown — Circles Phase C & follow-ups (for next chat)

Attach this file in the next Cursor chat (`@PASSDOWN.md`) **or** use `@HANDOFF.md` for ongoing project rules. This doc captures **this thread’s** context; `HANDOFF.md` remains the long-lived checklist.

---

## Repo version

- **`package.json`:** **5.4.4** — **Circle info** = centered **modal** over circle view; hero = one line: vibe + members | Circle info.
- Next version bump (**5.5.0**) when shipping the next vertical slice (e.g. `watchlist.source_circle_id`, Phase D, etc.) — include **`CHANGELOG.md`** in that release commit, not in docs-only commits.

---

## What shipped (Circles Phase C)

### Backend (v5.2.0 area; may be same release train as UI)

- **`get_circle_rated_strip(p_circle_id uuid)`** — `SECURITY DEFINER`, `auth.uid()` membership check; returns JSON: `member_count`, `gated`, `titles[]` (together | solo, group/site scores, `viewer_score`).
- **`get-circle-rated-titles`** Edge — JWT → RPC → batched **`user_title_predictions`** reads only (no per-title `match_predict`; cold cache → null).
- **`fetchCircleRatedTitles`** in `src/circles.js` — invokes Edge; on Edge failure (except not-member / Unauthorized) **falls back** to direct `supabase.rpc('get_circle_rated_strip')` with **`prediction: null`** (strip still renders; badges fall back to Cinemastro/TMDB).

### UI (v5.3.0)

- **`src/App.jsx`** — `circle-detail` loads strip when `member_count >= 2`; one horizontal **Rated in this circle** row; end **→** tile loads more (max 20); hero meta **B** + **Circle info** sheet (members, leave); TMDB hydrate via `circleStripExtraMovies`; `openDetail` on card tap.

---

## SQL migrations (apply order in Supabase SQL editor if not already)

| File | Purpose |
|------|---------|
| `20260426120000_circles_phase_c_get_circle_rated_strip.sql` | `rated_at` column if missing; initial `get_circle_rated_strip` |
| `20260427120000_circles_get_circle_rated_strip_fix.sql` | Archive filter fix; `jsonb_agg` via ordered subquery |
| `20260428120000_circles_strip_timeout_and_index.sql` | **`ratings(user_id)`** index; **`statement_timeout = 120s`** on RPC (one-arg `get_circle_rated_strip`; superseded by 291’s signature) |
| `20260429120000_circles_strip_pagination.sql` | **`get_circle_rated_strip(uuid, int, int)`** — `p_limit` / `p_offset`, max **20** rows, **`total_eligible`** + **`has_more`** |
| `20260430120000_circles_strip_site_avgs_page_only.sql` | **Perf:** `get_cinemastro_title_avgs` only for **current page** solo rows (not whole circle) |

**Prod:** User applies these manually (common house rule). Keep repo = source of truth.

---

## Edge deploy (manual)

Git push does **not** deploy functions. After changing Edge code:

```bash
npx supabase@latest functions deploy get-circle-rated-titles --project-ref lovpktgeutujljltlhdl
```

**Project ref:** `lovpktgeutujljltlhdl`

---

## Debugging notes (from this thread)

1. **`P0001: not authenticated`** when running `SELECT get_circle_rated_strip(...)` in the **SQL editor** is **expected** — `auth.uid()` is null there. Test with the **logged-in app** or Edge with user JWT.
2. **`statement timeout`** — large `public.ratings`; mitigated by **`ratings_user_id`** index + **120s** function timeout (migration `20260428120000_...`). If still slow, check Supabase DB/pooler statement limits.
3. **Generic “Could not load circle titles”** — Edge hides RPC errors unless updated; Edge was improved to return **Postgres/PostgREST `message` / `details` / `hint`** in the JSON `error` field (redeploy Edge to pick up).

---

## Key files

| Area | Path |
|------|------|
| Strip UI + fetch effects | `src/App.jsx` — search `circleStrip`, `fetchCircleRatedTitles`, `circle-detail` |
| Client invoke + RPC fallback | `src/circles.js` — `fetchCircleRatedTitles`, `invokeCirclesEdge` |
| Edge strip + predictions | `supabase/functions/get-circle-rated-titles/index.ts` |
| RPC definitions | `supabase/migrations/20260426120000_*.sql`, `20260427120000_*.sql`, `20260428120000_*.sql` |
| Product + display contract | `supabase/migrations/20260422120000_circles_schema.sql` (header comments) |
| Ongoing project handoff | **`HANDOFF.md`** |

---

## Suggested next priorities (from `HANDOFF.md`)

1. **`watchlist.source_circle_id`** + UI when adding titles with circle attribution (schema comment).
2. **Phase D** — invite by handle (needs `public.profiles.handle`).
3. **Phase E** — polish (covers, `icon_emoji`, archived section, etc.).
4. **Backlog** — split `App.jsx` into `pages/*`.

---

## Git / ops

- Do **not** `git push` or deploy unless the user asks (house rule).
- Client-only deploy → Vercel auto-builds on push.

---

## Quick verify

```bash
cd "/path/to/Cinematch"
grep '"version"' package.json
git status && git log -3 --oneline
```

Expected: **`"version": "5.4.4"`**.

If this file replaced older notes, recover with: `git show HEAD~1:PASSDOWN.md` (adjust `HEAD~n` as needed).
