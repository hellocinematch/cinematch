# Cinemastro Mood Feature Handoff

Last updated: 2026-04-07
Scope: Mood picker + Mood results logic and UX

## Current product behavior (as shipped)

### Mood card options
- Region card includes Hollywood / Indian / Korean / Spanish-Latin / Japanese / European / Any.
- Genre card includes standard genres (including Documentary).
- Vibe card now includes:
  - Critically acclaimed
  - Hidden gem
  - Family friendly
  - Animation & Anime (explicit opt-in)
  - Just released
  - Last 3 years
  - Modern (3-15 years)
  - Classic (15+ years)
  - Quick watch

### Era logic
- Label fixed from `Classic (pre-2000)` to `Classic (15+ years)`.
- Added `Modern (3-15 years)`.
- Deterministic precedence:
  - Modern > Just released/Last 3 years > Classic

### Animation behavior
- Animation is excluded by default (`genre 16`) in Mood.
- Selecting `Animation & Anime` lifts that exclusion for that run.

### Hidden gems logic
- Query behavior for hidden gems:
  - `vote_average.gte=7.5`
  - `vote_count.gte=100`
  - `sort_by=vote_average.desc`
- Candidate expansion:
  - fetch up to 3 pages (movie + tv) for hidden mode.
- Local hidden score:
  - `hiddenBaseScore = (vote_average * 2) - popularity`
  - local sort by score descending.
- Hard guard after normalization:
  - keep only `voteCount >= 100` (prevents 0-vote leakage from fallback payloads).

### Region/country filtering hardening
- Profile/main and mood both use country-aware handling for Hollywood/Indian.
- Hollywood now requires **all origin countries** in `{US, GB, CA, AU, NZ}`.
- Indian uses `IN`.
- Mood additionally hydrates missing origin countries via TMDB detail API before region filtering, because discover payloads can omit country metadata.

### Documentary mis-tag mitigation
- If Documentary genre (`99`) is not selected, Mood filters likely documentary/docuseries titles by text heuristic (`title + synopsis`) to catch TMDB mis-tagging.

### Mood result composition
- Mood results now target fixed mix:
  - 7 movies + 3 TV (with backfill if one side has fewer).
- Edge function mood action returns deeper ranked pool (up to 40) so client can compose the 7/3 mix.

### Already-rated / watchlist behavior
- Already-rated titles are excluded (existing seen-set logic).
- Watchlist titles are not excluded.
- Mood card CTA shows watchlist status:
  - `✓ In Watchlist` if already saved (or selected in-session)
  - otherwise `Select to Watch`.

### Prediction display polish
- Predicted values and ranges are formatted to one decimal in UI (no floating precision artifacts).
- Mood meta line also shows vote count, e.g. `... · 309 votes`.

## Files most relevant
- `src/App.jsx`
  - Mood cards and filters
  - Region gates + country hydration
  - Hidden gem scoring and mood composition
  - Mood card action text/status
- `supabase/functions/match/index.ts`
  - Mood ranking behavior and return depth for mood action

## Known tradeoffs / caveats
- TMDB metadata quality is inconsistent (language/country/genre can be noisy).
- Discover payloads often omit origin country, so detail hydration adds network calls in Mood.
- Bundle size warning exists (`>500k`) but build succeeds.

## What is NOT implemented yet
- Dedicated `Picked for You` strip on Home (discussion happened; not shipped).
- Removal of detail-copy line about taste matches (discussion happened; not yet applied).

## Suggested next tasks (priority)
1. Add lightweight telemetry/logging for rejected Mood candidates (why dropped: country/doc/animation/votes) for debugging.
2. Consider caching detail-hydration responses per mood run (reduce extra TMDB calls).
3. Add feature flag/toggle for strict Hollywood mode if false positives/negatives continue.
4. Implement `Picked for You` row when ready (with dedupe + availability badges).

## Starter prompt for next chat
Use:

`Please read docs/mood-feature-handoff.md first and continue Mood feature work from there. Keep current shipped behavior intact and propose only small incremental changes.`

