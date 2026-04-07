# Changelog

## 1.0.34

- **Safari drift clamp:** Add a UI-transition fail-safe that resets horizontal scroll (`window/document x=0`) on screen/search/home-segment changes. Prevents persistent left/right viewport shift after gestures, especially around Discover/Home transitions on iOS Safari.

## 1.0.33

- **Discover search trigger:** Results now fetch only on explicit submit (tap search icon or keyboard Search/Enter), not while typing. Added submitted-query state and search form button; status/empty messages now reference submitted query.

## 1.0.32

- **Stabilization rollback:** Revert v1.0.31 Discover grid tweak (`repeat(minmax)` + forced card width) after regression reports on Home mobile overflow. Returns Discover grid to prior sizing baseline while preserving earlier global overflow hardening.

## 1.0.31

- **Discover results overflow fix:** Use `grid-template-columns: repeat(2, minmax(0, 1fr))` for mobile Discover results and constrain cards to `width/max-width:100%`. Prevents result columns from expanding horizontally as search results populate.

## 1.0.30

- **Mobile overflow hardening:** Use `overflow-x: clip` (with existing `hidden`) at root/app/screen shells to prevent Safari from retaining sideways viewport drift. Horizontal strip/filter scrolling remains enabled.

## 1.0.29

- **Mobile horizontal-pan lock:** Prevent viewport sideways drag by setting app shell `touch-action: pan-y`; keep intentional horizontal scrolling on strips/filter chips via `touch-action: pan-x`. Fixes Home clipping/drag state where “In Theaters” and top controls appeared partially off-screen.

## 1.0.28

- **Discover typing overflow fix (mobile):** Harden result cards against intrinsic-width growth while typing. `disc-card` now has `min-width:0`; `disc-title` and `disc-meta` hard-wrap long/unbroken text. This prevents horizontal pan when search results appear.

## 1.0.27

- **Mobile overflow (home/login path):** Hide `public-site-stats` inside mobile `home-header` (logo remains). This removes immediate horizontal overflow on login/home without changing desktop stats placement.

## 1.0.26

- **Mobile overflow guard (top bars):** Hide the small **community/ratings** stats block inside mobile `page-topbar` (Discover/Profile/Detail/etc) to avoid Safari width overflows. Logo remains; desktop and home hero behavior unchanged.

## 1.0.25

- **Profile save reliability:** Preference writes now use `update(...).eq(id)` (not upsert) and show an in-app error banner in Profile when a save fails. This makes streaming-provider save failures visible and avoids conflict-path quirks.

## 1.0.24

- **Profile settings save fix:** Revert to **single-field upserts** for streaming/genre/region (DB-only source remains). This avoids stale in-memory payloads accidentally writing `streaming_provider_ids` back to empty.

## 1.0.23

- **Profile sync fix (cross-device):** Preference saves now upsert **all three profile arrays together** (`streaming_provider_ids`, `show_genre_ids`, `show_region_keys`) on every save to prevent partial writes from wiping the other fields.

## 1.0.22

- **Profile settings sync:** Remove localStorage fallback for streaming/genre/region preferences. App now always loads these from `profiles` in Supabase (DB is the single source of truth across devices). Saves still upsert to `profiles`.

## 1.0.21

- **Discover/mobile overflow fix:** Tighten **`page-topbar`** on narrow screens (2-column grid, smaller brand cluster footprint) so entering Discover does not push horizontal pan state across screens. Also hard-wrap **`search-status`** for long queries and enforce `min-width:0` for Discover header/search box.

## 1.0.20

- **Home (mobile):** Picks tagline uses **fluid `font-size`** (`clamp`) so it scales with viewport width; **desktop** tagline unchanged.

## 1.0.19

- **Home (desktop):** Hide **`topbar-brand-cluster`** inside **`home-header`** when **`home-topbar`** is visible — removes duplicate community/ratings next to the tagline. Mobile unchanged (no top home bar).

## 1.0.18

- **Community stats (marketing):** Next to the wordmark in **top bars** and **home hero** — two lines (**community** = `profiles` count, **ratings** = `ratings` row count). Fetched once via Supabase RPC **`get_public_site_stats`** (apply migration **`20260407140000_get_public_site_stats.sql`**). Compact format (e.g. `1.2k`) when large; hidden until first successful load.

## 1.0.17

- **Mobile overflow (follow-up):** Horizontal strips use explicit **`width:100%`** + **`min-width:0`**; **`top-picks-block`** constrained. Section headers use **safe-area padding**; **`section-meta`** is **full-width + `text-align:right`** on narrow screens (was `align-self:flex-end` on a too-wide ancestor). Slightly tighter meta typography. **`overscroll-behavior-x: none`** on `html` / `body` / `#root`. Main shells (`home`, `discover`, `profile`, `mood`, `detail`) get **`width:100%`**.

## 1.0.16

- **Mobile overflow:** Remove **`100vw` / `86vw`** from header and splash logos (use **`%` / `100%`** so sizing tracks the `.app` shell — iOS Safari often treats `100vw` wider than the painted column). **`minmax(0, …)`** on top bar grids, **`min-width: 0`** on home hero / section headers, **`overflow-wrap`** on tagline and section meta, and **bottom nav** centered with **`left:0; right:0`** instead of **`translateX(-50%)`** to avoid subpixel horizontal pan.

## 1.0.15

- **Detail (desktop):** Poster stays **one grid-card wide**; **title, prediction, synopsis, where to watch** use a **wider column** (two Discover cards + gap, same math as `.disc-grid`). **Slider + rating buttons** capped at **380px** centered. Mobile: unchanged full-width flow (rules scoped to `min-width: 900px`).

## 1.0.14

- **Detail (desktop):** Main column matches **one Discover grid card width** (`detail-inner` uses the same `calc` as `.disc-grid` for 4- and 5-column breakpoints). Poster uses **2:3** aspect ratio and card-style border/radius like grid posters. Mobile unchanged.

## 1.0.13

- **Onboarding / rate-more:** Responsive layout — no `flex:1` stretch between card and controls; poster uses **16:9** + **viewport-capped height** (`vh` + `clamp`); card and rating block **max-width** and centered on larger screens; **safe-area** padding; scroll the step on short viewports.

## 1.0.12

- **Onboarding:** **Sign up** with an active session now uses **`loading-catalogue` → pref** (same as sign-in) so the **catalogue is loaded** before cinema prefs; avoids **empty `obMovies`** and a blank rating step. **Continue** is disabled until the catalogue is ready. **Email-confirm-only** signups (no session) show a notice instead of a broken pref screen. Fallback **“Preparing titles…”** if onboarding opens before titles are ready; tighter onboarding metadata checks and try/catch on post-login routing.

## 1.0.11

- **Onboarding:** New accounts that **sign in** (or confirm email then sign in) now get the same flow as immediate sign-up: if onboarding is not finished, load goes to **cinema preference** then ratings. Completion is stored in auth **`user_metadata.onboarding_complete`**; existing users with **at least one saved rating** are treated as already onboarded.

## 1.0.10

- **Auth / recovery:** Password reset for **PKCE**: stop `getSession()` from overwriting the reset screen; route recovery via `PASSWORD_RECOVERY`, URL `?recovery=1` (add this redirect URL in Supabase), and stronger JWT recovery detection. Enter the app from splash/auth only through `onAuthStateChange`.

## 1.0.9

- **Auth / recovery:** Fix **password reset** flow so recovery sessions are not sent straight to the app (JWT `amr` recovery + URL `type=recovery`). After a successful new password, continue into the app. Log **rating save** errors to the console when `upsert` fails.

## 1.0.8

- **Brand / splash:** **`cinemastro-logo.svg`** wordmark and tagline use **centered text** (`text-anchor="middle"`, `x="200"`) so the tagline sits under the title and aligns with centered CTAs; remove splash-only `translateX` workaround in `App.jsx`.

## 1.0.7

- **Splash:** Center the wordmark with the **Get Started** / **Sign In** buttons (splash-only `object-position` + light horizontal nudge; `splash-logo` uses full width for alignment).

## 1.0.6

- **Auth:** Sign-in / sign-up form constrained on **desktop** (`max-width` + centered) so email, password, and primary button are not full viewport width.

## 1.0.5

- **Auth:** **Forgot password** on sign-in (email reset link via Supabase). Recovery links open in-app so the user can set a **new password** before signing in again.

## 1.0.4

- **Home:** Hero tagline (“Movies and Shows - Picked for your TASTE!”) only on **Picks**; **More** and **Friends** show no tagline. Tighter mobile header when tagline is hidden; desktop hides the empty hero strip on More/Friends (wordmark stays in `home-topbar`).

## 1.0.3

- **Footer** on main tabs (above bottom nav): links to **About**, **Privacy**, **Terms**, **Contact** (`mailto` placeholder), **©** line with placeholder legal entity, placeholder site URL, and **TMDB API attribution** (required-style wording + link).
- **Placeholder pages** for Privacy Policy, Terms of Use, and About (`src/legal.jsx`, copy in `src/legalConstants.js`). **Browser Back** returns to the previous screen (history integration like title detail).

## 1.0.2

- **Navigation:** Opening a title from Picks/More/Discover/etc. now **`history.pushState`s** a dedicated step. **Browser Back** returns to that screen inside Cinemastro instead of the previous site in the tab history.

## 1.0.1

- **Title detail screen:** Removed the in-app **← Back** control; exit via browser/OS back (aligned with catalog sites like TMDB).
- **Title detail screen:** Added the same **top bar** as other main tabs — **Cinemastro wordmark** (left) and **account avatar** (right). Poster, title, and body content render **below** that bar.
- **Title detail screen:** Top bar is **sticky** with **safe-area** padding for notched devices; dropped the old centered sticky brand strip and floating back pill (`.detail-sticky-brand`, `.back-btn`).

## 1.0.0

- Initial semver; Profile shows app version from `package.json`.
