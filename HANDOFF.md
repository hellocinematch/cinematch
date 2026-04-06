# Cinematch / Cinemastro — handoff for next chat

## Stack
- **Frontend:** Vite + React 19 — main UI: `src/App.jsx` (single large component + inline CSS string).
- **Backend:** Supabase Auth, `public.profiles`, `public.ratings`, `public.watchlist`.
- **Recommendations:** Supabase Edge Function `supabase/functions/match/index.ts` — client calls **only** `supabase.functions.invoke('match', …)`; service role loads neighbour data server-side (never expose full ratings in client).
- **Data:** TMDB API (token in `src/App.jsx` today — consider env var for production).
- **Deploy:** Push to GitHub → Vercel. Edge functions: `npx supabase functions deploy match` (separate from Vercel).

## Env (Vite)
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Brand / assets
- App name in UI: **Cinemastro** (rebranded from Cinematch in places).
- Logo: `public/cinemastro-logo.svg` — wordmark + tagline; text left-anchored in SVG for alignment with page copy.
- Favicon: `public/favicon.svg` (unchanged unless you update).

## Recent product / UX (high level)
- **Profile settings:** streaming providers (`streaming_provider_ids`), genres (`show_genre_ids`), regions (`show_region_keys`). Empty arrays = no filter. Region buckets drive language-based filtering + richer US streaming/theater queries for Indian etc.
- **Persistence:** Profile prefs use `upsert` + localStorage fallbacks (`cinematch_show_genres_*`, `cinematch_show_regions_*`, `cinematch_streaming_providers_*`) so prefs survive missing profile rows / reload.
- **Layout:** Responsive shell (`--shell` 480px mobile, wider at `≥900px`, `≥1200px`). Desktop Home: top bar (logo + avatar), centered segment row (Picks/More/Friends), hero tagline, divider, then content. Shared `page-topbar` on Discover / Mood / Profile (desktop). Mobile: overflow fixes for wide logo; detail **Back** button `z-index` raised so it isn’t hidden under sticky brand (`66f6076`).
- **Account:** Top avatar opens menu: Profile + Sign out; duplicate sign-out removed from Profile settings card.

## DB migrations (run in Supabase if not already)
- `supabase/migrations/20260402120000_profiles_streaming_provider_ids.sql`
- `supabase/migrations/20260406120000_profiles_show_genre_ids.sql`
- `supabase/migrations/20260406133000_profiles_show_region_keys.sql`

## Key files
| Area | File |
|------|------|
| UI + styles + flows | `src/App.jsx` |
| Supabase client | `src/supabase.js` (if present) |
| Match CF | `supabase/functions/match/index.ts` |
| Global CSS (iOS scroll etc.) | `src/index.css` |
| Entry | `index.html`, `src/main.jsx` |

## Git / deploy
- Remote: e.g. `hellocinematch/cinematch` on GitHub; default branch `main`.
- Recent fix commit example: `66f6076` — detail back button z-index.

## Ideas not built / backlog
- Admin/stats dashboard (user count, total ratings, distinct titles) — needs RLS-safe aggregates or Edge Function + service role + allowlist.
- “Rate more” onboarding nudges, public community counts — discussed, not implemented.
- Region product lines beyond current TMDB discover patterns — optional.

## Quick local dev
```bash
cd /path/to/Cinematch
npm install
npm run dev
# Optional phone: npm run dev -- --host
```

## Notes for the next assistant
- Prefer **small, focused diffs** in `App.jsx`; file is very large.
- **No drive-by refactors** unless asked.
- User prefers **pushing** changes to GitHub when they say “push it.”
- **iOS Safari:** avoid `100vw` for shell; horizontal scroll was addressed in `index.css` / App shell patterns earlier in project history.
