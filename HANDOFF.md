# Cinematch / Cinemastro — handoff for next chat

## Active ingest handoff (read first for DB load)
- MovieLens 32M ingest tracking doc: `docs/ml32m-ingest-handoff.md`
- Current ingest status is maintained there (steps, progress, and next actions).

**Focus:** Continue **next version of Cinemastro** (incremental features/polish). Prefer **small diffs** in `src/App.jsx` (very large file).

## Stack
- **Frontend:** Vite + React 19 — main UI: `src/App.jsx` (single component + inline CSS string).
- **Backend:** Supabase Auth, `public.profiles`, `public.ratings`, `public.watchlist`.
- **Recommendations:** Edge Function `supabase/functions/match/index.ts` — client **only** `supabase.functions.invoke('match', …)`; service role loads neighbour ratings server-side.
- **Data:** TMDB (bearer token in `App.jsx` — consider env for production).
- **Deploy:** GitHub → Vercel. Edge functions deploy separately: `npx supabase functions deploy match`.

## Env (Vite)
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Version & changelog
- App version from `package.json`, shown on Profile as **Cinemastro v…** (import in `App.jsx`).
- **`CHANGELOG.md`** lists releases — **current release: 1.0.36** (see file for full history).
- Remote: **`hellocinematch/cinematch`**, branch **`main`**. User often says **“push it”** when they want commits pushed.

### Recent work (session summary — v1.0.14 → v1.0.36)
Shipped a long sequence of mobile stability + profile sync + discover behavior changes (mostly `src/App.jsx` and small `src/index.css` hardening):

| Area | What changed |
|------|----------------|
| **Detail desktop layout** | Poster kept narrow (grid-like), content widened, controls capped (v1.0.14/1.0.15). |
| **Community stats** | Added public site-wide counts via RPC `get_public_site_stats` and showed beside logo; then tuned visibility to avoid mobile overflow (desktop keeps stats in top bars/home hero behavior). |
| **Profile settings sync** | Removed localStorage fallback for streaming/genre/region; DB is source of truth. Fixed save-path issues and changed to `update(...).eq(id)` with in-app error banner on failure. |
| **Discover search** | Changed from dynamic fetch while typing to **submit-only search** (tap lens / keyboard Search) in v1.0.33. |
| **iOS mobile overflow** | Multiple iterations; current root approach in **v1.0.36** blocks page-level horizontal touch panning while allowing intentional horizontal scrollers (`.strip`, `.filter-row`). |

**Open concern:** User still reported intermittent mobile overflow in some flows even after several patches; verify v1.0.36 on real iPhone Safari before further feature work.

## Brand / assets
- UI name: **Cinemastro**. Logo: `public/cinemastro-logo.svg`. Favicon: `public/favicon.svg`.

## Product / UX (current behaviour — read before changing)

### Home
- Segments: **Picks** / **More** / **Friends**.
- **Hero tagline** (“Movies and Shows - Picked for your TASTE!”) **only when segment is Picks**. More/Friends: no tagline; mobile uses tighter header; desktop hides empty hero strip (logo + avatar stay in **`home-topbar`**).

### Navigation & chrome
- **`page-topbar`:** wordmark + avatar + bottom border — used on **Discover, Mood (picker + results), Profile, Rated, Detail**, and on **all breakpoints** (mobile included). **Home** does not use `page-topbar` on mobile (uses **`home-header`** with hero + avatar instead).
- **Duplicate header wordmarks** under `page-topbar` were removed (discover/mood/profile blocks rely on top bar only).
- **Cinemastro logo:** **`AppBrand`** accepts **`onPress`**; main app passes **`goHome`** → `setNavTab("home")`, `setScreen("home")`, clears detail selection / avatar menu. **Splash** uses **`variant="splash"`** (logo not clickable for home).

### Detail screen
- **No in-app Back** — browser/OS back; **`history.pushState`** when opening detail so back stays in-app (`detailReturnScreenRef` + `popstate`).
- Sticky **`page-topbar`** (logo + avatar); poster/body below.

### Legal / footer
- **`src/legal.jsx`** — `AppFooter`, placeholder **Privacy / Terms / About** pages.
- **`src/legalConstants.js`** — placeholders (entity, email, URL). Replace before production.
- Footer above bottom nav on main tabs; **`openLegalPage` / `closeLegalPage`** use **`history.pushState`** + **`legalHistoryPushedRef`** like detail.

### Profile / recommendations
- **“Matches”** on Profile = **`recommendations.length`** from the match API (collaborative list size), **not** “films you rated.” CF needs **other users** with **overlapping rated titles**; small user base → often **0 matches** despite many ratings.

### Other
- Profile settings: streaming / genres / regions now load/save from **Supabase profiles only** (no local fallback).
- **Mobile:** section headers stack title above meta when narrow (avoid “More For You” wrapping).
- **iOS:** shell uses `%` not `100vw` where noted in codebase.

## DB migrations (Supabase, if not applied)
- `supabase/migrations/20260402120000_profiles_streaming_provider_ids.sql`
- `supabase/migrations/20260406120000_profiles_show_genre_ids.sql`
- `supabase/migrations/20260406133000_profiles_show_region_keys.sql`
- `supabase/migrations/20260407140000_get_public_site_stats.sql` — RPC **`get_public_site_stats`** for public **community** (profile count) + **ratings** count (header marketing).

## Key files
| Area | File |
|------|------|
| UI + flows + styles | `src/App.jsx` |
| Legal UI + footer | `src/legal.jsx`, `src/legalConstants.js` |
| Supabase client | `src/supabase.js` |
| Match Edge Function | `supabase/functions/match/index.ts` |
| Global CSS | `src/index.css` |
| Entry | `index.html`, `src/main.jsx` |

## Backlog / not built
- Admin/stats (RLS-safe aggregates or Edge + service role).
- “Rate more” nudges / public community counts.
- Richer region / TMDB discover product lines.

## Quick local dev
```bash
cd /path/to/Cinematch
npm install
npm run dev
# Phone on LAN: npm run dev -- --host
```

## Notes for the next assistant
- **No drive-by refactors** unless asked.
- **CHANGELOG** + **version bump** (`package.json` / lockfile) when shipping user-visible releases (pattern through **1.0.36**).
- Match **cold start / community size** affects CF output; don’t assume “bug” if Matches stays 0 with few users.
- If touching mobile layout, test real iPhone Safari flow: login → Home → Discover search submit → back to Home.
