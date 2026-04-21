# Passdown — next chat (Cinematch Circles + watchlist)

**Prefer [`PASSDOWN-NEXT-CHAT.md`](PASSDOWN-NEXT-CHAT.md)** for the live session snapshot (version, migrations, prod notes). This file is a longer historical note; the version line below must match **`package.json`**.

Attach **`@PASSDOWN.md`** only if you rely on the narrative below. Use **`@HANDOFF.md`** for standing rules, architecture, and the global “what’s next” list.

---

## Repo version

- **`package.json`:** **5.6.8** — see **`CHANGELOG.md`** and **`PASSDOWN-NEXT-CHAT.md`**.
- **Next bump:** follow repo convention — bump **`package.json`** + **`CHANGELOG.md`** together when the next feature ships.

---

## What shipped (recent vertical slices)

### Circle strip (Phase C, evolved)

- **RPC** `get_circle_rated_strip(uuid, int, int)` — `p_limit` / `p_offset`, max **20** titles returned; **`total_eligible`**, **`has_more`**; site averages via `get_cinemastro_title_avgs` **only for the current page** (perf migration `20260430120000`).
- **Edge** `get-circle-rated-titles` — JWT → RPC → **batched** `user_title_predictions` only (no per-title `match_predict`; cold cache → `prediction: null`). Client falls back to RPC-only on Edge failure (`src/circles.js` `fetchCircleRatedTitles`).
- **UI** — Single horizontal **Rated in this circle** row (API order: together then solo); **→** tile at end loads **+5** (first page **10**); cap **20**; Discover hint when more titles exist beyond cap.
- **Circle info** — **Centered modal** (`circles-modal-root`, `z-index: 2300`), not a bottom sheet. Hero: **one line** — vibe + member count **left**, **Circle info** **right**; members list + **Leave circle** (main detail body no longer has Leave).
- **Constants** — `CIRCLE_STRIP_INITIAL`, `CIRCLE_STRIP_PAGE`, `CIRCLE_STRIP_MAX` in `src/circles.js`.

### Watchlist — group hint (v5.5.0)

- **Column** `watchlist.source_circle_id` → `circles(id)` `ON DELETE SET NULL` — migration **`20260501120000_watchlist_source_circle_id.sql`**.
- **When it’s set:** user taps **+ Watchlist** on title **detail** opened **from the circle strip** (`openDetail` stores return screen in `detailReturnScreenRef`; when it’s **`circle-detail`** and **`selectedCircleId`** is set, insert includes `source_circle_id`).
- **Profile → Watchlist:** small uppercase **Group** label under the title (`.wl-from-group`) — **no circle name** in UI for now.

---

## SQL migrations (apply in order if prod is behind)

| File | Purpose |
|------|---------|
| `20260426120000_circles_phase_c_get_circle_rated_strip.sql` | `rated_at` if missing; initial strip RPC |
| `20260427120000_circles_get_circle_rated_strip_fix.sql` | Archive filter + ordered `jsonb_agg` |
| `20260428120000_circles_strip_timeout_and_index.sql` | `ratings(user_id)` index; 120s timeout on RPC (signature later superseded) |
| `20260429120000_circles_strip_pagination.sql` | `get_circle_rated_strip(uuid, int, int)` |
| `20260430120000_circles_strip_site_avgs_page_only.sql` | Page-only site avgs (perf) |
| `20260501120000_watchlist_source_circle_id.sql` | **`watchlist.source_circle_id`** |

**Prod:** Often applied via SQL editor; keep repo = source of truth.

---

## Edge deploy (manual)

Git push does **not** deploy Edge functions.

```bash
npx supabase@latest functions deploy get-circle-rated-titles --project-ref lovpktgeutujljltlhdl
```

**Project ref:** `lovpktgeutujljltlhdl`

---

## Debugging notes

1. **`P0001: not authenticated`** on `get_circle_rated_strip` in the **SQL editor** — expected (`auth.uid()` null). Test in app or Edge with JWT.
2. **Strip timeouts** — index + 120s RPC timeout; if still slow, check pooler limits.
3. **Watchlist insert** fails after client deploy but **before** migration — add **`source_circle_id`** column in Supabase (run `20260501120000`).

---

## Key files

| Area | Path |
|------|------|
| Circles + strip + circle info + watchlist UI | `src/App.jsx` — `circle-detail`, `circleStrip`, `showCircleInfoSheet`, `toggleWatchlist`, `buildWatchlistFromRows`, `detailReturnScreenRef` |
| Strip client + RPC fallback | `src/circles.js` — `fetchCircleRatedTitles`, `CIRCLE_STRIP_*` |
| Edge strip | `supabase/functions/get-circle-rated-titles/index.ts` |
| Watchlist column | `supabase/migrations/20260501120000_watchlist_source_circle_id.sql` |
| Circles product / deferred items (historical) | `supabase/migrations/20260422120000_circles_schema.sql` (header) |
| Ongoing checklist | **`HANDOFF.md`** |

---

## Suggested next priorities

1. **Phase D** — search / invite by **`public.profiles.handle`** (column + RLS + UI).
2. **Phase E** — polish (covers, `icon_emoji`, per-circle color, archived section).
3. **Backlog** — split `App.jsx` into `pages/*`.

---

## Git / ops

- Do **not** `git push` or deploy unless the user asks (house rule).
- Client-only push → Vercel auto-builds.

---

## Quick verify

```bash
cd "/Users/tlmahesh/Library/Mobile Documents/com~apple~CloudDocs/Cinematch"
grep '"version"' package.json
git status && git log -3 --oneline
```

Expected: match **`package.json`** (e.g. **`"version": "5.6.8"`**).

If this file overwrote older notes: `git show HEAD~1:PASSDOWN.md` (adjust `HEAD~n` as needed).
