# Changelog

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
