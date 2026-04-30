# Circle UI performance — staged cache / SWR

Session-scoped **stale-while-revalidate**: show cached payload immediately, fetch in background, update UI **only when** the fingerprint changes (avoid flicker). See `src/circleDetailSessionCache.js`.

## Step 1 (shipped starting 7.0.25)

- **Circle detail metadata** (`fetchCircleDetail`): cache per `circleId`, hydrate on open, background refetch, compare **`fingerprintCircleDetail`**.
- **Recent rated strip — first page** (`fetchCircleRatedTitles`, `view: "recent"`, offset `0`): same pattern with **`fingerprintRecentStripPayload`**.
- Invalidate **recent strip** cache when **`circleRatedRefreshKey`** increments (publish / unpublish / etc.).
- Clear both caches when the user signs out (**`clearCircleDetailSessionCaches`**).
- Remove **left circle** payloads from caches after successful leave (**`invalidateCircleSwrCaches(circleId)`**).
- After **edit circle**, **`setCircleDetailCache`** stays aligned with server shape.

## Step 2 (shipped starting 7.0.26)

- **TMDB hydrate map:** **`src/circleTmdbHydrateSessionCache.js`** — normalized TMDB rows keyed by **`movie-{id}` / `tv-{id}`** merged after each hydrate batch; **`circleStripResolveMovie`** reads session cache after **`movieLookupById`** and **`circleStripExtraMovies`**; **`circleDetailHydrateIds`** skips ids already cached (plus **`circleTmdbHydrateTick`**). Cleared via **`clearCircleTmdbHydrateSessionCache`** on sign-out alongside circle SWR caches.

## Step 3 (shipped starting 7.0.27)

- **Circles list:** On **`screen === "circles"`** after the first successful load, **`reloadMyCircles({ silent: true })`** — no **`circlesLoading`** spinner; **`fingerprintMyCirclesList`** (**`src/myCirclesListFingerprint.js`**) skips **`setCirclesList`** when unchanged; nonce drops stale **`fetchMyCircles`** responses.

## Step 4 (shipped starting 7.0.28)

- **All / Top merged grids:** Session **`gridMergedByKey`** in **`circleDetailSessionCache.js`** — full merged payloads (including **Load more**); **`peekCircleGridMergedCache` / `setCircleGridMergedCache` / `invalidateCircleGridCaches` / `invalidateCircleGridCacheSingle`**; silent reconcile uses **`circleGridSilentRecacheAskLimit`** (**Top** capped **`CIRCLE_TOP_MAX`**; **All** capped **`CIRCLE_GRID_MERGED_RECACHE_MAX`**). **`invalidateCircleSwrCaches`** and **`circleRatedRefreshKey`** sweep invalidate grids + recent strip cache.

## Step 5 (planned)

- Revisit **`get_circle_others_activity_watermark`** polling / focus probes once steps 1–4 are stable; optionally narrow or simplify “new activity” UX.
