# Changelog

## 1.0.2

- **Navigation:** Opening a title from Picks/More/Discover/etc. now **`history.pushState`s** a dedicated step. **Browser Back** returns to that screen inside Cinemastro instead of the previous site in the tab history.

## 1.0.1

- **Title detail screen:** Removed the in-app **← Back** control; exit via browser/OS back (aligned with catalog sites like TMDB).
- **Title detail screen:** Added the same **top bar** as other main tabs — **Cinemastro wordmark** (left) and **account avatar** (right). Poster, title, and body content render **below** that bar.
- **Title detail screen:** Top bar is **sticky** with **safe-area** padding for notched devices; dropped the old centered sticky brand strip and floating back pill (`.detail-sticky-brand`, `.back-btn`).

## 1.0.0

- Initial semver; Profile shows app version from `package.json`.
