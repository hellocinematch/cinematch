# Changelog

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
