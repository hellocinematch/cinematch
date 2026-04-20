# Changelog

## 5.5.4

- **Circles — circle detail (mobile).** Narrow viewports: circle name uses **DM Sans** at a slightly smaller clamp; creator **crown** is **top-right** in the title row (absolute) with reduced size so wrapped titles don’t sit beside the emoji.

## 5.5.3

- **Circles — Circle info member names.** The Circle info modal lists each member’s display name from `profiles.name`. Direct client `select` on `profiles` only returns rows visible under RLS (usually just yourself), so the app now calls **`get_circle_member_names(p_circle_id)`** (SECURITY DEFINER, gated on `is_circle_member`) and merges any gaps with the legacy `profiles` query. Apply migration **`supabase/migrations/20260503120000_get_circle_member_names.sql`** on Supabase before relying on names for co-members.

## 5.5.2

- **Title detail (TMDB-style).** Centered hero title (smaller title + smaller year); poster vertically centered on backdrop; inline two-column scores with stacked range/confidence and Cinemastro meter; shaded facts bar (cert, US date, runtime, genres) from TMDB `append_to_response`; centered tagline, overview, and Where to Watch panel. Rating block: default **5**, value bubble on slider, **“Select your rating and submit”**, centered controls.
- **Primary nav (recap).** Mobile detail: back on first row, no hamburger; Discover drops duplicate top bar; bottom bar shows public stats between Mood and Profile; Profile opens account menu app-wide.

## 5.5.0

- **Watchlist — group hint.** `watchlist.source_circle_id` (optional FK to `circles`). When you save from title detail opened **from a circle** (`circle-detail` → strip card), the row stores the circle id; **Profile → Watchlist** shows a small **Group** label (no circle name). Migration: `supabase/migrations/20260501120000_watchlist_source_circle_id.sql`.
- **Match / Your Picks.** `your_picks_page` hydrates whenever you have ratings and a non-empty catalogue (not only certain tabs). Edge payload prefers `catalogueForRecs`, with **fallback to full `catalogue`** when filters leave the filtered list empty. Responses from `supabase.functions.invoke` are normalized via `unwrapMatchFunctionData`. Prediction overlays merge string/number scores and `neighbor_count` / `neighborCount`; `yourPicksPredictions` is always replaced (including `{}`) to avoid stale maps.

## 5.4.4

- **Circles — Circle info UX.** Hero: **vibe**, **member count**, and **Circle info** on **one row** (left cluster + link right). Circle info opens as a **centered modal** over the circle view (`z-index: 2300`), not a bottom sheet. Circle name in the hero uses a **2-line clamp** so long titles don’t dominate the card.

## 5.4.3

- **Circles — Circle info sheet.** Hero layout **B**: vibe on its own row; **members** count left and **Circle info** link right on the row below. Sheet lists members (names from `profiles` when RLS allows) with Creator/Member labels; **Leave circle** moved here (removed from main detail body). Reuses existing leave confirmation.

## 5.4.2

- **Circles strip UI.** Single horizontal row for **Rated in this circle** (together + solo in server order). **Load more** is a trailing **›** tile at the end of the strip (no separate second section; cap 20 unchanged).

## 5.4.1

- **Circles strip performance.** `get_circle_rated_strip` now calls `get_cinemastro_title_avgs` only for titles on the **current page** (not every solo title in the circle). Edge `get-circle-rated-titles` uses **two batched reads** from `user_title_predictions` (movie + tv) and **no longer** invokes `match_predict_neighbor_raters` per title (cold cache → `prediction: null`, same as other strips). Migration: `supabase/migrations/20260430120000_circles_strip_site_avgs_page_only.sql`. Redeploy Edge after pull.

## 5.4.0

- **Circles — Phase C strip pagination.** The circle-detail strip loads **10** most recently rated titles first, then **Load more** fetches **5** at a time up to a **20**-title cap. `get_circle_rated_strip` now takes `p_limit` / `p_offset` (defaults 10 / 0) and returns `total_eligible` and `has_more`. After 20 titles, copy points users to **Discover** to search by title. Migration: `supabase/migrations/20260429120000_circles_strip_pagination.sql`. Redeploy Edge: `get-circle-rated-titles`.

## 5.3.0

- **Circles — Phase C strip UI (`circle-detail`).** Replaces the ≥2-member placeholder with live data from `fetchCircleRatedTitles`. When the circle has fewer than two members, the original explainer stays. With two or more members, the screen loads the Edge response (skeleton while loading), then renders two horizontal strips — **Rated in this circle** (together: ≥2 circle raters, shows circle average + your `StripPosterBadge`) and **Also watched here** (solo: one circle rater, shows Cinemastro site average + your badge). Titles not already in the merged catalogue map are hydrated via TMDB detail (`normalizeTMDBItem`). Tap a card to open the standard title detail (`openDetail`). Empty state when no qualifying titles. Strip errors surface as a banner without blocking the rest of the page.

## 5.2.0

- **Circles — Phase C backend (rated strip API).** Adds `public.get_circle_rated_strip(circle_id uuid)` (SECURITY DEFINER, `auth.uid()` membership check) implementing the Phase C display contract from `20260422120000_circles_schema.sql`: ≥2 members to return strip rows; **together** (≥2 distinct circle raters per title, group average) vs **solo** (exactly one circle rater, Cinemastro site-wide average via `get_cinemastro_title_avgs`); archived circles filter ratings to `rated_at < circles.archived_at`; up to 60 titles ordered by section then recency. Ensures `public.ratings.rated_at` exists when missing (for archive cutoff).
- **New Edge function `get-circle-rated-titles`.** Authenticated callers invoke it with `{ circle_id }`; it runs the RPC with the user JWT, then fills per-title CF predictions (`match_predict_neighbor_raters` + `user_title_predictions` read-through cache) when the viewer has not rated. `npx supabase@latest functions deploy get-circle-rated-titles --project-ref lovpktgeutujljltlhdl`.
- **Client helper `fetchCircleRatedTitles({ circleId })`** in `src/circles.js` (same `invoke` + `FunctionsHttpError` parsing as invite flows). **Strip UI** ships in **v5.3.0**.
- **Migration:** `supabase/migrations/20260426120000_circles_phase_c_get_circle_rated_strip.sql` — apply in Supabase SQL editor (or your usual migration path) before relying on the RPC or Edge function.

## 5.1.0

- **Circles — Phase B (invite by email).** The bell icon on the Circles header is now live. Tap it to open a slide-down Invites panel that lists every pending invite for you (newest first) with the sender's name, the circle's name + vibe badge, and the current member count. Each row has two buttons: **Decline** (direct client update to `circle_invites.status = 'declined'`, recipient is the only one RLS-permitted to flip it) and **Join circle** (calls the new `accept-circle-invite` Edge function). Accepted circles are prepended into the Circles list in place — no refetch. The bell turns solid gold when there's at least one pending invite.
- **Invite composer on circle detail (creator only).** Active-circle creators see a new "+ Invite by email" pill under the hero. It opens a bottom sheet with an email field + "Send invite" CTA that calls the new `send-circle-invite` Edge function. Success drops a center-bottom toast ("Invite sent to X"). If the recipient is at their 10-active-circle cap the Edge auto-declines per spec §3.2 and the toast switches to the warn tone ("Their circles are full — invite was auto-declined."). The button disables at 25/25 members and surfaces the cap banner.
- **Two new Edge functions.** `supabase/functions/send-circle-invite` (creator auth → resolves email → profile id → runs all the cap + duplicate + archived checks → upserts the invite as pending or auto_declined, re-using the existing row if the `circle_invites_unique_pending` constraint already has a terminal one) and `supabase/functions/accept-circle-invite` (recipient auth → re-validates circle is still active and under cap → inserts `circle_members` as service role → flips the invite to accepted). Accept-time user-cap race returns an error and leaves the invite pending (spec §3.3 confirmation); send-time cap breach auto-declines. Stale-archived circle accepts decline the invite as cleanup. Both functions run as `service_role` behind the caller's JWT for ownership checks.
- **Two new SECURITY DEFINER helpers.** `public.resolve_profile_id_by_email(text) → uuid` is called by send-circle-invite only (execute is revoked from `anon`/`authenticated` to prevent email enumeration; service role retains access via the bypass role). `public.get_my_pending_invites() → table` returns every pending invite for `auth.uid()` pre-joined with the circle's display fields, member count, and the sender's `profiles.name`, so the bell panel renders in a single round-trip without fighting SELECT RLS on profiles.
- **New migration:** `supabase/migrations/20260424120000_circles_phase_b_helpers.sql`. Apply via the Supabase SQL editor (no schema changes — functions only).
- **Deploy commands.** `npx supabase@latest functions deploy send-circle-invite --project-ref lovpktgeutujljltlhdl` and `npx supabase@latest functions deploy accept-circle-invite --project-ref lovpktgeutujljltlhdl`. Both require `SUPABASE_SERVICE_ROLE_KEY` in the project's Edge secrets (already configured for the existing `match` / `compute-neighbors` functions).
- **Unchanged.** Creator-leave → archive flow, Phase A RLS model (the three SECURITY DEFINER helpers from the v5.0.0 hotfix still fully gate the client-side invite INSERT / decline UPDATE paths), circle + member cap math, vibe design tokens. Phase C strip UI landed in **v5.3.0** (after this release).

## 5.0.0

- **Circles — Phase A UI (the real Circles page).** The `/circles` placeholder (`"Something exciting is happening here…"`) is gone; the landing screen now renders an actual Circles feature. Header shows "Circles" (DM Serif Display) + live "X of 10 circles" subtitle (count is the user's rows in `circle_members` against `circles.status = 'active'`; archived circles don't count toward the cap). A "+ New Circle" pill opens a bottom sheet (Name required, 1–40 chars; Description optional, ≤100 chars; Vibe dropdown of the 9 spec values, default "Mixed Bag"). Create runs as two sequential inserts — `circles` then `circle_members(role='creator')` — under the "creator can seed own membership" RLS policy; if the membership insert fails, the orphan circle row is deleted best-effort and the error surfaces in the sheet. The 10-circle cap disables the button and shows a warning banner when reached.
- **Circles list + empty state.** Active circles render as cards (DM Serif name, description, vibe badge in the vibe's accent color, member count, 👑 creator crown if you created it), ordered by `created_at desc`, with an ambient radial tint from the vibe's background-tint token (spec §8). Empty state shows a 10-slot visualization plus a "Create a circle" CTA. Archived circles are filtered out of the main list for this pass (a separate Archived section is a later polish pass). Bell icon + pending-invites count is stubbed at 0 for Phase A (invites flow lands in Phase B).
- **Circles — stub dashboard (`/circle-detail`).** Tap a circle → new `circle-detail` screen with a tinted hero (name, vibe badge, member count, creator crown), a "Rated in this circle" placeholder explaining the ≥2 member gate, and a "Leave circle" button. No rated-titles strip, members avatar stack, or settings sheet yet (Phase C). The Circles link in the primary nav stays highlighted while you're drilled in; ← Back returns to the list.
- **Leave flow (client-side, Phase A).** Non-creator leave → single `delete from circle_members where circle_id = $1 and user_id = auth.uid()`. Creator leave → flip `circles.status = 'archived', archived_at = now()` first (required so the "creator can update own circle" USING clause on `status = 'active'` still lets it through), then delete the creator's own row. Last-member-leaves-archived hard-delete is deferred to Phase B's Edge function — archived circles with zero members stay as ghost rows until then, which is fine because none of them surface in any query.
- **New module `src/circles.js`.** Centralizes the 9-vibe catalog + accent/tint colors, the 10-active / 25-member caps, and all four supabase calls (`fetchMyCircles`, `fetchCircleDetail`, `createCircle`, `leaveCircle`). No Edge function changes shipped here — every call is direct RLS-enforced client reads/writes.
- **No schema changes** — the `circles` / `circle_members` / `circle_invites` migration landed on the server in `184c0e0` (pre-bump) and is fully honored by this UI. `watchlist.source_circle_id`, `circles.icon_emoji`, `circles.color`, and the cover-image Storage bucket remain deferred per the migration comment header.
- **Version jump rationale (4.0.10 → 5.0.0).** Circles is the first primary-surface feature since the v4 page architecture shipped, and it introduces a net-new screen type (`circle-detail`), a net-new schema domain, and a social data contract that every subsequent feature hangs off of. Treating it as a 5.0 cut rather than 4.1 matches how the rest of the changelog has marked major-feature introductions.

## 4.0.10

- **Hotfix v4.0.9.** The mobile hamburger commit referenced `React.useState` / `React.useEffect` in `AppPrimaryNav`, but `src/App.jsx` only imports the hooks as named exports (no `React` namespace). That threw `React is not defined` at render time and broke the entire app shell. Switched both calls to the named `useState` / `useEffect` imports. No behavior change beyond "the page now loads again".

## 4.0.9

- **Mobile hamburger menu for the primary nav.** On viewports below 900px the horizontal section links row is replaced by a ☰ button in the top-left; tapping it opens a slide-down drawer containing the same items (Circles / Pulse / In Theaters / Streaming / Your Picks, plus the regional label when a secondary region is set). The drawer dismisses on link tap, scrim tap, the ✕ close button, or Escape. Desktop (≥900px) is untouched — logo, inline section links, and the 🔍 Discover icon still render exactly as before. Also auto-closes if the viewport widens past the breakpoint mid-session (rotate / resize). Client-only; no Edge, no RPC, no prop plumbing changes.

## 4.0.8

- **Home retired; Circles is the landing.** The `home` screen has been removed entirely. Post-login routing, the wordmark tap, back-from-legal, onboarding exit, and the mood back button all now land on `/circles`. The `navTab === "home"` value remains as the idle bottom-nav sentinel (meaning "neither Mood nor Profile is active"), which keeps the page-agnostic state model intact. `SPA_DEEPLINK_READY_SCREENS` now includes `circles`, `secondary-region`, and `your-picks`; `home` is out.
- **Secondary Region moved to its own page.** The theaters + streaming block that used to live under Home now has a dedicated `/secondary-region` route mirroring the In Theaters / Streaming page pattern: top tabs (In Theaters / Streaming), sub-tab under Streaming (Series / Movies), `secondaryStripRecsVisible` strip, skeleton while loading, empty state per pool. Page title is dynamic — uses `V130_SECONDARY_HOME_TITLE[secondaryRegionKey]` (Indian / Asian / Latam / European) falling back to "Region". Nav link only appears when a secondary region is set (as before); deep-linking to the page without one set shows a friendly "pick a region in your profile" empty state.
- **Removed the What's hot strip from the app's primary surface.** Pulse / In Theaters already cover the trending + theatrical shelves. `whatsHot*` data plumbing is retained (still feeds `recMap`, `catalogueForRecs`, and Discover) but no longer rendered as its own strip anywhere.
- **Per-page predict gating moved with the page.** `predict_cached` for `secondaryRecs` now fires on `/secondary-region` (was `/home`). `whatsHotRecs` predict is dropped. `homePicksLoadFailed` memo removed (every remaining page owns its own empty/error states).

## 4.0.7

- **Your Picks hydration: one round-trip.** New Edge action `your_picks_page` combines the prior two sequential calls (`recommendations_only` → `predict_cached` over rec IDs) into a single response. Server-side runs `runRecommendationsOnly` (`match_recommendations_from_neighbors` RPC + worth-a-look pool) and a bulk indexed read from `user_title_predictions` concurrently via `Promise.all`, filters the cached predictions down to the rec IDs the client will render, and returns `{ recommendations, worthALookRecs, predictions }` in one payload. Fixes the ~15s first-load stall (and intermittent 3rd-try failures) caused by cold-cache compute across ~120–280 titles blowing past Edge timeouts — we now overlay strictly from cache, which warms over time from detail-page + other-strip `predict_cached` writes. Client keeps legacy fallbacks (`recommendations_only` + `predict_cached`, and `full` with `omitStripRecs`) so new clients hitting an older Edge continue to work.

## 4.0.6

- **Your Picks is now page-local** — no more borrowing from In Theaters / Streaming / Pulse pools. The 🔥 For you + ✨ Worth a Look strips source exclusively from `recommendations_only` (`recommendations` + `worthALookRecs`) with a page-local `predict_cached` overlay applied on top, matching the pattern Pulse / In Theaters / Streaming already use. The overlay fills in `neighborCount` on rows where `match_recommendations_from_neighbors` returned a TMDB popularity fallback (thin `user_neighbors` / new account), so the blue predicted badge now renders on every row that has a cached per-title prediction.
- **Per-page predict gating (perf).** Every `predict_cached` strip call is now scoped to the screen that actually renders it: `theaterRecs` / `inTheatersPagePopularRecs` → `/in-theaters`; `whatsHotRecs` / `secondaryRecs` → `/home`; `pulseTrendingRecs` / `pulsePopularRecs` → `/pulse`; `streamingMovieRecs` / `streamingTvRecs` → `/streaming-page`; `recommendations_only` + `yourPicksPredictions` → `/your-picks`. Eliminates ~5 unrelated sequential round-trips per route change (Your Picks landing used to wait on theaters + in-theaters popular + what's hot + pulse trending + pulse popular + secondary before firing its own predict). Non-active routes resolve from TMDB fallbacks exactly as before.
- **Bounded Your Picks `predict_cached` set.** The `predict_cached` overlay now runs on just the IDs `recommendations_only` actually returned (~120–280 titles) instead of a speculative top-500 catalogue slice — cold-cache paths were pushing the Edge function into timeout territory on first load. The two Your Picks round-trips run sequentially (CF recs first, then the bounded predict_cached), which is both reliable and cheap.
- **Predicted rows first in For you / Worth a Look.** 🔥 For you and ✨ Worth a Look now partition by prediction quality: **rows with `neighborCount ≥ 1` (blue pill) always render before TMDB-only fallback rows**, even when the fallback has a higher `predicted` score. Each partition is sorted by `predicted` desc. Strip rotation (`topPickOffset` / refresh) cycles within each partition independently so blue pills stay at the top across refreshes.

## 4.0.5

- **Your Picks page:** Primary nav opens a dedicated screen with **🔥 For you** (refreshable via the offset button) and **✨ Worth a Look**, using the same CF + worth-a-look + provider-aware strip builder the Home segment used. No new match / Edge changes—CF `recommendations` and `worthALookRecs` come from the existing `recommendations_only` path; streaming and theater rec pools already on `matchData` backfill as before.
- **Home simplification:** Dropped the Home secondary nav (Now Playing / Your picks / Friends). Home now renders the Now Playing shelves only—Your Picks moved to its own page and Friends is deferred (Circles covers the social surface).

## 4.0.4

- **Streaming page:** Primary nav opens a dedicated **Streaming** screen with two strips over the same US subscription-style pool—**Now Streaming** (newest release / air-date order) and **What’s popular in streaming** (TMDB popularity order)—gated by a Series/Movies toggle. `predict_cached` scores overlay both strips on this route only; fetch and strip predictions no longer run from Home. Home **Now Playing** keeps What’s hot (+ optional Region block); empty-state logic no longer depends on the removed streaming strip.

## 4.0.3

- **In Theaters page:** Primary nav opens a dedicated screen with **Now Playing** (newest US limited/theatrical releases first) and **Popular in theaters** (same gated pool, TMDB popularity order)—both strips use `movie/now_playing` + US release-type window + `predict_cached` (order preserved). The duplicate theatrical block is removed from Home **Now Playing**; What’s hot / Streaming / Region unchanged. `?detail=` deep links work from this screen.

## 4.0.2

- **Pulse:** Dedicated Pulse screen with TMDB week **Trending** and **Popular** (movies + TV), `predict_cached` scores overlaid without reordering strips (TMDB order preserved). Pulse routes from primary nav; Home no longer masquerades as Pulse in the menu.

## 4.0.1

- **Primary navigation:** Replaced the hamburger drawer with a TMDB-style fixed top bar (wordmark, horizontal section links, Discover shortcut). Narrow viewports scroll links horizontally. Circles placeholder copy updated to a “something exciting…” teaser.

## 4.0.0

- **Page architecture scaffold (Step 0):** Added top-left hamburger navigation and shifted bottom fixed bar to Mood/Profile quick access. Introduced shell screens for Circles, In Theaters, Streaming, Your Picks, and conditional Secondary Region, while keeping the existing Home implementation intact as the Pulse baseline during migration.

## 3.5.6

- **For you / Worth a look reliability path:** Added `match` action `recommendations_only` backed by SQL RPC `match_recommendations_from_neighbors`, so home now fetches lightweight recommendation rows without loading full neighbor rating maps in Edge. Client keeps sequential `predict_cached` strip updates and falls back to legacy `full` (`omitStripRecs`) only if the lightweight action fails.

## 3.5.5

- **Home Now Playing — all strips get predictions:** Sequential `predict_cached` runs **In Theaters → What’s hot → streaming movies → streaming TV → secondary region**, then `full` with `omitStripRecs` for **For you** / **Worth a look** + catalogue CF. `matchData` adds `whatsHotRecs` and `secondaryRecs` for strip parity with TMDB fallbacks until each batch returns.

## 3.5.4

- **`match` `full` + home:** Optional body flag `omitStripRecs: true` skips recomputing In Theaters / streaming strip scores (client already has them from `predict_cached`). Response carries `recommendations` and `worthALookRecs` only; the app merges into existing `matchData`.

## 3.5.3

- **Home: strip-by-strip predictions before full:** The app runs batch `predict_cached` **in order** — In Theaters → streaming movies → streaming TV — merging each strip as its response returns, then calls `match` `full` for recommendations, worth-a-look, and a consistent full payload. If `full` fails, previously merged strip scores are kept when present.

## 3.5.2

- **Predicted badge correctness:** Personal blue badges now require real neighbor evidence (`neighborCount >= 1`) on strip, Discover, and Mood cards. Titles falling back to TMDB/Cinemastro no longer appear as personal predictions, matching detail-screen behavior.

## 3.5.1

- **Badge priority + color clarity:** Card badges now prioritize **your predicted score** (when present) over Cinemastro/TMDB crowd scores, while still keeping **your own rating** highest priority. Predicted badges use a distinct blue treatment across home strips, Discover, and Mood results; Cinemastro stays gold and rated stays green.

## 3.5.0

- **Two-function neighbor architecture:** Added `public.user_neighbors` storage + new `compute-neighbors` Edge Function to precompute cosine neighbors offline. Seed subjects are excluded using `profiles.name` (`seed%`), while seed accounts may still appear as neighbors.
- **Faster detail predict:** `match` now reads precomputed neighbors, and detail predict uses SQL RPC `match_predict_neighbor_raters` (neighbors ∩ title raters) instead of heavy runtime neighbor scans. Added optional `ratings (media_type, tmdb_id, user_id)` index migration for large-title performance.
- **Safer prediction behavior:** `match` keeps the no-fabrication rule (`prediction: null` when no real neighbor raters). Read floor aligns with stored neighbors (`0.10`), and prediction cache model version bumps to avoid stale null carryover.
- **On-rating neighbor refresh (deferred):** App now schedules `compute-neighbors` after successful rating writes, but defers execution while onboarding/rate-more/loading flows are active so a batch of onboarding ratings triggers one recompute at the end.

## 3.4.4

- **Predict contributor retention (target merge):** For detail `predict` requests, `match` now explicitly fetches the requested title's ratings for selected top neighbors and merges them into neighbor maps before scoring. This avoids losing target-title contributors to full-map paging limits and improves real prediction hit rate for titles with known overlap.

## 3.4.3

- **Predict candidate composition fix:** For detail `predict` requests, `match` now builds the overlap candidate pool by first including overlap users who already rated the requested target title, then filling the remaining slots with top overlap users. This prevents target-raters from being dropped before candidate slicing and improves real neighbor-backed prediction hit rate without changing TBD behavior when no contributors exist.

## 3.4.2

- **Predict reliability (target-aware neighbor selection):** `match` now uses larger, deterministic candidate windows for detail `predict` requests and prioritizes candidate users who already rated the requested title before final similarity ranking. This improves real neighbor-backed predictions for established users without fabricating a personal score when neighbor evidence is absent.

## 3.4.1

- **Match auth hardening:** `invokeMatch` now validates that the session token looks like a Supabase access token before calling the `match` Edge Function. If a provider token shape is detected, it attempts a session refresh and fails fast with a clear client error instead of sending unsupported JWT algorithms to Edge.

## 3.4.0

- **Title detail cards (copy + clarity):** Left card label is now **For you** in all states. In predicted state, the range and confidence move to compact chips (**`low–high`** + **High/Medium/Low**) and the long tastometer sentence is removed. **TBD** helper text is shortened to **“Rate more to predict.”**
- **Prediction CTA wording:** Predicted-state action text is now confidence-aware — **High:** “Rate more”, **Medium/Low:** “Rate to refine”.
- **Community card labels:** Removed the generic **Crowd** label. Right card now titles by source: **TMDB Score** (TMDB fallback) or **Cinemastro** (community score). Cinemastro subtext is **“TMDB-based”**; TMDB fallback no longer repeats a redundant sublabel.

## 3.3.0

- **Title detail (layout):** **Backdrop hero** with **poster** overlapped on the **lower right**, aligned with the **title** row. **Year** + **type** chips and optional **tagline** (TMDB `tagline` via detail fetch). **No** runtime or certification yet.
- **Title detail (scores):** **Two cards** — **You** (saved rating, or predicted + confidence / range, or **TBD** + rate-more cue) and **Crowd** (**Cinemastro** with meter when available, else **TMDB**). Previous stacked community + prediction blocks removed in favor of this row.

## 3.2.1

- **Title detail:** Opening a title **no longer waits** on the Edge **`predict`** call before navigation. The screen switches immediately; the **“Predicted rating for you”** block shows a **strip-style skeleton** (shimmer) until the prediction returns or fails, then shows the real score or **TBD**.

## 3.2.0

- **Rate now (title detail):** Suggested titles come from **neighbor overlap** (`public.ratings`) even when those titles are **not** in the main CF catalogue. Candidates are ranked the same way as before (overlap count + neighbor avg score + same–media-type boost); **TMDB detail** hydrates metadata for ids missing locally. **Animation** is still excluded after hydrate. **Catalogue-only** popularity fallback unchanged when overlap yields no queue.

## 3.1.2

- **Discover search:** **Clear** control (**×**) appears when the search field is not empty; one tap clears the query and results so you can start a new title without deleting character by character. Input is refocused after clear.

## 3.1.0

- **Cinemastro vote weight (v3.1.0):** RPC **`get_cinemastro_title_avgs`** now returns **`rating_count`** per title alongside **`avg_score`**. Home strips, Discover, mood posters, and title detail show a **gold underline meter** (tiered fill: 0–49, 50–200, 200–500, 500–1500, 1500–3500, 3500–5000 ratings). **No line** when there is no community row; **outline-only / 0% fill** for the lowest tier. Apply **`20260418120000_get_cinemastro_title_avgs_rating_count.sql`** on Supabase (includes **`statement_timeout`** on the function for large `ratings` tables).
- **Safari tab resume:** **`TOKEN_REFRESHED`** no longer calls **`setUser`**, avoiding unnecessary **match** refetch and “main refreshed” feel when switching back to the tab.

## 3.0.0

- **Community score (Cinemastro vs TMDB):** Batch RPC **`get_cinemastro_title_avgs`** returns average **`public.ratings`** score per title (no count shown). **Home strips**, **Discover** cards, and **mood results** badges prefer **Cinemastro** when data exists; otherwise **TMDB**, then predicted. **Cinemastro** uses the same pill as TMDB with a **subtle gold border** (Option B). **Title detail** shows one community block (**Cinemastro** or **TMDB**, labeled); **predicted for you** unchanged. Apply the migration in Supabase before shipping the client.

## 2.1.1

- **Title detail (mobile):** Horizontal layout now follows the same **20px + safe-area** gutters as home **strips** and **section headers** — poster is **slightly inset** with rounded corners; body copy and controls align to the same edge. Desktop (≥900px) layout unchanged.

## 2.1.0

- **Navigation / Safari:** Title **detail** and **legal** overlays now use **distinct URLs** (`?detail=movie-769`, `?legal=privacy`, etc.) on `history.pushState` so **iOS edge swipe** and **Mac trackpad back** can pop the overlay reliably (same-URL `pushState` worked with toolbar ← but not gestures). **Go home** and in-app back when no stack entry use **`replaceState`** to strip those query keys. **Cold loads** with `?detail=` or `?legal=` open the right screen once the user reaches a main surface (home / discover / profile / rated / mood results) and the title resolves from catalogue + strips.

## 2.0.8

- **Your picks / Worth a Look:** When **streaming providers** are selected in Profile, **Worth a Look** (strip 2) no longer receives titles that **are** on those services. The earlier TMDB flatrate pass was correct, but **top-up** and **rebalance** filled strip 2 from the scored pool **without** re-checking providers; rebalance could also move an **on-service** title from **For you** into strip 2. Strip 2 growth now uses **`topUpYourPicksStripsRespectingStreaming`** (provider-aware top-up + off-service-only rebalance).

## 2.0.7

- **Your picks (For you / Worth a Look):** **Pick** vs **Popular** shown as **icon-only** pills (**✨** / **📈**) on the **lower-left** of the poster (same dark pill treatment as the score on the lower-right). Loading skeleton uses a small placeholder in that corner instead of a text line below the title.

## 2.0.6

- **Home strips (Now Playing + Your picks):** Removed per-card **predicted low–high range** and **confidence** lines. The **poster badge** still shows the single score (or your rating); **range and confidence** remain on **title detail** only.

## 2.0.5

- **Title detail:** **Predicted rating for you** (numeric + range) only when **`neighborCount` ≥ 1** — i.e. a real neighbour-based score from `match`. If the only signal is the TMDB fallback (`neighborCount` 0), show **TMDB Average Rating** + **TBD** / **Rate more titles to unlock** instead of reusing TMDB as “predicted for you.”

## 2.0.4

- **Your picks badges:** **✨ Pick** again uses only the strict **`match` `recommendations`** (CF neighbour list). Unioning worth-a-look / theater / streaming ids made **every** strip row a Pick.

## 2.0.3

- **Match / Edge auth:** `invokeMatch` now **refreshes the session** when the access token is missing/expiring soon and **retries once** after a **401** from the `match` function. Stale `getSession()` tokens often caused **Invalid JWT** at the Edge gateway and inside `getUser()`.

## 2.0.2

- **Your picks badges:** **✨ Pick** if the title id appears in **any** Edge `match` rec list (`recommendations`, `worthALookRecs`, `theaterRecs`, `streamingMovieRecs`, `streamingTvRecs`). **📈 Popular** only for **client `tmdbOnlyRec`** rows when the server did not return that pool. (v2.0.1 used `neighborCount` ≥ 1, but the Edge function often emits **0** when `predictRatingRange` has no per-title overlap, so everything looked Popular.)

## 2.0.1

- **Your picks badges:** **✨ Pick** now means either the strict **`match` `recommendations`** list **or** any title with **neighbor-based scores** (`neighborCount` ≥ 1). **📈 Popular** is reserved for **TMDB-only** filler rows with **no** neighbor overlap. IDs for the CF list use **`mediaIdKey`** so labels stay correct after JSON. (Earlier 2.0.0 logic labeled most neighbor-scored strips as Popular because only the small `recommendations` array counted as Pick.)

## 2.0.0

- **Your picks (For you / Worth a Look):** Row badges distinguish **✨ Pick** (titles in **`match` `recommendations`** — collaborative picks) from **📈 Popular** (worth-a-look / theater / streaming / pad pool scored rows not in that CF list).

## 1.3.11

- **Your picks:** **Strip source** is now CF **`recommendations` first**, then **worth-a-look + theater + streaming** predictions **deduped**, so a small CF list no longer **replaces** a larger pre-match pool (fixes **full row for a moment then only a couple of cards**). **`match`** optional arrays use a **stable empty reference** (`EMPTY_MATCH_RECS`) so memos/effects are not retriggered every render when data is missing.

## 1.3.10

- **Your picks:** With **streaming providers** selected, **For you** first keeps titles on those services, then **pads to the row cap** with the next-best predictions from the same scored list (so the strip is not stuck at 1–2 cards when few catalogue titles match the provider filter). **`topUpYourPicksStrips`** now grows **partial** strips toward caps, not only empty ones.

## 1.3.9

- **Build:** `topUpYourPicksStrips` reassigned `strip1Recs` / `strip2` after `const` declarations; switched to **`let`** so **`npm run build`** (Vite / Rolldown) succeeds on Vercel.

## 1.3.8

- **Your picks — For you / Worth a Look:** Strips stay populated from the same **`match`** scored pools when strict CF **`recommendations`** is empty: merged **worth-a-look + theater + streaming** predictions, **`topUpYourPicksStrips`** so a strip is not left empty when data exists, and a **Refresh** control whenever any strip source exists. Cards show **predicted range** (low–high) and a short **confidence** line.
- **Edge `match`:** **`worthALookRecs`** catalogue buffer increased (**30 → 48**) for client de-dupe / filters. Comments document optional tuning of **neighbor / overlap fetch caps** if results are still insufficient (tradeoff: DB + latency).

## 1.3.7

- **iPhone / slow networks:** Initial catalogue bootstrap uses **2 TMDB calls** (movie + TV **popular** only) so **sign-in and first route** unblock sooner; **top_rated** lists load **in the background** and merge into `catalogue` / `obCatalogue`.
- **Fonts:** Google Fonts load from **`index.html`** with **preconnect** (removed `@import` from the giant inline style block) so text styling can start earlier and the main thread does less work during hydration.
- **Code splitting:** Legal pages (**Privacy / Terms / About**) are **`React.lazy`**-loaded; **`AppFooter`** lives in **`src/appFooter.jsx`** so the lazy chunk is not pulled into the main bundle.
- **Home streaming strip:** Fetch starts after a **short defer** (with **ready** flags cleared immediately so skeletons show) so the first TMDB wave isn’t competing with catalogue bootstrap on cellular.

## 1.3.6

- **Post-login / cold load:** First catalogue bootstrap is tracked explicitly (`catalogueBootstrapDone`) with a **~22s safety timer** so users are **not stuck** on **“Loading Cinemastro…”** if TMDB never returns. Returning users can reach **Home** even when the catalogue array is still empty after a failed fetch; new users on **pref-primary** see **try again** instead of an endless “Loading catalogue…”.
- **Loading screen:** After **10s** on the post-login loading screen, a short **slow-network** hint is shown.
- **Mobile-friendly sequencing:** **What’s hot** and **secondary Region** TMDB fetches start after a **brief defer** so sign-in routing and first paint are less likely to compete with that work on slow devices.

## 1.3.5

- **Auth (Sign in / Sign up / Forgot password / Update password):** If a Supabase auth call **throws** (e.g. flaky network on mobile Safari), the primary button no longer stays stuck on **“Please wait…”** — loading state is cleared in **`finally`**, and a short error message is shown when the request fails unexpectedly.

## 1.3.4

- **Your picks + secondary region:** When a **home secondary region** is set in Profile, **For you** / **Worth a Look** (`match` catalogue) now **includes** titles from that secondary market even if **Regions to show** would exclude them (e.g. Hollywood-only regions + Indian secondary). **Genres to show** still applies to those adds. No secondary selected → unchanged behavior.

## 1.3.3

- **Secondary Region block:** Removed **Load more**; each tab (**In Theaters**, **Streaming → Series/Movies**) shows at most **25** titles. TMDB secondary fetches now target up to 25 per pool so the strip can fill when data exists.

## 1.3.2

- **Secondary Region row (Now Playing):** **In Theaters** and **Streaming** top-level tabs; under Streaming, **Series** and **Movies** (same pattern as the primary Streaming block). Removed per-poster “In theaters” pills — the tab indicates context. Catalogue still unions all fetched titles for ratings / detail.

## 1.3.1

- **“In theaters” pill:** TMDB `now_playing` can still list older titles while metadata shows the original year (e.g. 2014). The pill now requires **plausibly current** release metadata (calendar year within two years of today, and full `release_date` not more than ~two years in the past). Applies to **What’s hot** and the **secondary Region** strip.

## 1.3.0

- **V1.3.0 — Home “second region” strip:** Hollywood / US remains primary for In Theaters, What’s hot, and Streaming. Profile adds **optional single secondary** (`profiles.secondary_region_key`: indian | asian | latam | european). When set, **Now Playing** shows a fourth block titled **Indian / Asian / Latin · Iberian / European** with meta **Theaters & streaming**: merged **theatrical + streaming movies + TV** for that TMDB market (parallel fetch, theaters-first merge, up to **40** titles, **20** visible then **Load more**). Cards use the same small **In theaters** pill as What’s hot when the title is in that market’s theatrical list.
- **DB:** New column `profiles.secondary_region_key` (see `supabase/migrations/20260410120000_profiles_secondary_region_key.sql`).

## 1.2.28

- **Now Playing → What’s hot:** New row **between In Theaters and Streaming** with TMDB **trending movie + TV (day)**, interleaved (~18 titles). Titles are **not** removed just because they also appear in theaters or streaming — overlap is shown with a small **In theaters** pill when a card matches the current **In Theaters** list. Gives users something to scroll while the streaming strip finishes loading.

## 1.2.27

- **Strip & Discover (movies):** When TMDB provides a full `release_date`, home strips and Discover now show a readable **release date** (e.g. `Apr 10, 2026`) instead of year only; year remains the fallback when no full date exists.

## 1.2.26

- **Now Playing → Streaming (Movies):** When TMDB digital discover returns no rows (strict `with_release_type=4`, date window, or profile language filters), the app now falls back in order: same query without language filter, broader discover without release-type in the same date window, then **trending movies (week)** so the strip stays populated.

## 1.2.25

- **Now Playing → Streaming:** Digital-release movie strip now uses `primary_release_date` through **today** (was capped at ~46 days ago), so fast-to-streaming titles are included and the row is less likely to be empty.
- **Now Playing → Streaming tabs:** **Series** is the default tab and appears first; **Movies** second.

## 1.2.24

- **Loading UX polish:** Added shimmering strip skeleton placeholders so recommendation rows are visible immediately while data is loading, instead of showing blank space.
- **Your picks responsiveness:** Low-latency placeholders now render for both **For you** and **Worth a Look** while match/provider work is in flight.
- **Now Playing streaming row:** Movies/Series loading states now use strip skeletons for smoother perceived performance.

## 1.2.23

- **Rate now return path:** After using **Rate now** from a title’s detail prediction card, completing or exiting the rating flow now returns users to that same detail page (context-preserving) instead of redirecting to Your picks. Generic “Rate More Titles” entry points keep returning home.

## 1.2.22

- **Confidence follow-up action:** Detail cards with **low/medium confidence** now show **“Rate more titles to improve”** plus a **Rate now** CTA. Tapping it opens a focused rating flow titled **“Rate Similar titles.”**
- **Neighbor-overlap title queue:** The Rate now queue is now built from collaborative overlap around the current title: find users who rated that title, gather what else they rated, rank unseen candidates by overlap strength (with same-type boost), and surface those first; falls back to popular unseen titles when overlap is sparse.

## 1.2.21

- **Your picks strips:** When **For you** or **Worth a Look** is short of the row cap, **backfill** from **unrated popular** catalogue titles (`appendPopularRows`). **No streaming providers:** append by popularity until 15 / 20. **With providers:** strip 1 only adds popular titles that **stream on selected services**; strip 2 only adds popular titles **not** on those services (same rule as CF Worth a Look). Rows carry **`kind`**: **✨ Pick** (CF / server-scored pool) vs **📈 Popular** (popularity filler), with compact styles and `aria-label` on cards.

## 1.2.20

- **Your picks → Worth a Look:** When CF **`recommendations`** is shorter than the first strip (e.g. only a handful of neighbors), strip 2 was often empty. **Backfill** from Edge **`worthALookRecs`** (same `MORE_TAB_OFF_SERVICE_PRED_MIN` floor, deduped) up to **20** titles. **No streaming providers:** merge immediately. **With providers:** after scoring strip 2 from CF, continue through **`worthALookRecs`** with the same TMDB “not on selected services” rule until full or exhausted.

## 1.2.19

- **Your picks loading UX:** Track **`match`** in-flight (`matchLoading`) and TMDB watch-provider resolution for More strips (`moreStripsLoading`). When both strips are still empty, show **“Loading recommendations…”** or **“Checking where titles stream for your picks…”** instead of the **Rate more titles** empty state. Match invoke clears loading in **`finally`**; effect cleanup clears loading when deps change. Provider-based strip rebuild uses **`try`/`finally`** so loading always clears.

## 1.2.18

- **Tastometer copy:** Detail prediction subtitle **“Based on your tastometer”** (replaces taste-match count). Onboarding: **“Creating your tastometer.”** Post-onboarding load: **“Using your tastometer to predict”** with **“Scoring titles for you.”**

## 1.2.17

- **Home segments (internal):** Rename state ids from legacy `picks` / `more` to `nowPlaying` / `yourPicks` (with named constants) so code matches **Now Playing** / **Your picks** tab labels; rename header helper class to `home-header--no-hero-tagline`. ESLint: optional `catch` binding in `openDetail`.

## 1.2.16

- **More → Your picks:** Raise on-service cap to **15**. When provider-filtered CF leaves gaps, **backfill** from theater + home streaming strips + worth-a-look candidates with **predicted ≥ 6.5** that still match the user’s selected streaming providers (deduped, sorted by prediction).

## 1.2.15

- **Home streaming strip:** Fetches a **broad** US streaming pool (same TMDB paths as before). It does **not** use profile **streaming provider** selection and no longer **re-fetches** when those providers change — personalization by provider stays on **More → Your picks**. Home label updated to reflect this.

## 1.2.14

- **More tab:** First strip (**Your picks**) shows collaborative picks that stream on the user’s **selected** subscription providers (when set); falls back to top CF picks if none match. Second strip (**Worth a Look**) shows other **high-predicted** CF titles **not** on those providers (or beyond the first strip when no providers are selected). Cold start with no CF still uses popularity fallback for the first strip.

## 1.2.13

- **Discover recency sort:** Sort Discover results by release year descending so newer titles appear first; entries without a year remain at the end.
- **Discover All breadth:** Keep the full two-page fetch on **All** (up to 40 movies + 40 TV) instead of trimming the blended list.

## 1.2.12

- **Discover search depth:** Merge two TMDB search pages per medium (deduped by id) so titles ranked past the first ~10–20 can appear. **All** now shows up to **20 movies + 20 TV** (was 10+10). **Movies** / **TV Shows** show up to **40** from the merged pages. Failed TMDB responses show a clear message instead of looking like “no results.”

## 1.2.11

- **Home streaming load UX:** Fetch streaming movies and series in two phases so movies can render first; show per-tab “Loading…” until each phase completes; only show the global “Couldn’t load picks” state after both phases finish with no titles (avoids false errors while TV is still loading).

## 1.2.1

- **Mood era options:** Added `Modern (3–15 years)` to the vibe card and renamed classic copy to `Classic (15+ years)` to match actual logic.
- **Deterministic era precedence:** Mood date filters now resolve predictably as `Modern` > `Just released / Last 3 years` > `Classic`, preventing conflicting selections from producing ambiguous windows.

## 1.2.0

- **Mood relevance and clarity:** Added `Animation & Anime` as an explicit mood opt-in while keeping animation excluded by default. Tightened **Critically acclaimed** with an absolute `vote_count >= 200` floor to avoid low-sample titles.
- **Prediction display polish:** Normalized predicted scores and ranges to one decimal place across Home, Mood, Discover, and Detail views.

## 1.1.9

- **Mood animation opt-in:** Add a dedicated **Animation & Anime** vibe chip. Mood keeps animation excluded by default, but selecting this chip lifts the genre-16 exclusion for that mood run (including fallback discover fetches). Family-friendly remains a separate intent.

## 1.1.8

- **Default animation exclusion:** Exclude TMDB Animation genre (`16`) across core selection surfaces (home catalogue strips, in-theaters, streaming, onboarding regional picks, and mood discover). Discover search now also excludes animation by default; animation-intent queries (e.g. "anime", "cartoon", "animation") switch to animation-only results.

## 1.1.7

- **Mood classic ranking:** Add classic-specific edge ranking on top of the 15+ year TMDB pool. Classics now prioritize top-quality titles (top ~15% TMDB vote average in the candidate set), require stronger vote-count validation, and boost "foundational" picks when many nearest neighbors rate them highly.

## 1.1.6

- **Mood acclaimed vs hidden logic:** Pass selected vibes into the Edge `match` mood action and rank candidates differently by vibe using neighbor counts + TMDB vote stats. **Critically acclaimed** now favors broadly validated titles (higher neighbor support / vote-count strength), while **Hidden gem** favors high-quality, lower-exposure picks (1-2 neighbor loves + lower vote-count percentile).

## 1.1.5

- **Mood quick watch:** When only **Quick watch** is selected (or combined with **Critically acclaimed**), use `sort_by=vote_average.desc` and a `vote_count` floor so TMDB ordering diverges from **Critically acclaimed** alone (`popularity.desc` + `vote_average.gte`), which often returned the same top picks for sub‑105‑minute blockbusters.

## 1.1.4

- **Mood fine-tune:** Wire **Hidden gem** and **Quick watch** to TMDB discover (`sort_by=popularity.asc` + `vote_average` / `vote_count` floors for hidden; `with_runtime.lte` for short). Previously hidden had no effect, so it often matched **Critically acclaimed** (popularity + `vote_average.gte` only).

## 1.1.3

- **Mood genre step:** Stop pre-selecting chips from profile `show_genre_ids` when opening Mood, so the genre card starts empty like region and fine-tune—only explicit taps count.

## 1.1.2

- **Home scrollport (iOS):** Make `.app` a column flex container and give `.home` `flex: 1 1 0` with `min-height: 0` so the main feed forms a bounded vertical scroller inside the fixed viewport shell (matching Mood/Profile behavior).

## 1.1.1

- **Discover mobile parity:** Keep Discover as a full-height in-shell vertical scroller so mobile can reach the full result list consistently after search focus and results load.

## 1.1.0

- **iOS viewport expansion hardening:** Added a fixed `viewport-shell` wrapper so visual viewport shifts cannot expand the app beyond intended mobile width.
- **Input-focus stability:** Enforced iOS-safe form control sizing/text behavior (`text-size-adjust` + 16px controls) and updated auth/search input styling so focusing fields does not trigger persistent layout expansion.
- **Discover-specific fix:** Raised `.search-input` to 16px with native appearance reset to stop Safari focus expansion on Discover/Rated search bars.

## 1.0.37

- **iOS overflow hardening (drift recovery):** Keep intentional horizontal scrollers (`.strip`, `.filter-row`) but aggressively re-clamp page viewport X back to `0` after touch/scroll/resize/pageshow and key screen transitions. Fixes cases where Safari remained shifted to the right even after the earlier gesture-blocking fix.

## 1.0.36

- **Root-cause iOS overflow resolution:** Replace continuous scroll-clamp workaround with gesture-level prevention. Horizontal touch gestures are now blocked at page level and only allowed inside intentional x-scrollers (`.strip`, `.filter-row`). This prevents Safari viewport drift while preserving horizontal card/chip scrolling.

## 1.0.35

- **iOS overflow lock (continuous):** Add runtime horizontal-scroll clamp listeners (`scroll`, `touchmove`, `touchend`, `resize`) that force viewport/document `scrollLeft` back to `0`. This prevents persistent sideways drift on landing/home after Safari gesture bounce.

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
