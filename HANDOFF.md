# Cinematch / Cinemastro — handoff for next chat

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
- **`CHANGELOG.md`** lists releases — **current release: 1.0.13** (see file for full history).
- Remote: **`hellocinematch/cinematch`**, branch **`main`**. User often says **“push it”** when they want commits pushed.

### Recent work (session summary — for the next chat)
Shipped in **1.0.5 → 1.0.13** (mostly `src/App.jsx`, `public/cinemastro-logo.svg`, Supabase dashboard config):

| Area | What changed |
|------|----------------|
| **Auth** | Forgot password → `resetPasswordForEmail`; recovery UI (`PASSWORD_RECOVERY`, set new password). **PKCE:** do not let `getSession()` navigate to home before reset; `redirectTo` includes **`?recovery=1`** — add **`https://<production-domain>/?recovery=1`** (and localhost for dev) under **Authentication → URL Configuration → Redirect URLs**; **Site URL** should be **`https://…`** not `http://localhost`. |
| **Auth UI** | Sign-in form **`auth-inner`** max-width on desktop. |
| **Brand** | Logo SVG: centered wordmark + tagline (`text-anchor="middle"`). |
| **Onboarding** | If user has **no** `user_metadata.onboarding_complete` and **no** ratings → **`loading-catalogue` → pref → onboarding** (same for sign-in after email confirm). **Sign-up with session** uses loading gate so catalogue is loaded (avoids empty `obMovies`). Mark complete via **`updateUser({ data: { onboarding_complete: true } })`** when exiting onboarding; legacy users: **any rating** counts as onboarded. |
| **Onboarding UI** | Responsive card/rating: no flex stretch on desktop; 16:9 poster caps with `vh` / breakpoints. |

**Not done here:** “User count” next to tab bar (discussed only). **Backlog** unchanged unless user asks.

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
- Profile settings: streaming / genres / regions; **upsert** + **localStorage** fallbacks (`cinematch_*` keys).
- **Mobile:** section headers stack title above meta when narrow (avoid “More For You” wrapping).
- **iOS:** shell uses `%` not `100vw` where noted in codebase.

## DB migrations (Supabase, if not applied)
- `supabase/migrations/20260402120000_profiles_streaming_provider_ids.sql`
- `supabase/migrations/20260406120000_profiles_show_genre_ids.sql`
- `supabase/migrations/20260406133000_profiles_show_region_keys.sql`

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
- **CHANGELOG** + **version bump** (`package.json` / lockfile) when shipping user-visible releases (pattern through **1.0.13**).
- Match **cold start / community size** affects CF output; don’t assume “bug” if Matches stays 0 with few users.
