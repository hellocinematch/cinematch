import { AppFooter } from "../appFooter.jsx";

/**
 * Secondary Region — theaters / streaming strip. Presentational only; state and effects stay in `App.jsx`.
 */
export function SecondaryRegionPage(props) {
  const {
    pageTitle,
    pageSubtitle,
    hasValidSecondaryProfile,
    segmentTheatersKey,
    segmentStreamingKey,
    secondaryBlockSegment,
    onSelectTheatersSegment,
    onSelectStreamingSegment,
    secondaryRegionKey,
    secondaryRegionStreamingProviderId,
    onStreamingProviderIdChange,
    streamingServiceOptions,
    secondaryBlockStreamingTab,
    onSelectStreamingTabTv,
    onSelectStreamingTabMovie,
    secondaryStripReady,
    showSecondaryRefillEmptySkeleton,
    secondaryActiveRawRows,
    secondaryStripRecsVisible,
    openDetail,
    posterSrcThumb,
    formatStripMeta,
    recNeighborCount,
    userRatings,
    startDefaultRateMore,
    onPrivacy,
    onTerms,
    onAbout,
    navProps,
  } = props;

  const PageShell = props.PageShell;
  const BottomNav = props.BottomNav;
  const StripPosterBadge = props.StripPosterBadge;
  const SkeletonStrip = props.SkeletonStrip;

  return (
    <div className="home">
      <PageShell title={pageTitle} subtitle={pageSubtitle}>
        {!hasValidSecondaryProfile ? (
          <div className="disc-empty">
            <div className="disc-empty-text">
              Pick a secondary region in your profile to see matching US theaters and streaming here.
            </div>
          </div>
        ) : (
          <>
            <div className="section" style={{ paddingTop: 0 }}>
              <div className="filter-row" style={{ paddingTop: 0, paddingBottom: 4 }}>
                <button
                  type="button"
                  className={`filter-pill ${secondaryBlockSegment === segmentTheatersKey ? "active" : ""}`}
                  onClick={onSelectTheatersSegment}
                >
                  In Theaters
                </button>
                <button
                  type="button"
                  className={`filter-pill ${secondaryBlockSegment === segmentStreamingKey ? "active" : ""}`}
                  onClick={onSelectStreamingSegment}
                >
                  Streaming
                </button>
              </div>
              {secondaryBlockSegment === segmentStreamingKey && (
                <div className="filter-row" style={{ paddingTop: 0, paddingBottom: 4 }}>
                  <select
                    id="secondary-region-streaming-service"
                    className={`streaming-page-service-select${secondaryRegionStreamingProviderId != null ? " streaming-page-service-select--active" : ""}`}
                    aria-label="Filter by streaming service"
                    value={secondaryRegionStreamingProviderId == null ? "" : String(secondaryRegionStreamingProviderId)}
                    onChange={(e) => {
                      const v = e.target.value;
                      onStreamingProviderIdChange(v === "" ? null : Number(v));
                    }}
                  >
                    <option value="">All services</option>
                    {streamingServiceOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <span className="streaming-page-service-pill-divider" aria-hidden />
                  <button
                    type="button"
                    className={`filter-pill ${secondaryBlockStreamingTab === "tv" ? "active" : ""}`}
                    onClick={onSelectStreamingTabTv}
                  >
                    Series
                  </button>
                  <button
                    type="button"
                    className={`filter-pill ${secondaryBlockStreamingTab === "movie" ? "active" : ""}`}
                    onClick={onSelectStreamingTabMovie}
                  >
                    Movies
                  </button>
                </div>
              )}
              <div className="section-header">
                <div className="section-title">
                  {secondaryBlockSegment === segmentTheatersKey
                    ? "In Theaters"
                    : secondaryBlockStreamingTab === "movie"
                      ? "Streaming Movies"
                      : "Streaming Series"}
                </div>
                <div className="section-meta">
                  {secondaryBlockSegment === segmentTheatersKey
                    ? "US theaters for this taste"
                    : secondaryRegionKey === "indian"
                      ? "India (TMDB) streaming for this taste; theaters still US"
                      : "US streaming for this taste"}
                </div>
              </div>
              {!secondaryStripReady || showSecondaryRefillEmptySkeleton ? (
                <SkeletonStrip />
              ) : secondaryActiveRawRows.length === 0 ? (
                <div className="empty-box">
                  <div className="empty-text">
                    {secondaryBlockSegment === segmentTheatersKey
                      ? "No matching theatrical releases in the US right now"
                      : secondaryRegionStreamingProviderId != null
                        ? secondaryRegionKey === "indian"
                          ? `No ${secondaryBlockStreamingTab === "movie" ? "movies" : "series"} for that service in India (TMDB) — try All services or another.`
                          : `No ${secondaryBlockStreamingTab === "movie" ? "movies" : "series"} in this US discover view for that service — try All services or another.`
                        : secondaryBlockStreamingTab === "movie"
                          ? secondaryRegionKey === "indian"
                            ? "No matching streaming movies for this taste right now"
                            : "No matching streaming movies in the US right now"
                          : secondaryRegionKey === "indian"
                            ? "No matching streaming series for this taste right now"
                            : "No matching streaming series in the US right now"}
                  </div>
                </div>
              ) : (
                <div className="strip">
                  {secondaryStripRecsVisible.map((rec) => (
                    <div className="strip-card" key={rec.movie.id} onClick={() => openDetail(rec.movie, rec)}>
                      <div className="strip-poster">
                        {rec.movie.poster ? (
                          <img src={posterSrcThumb(rec.movie.poster)} alt={rec.movie.title} loading="lazy" decoding="async" />
                        ) : (
                          <div className="strip-poster-fallback">🎬</div>
                        )}
                        <StripPosterBadge movie={rec.movie} predicted={rec.predicted} predictedNeighborCount={recNeighborCount(rec)} />
                      </div>
                      <div className="strip-title">{rec.movie.title}</div>
                      <div className="strip-genre">{formatStripMeta(rec.movie)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {Object.keys(userRatings).length === 0 && secondaryStripRecsVisible.length > 0 && (
              <div className="section">
                <div className="no-recs" style={{ marginTop: 0, border: "none", padding: "0 0 8px" }}>
                  <div className="no-recs-text" style={{ fontSize: 12 }}>Rate a few titles for tighter predictions</div>
                  <button className="btn-confirm" style={{ marginTop: 12, width: "100%" }} onClick={startDefaultRateMore}>
                    Rate More Titles
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </PageShell>
      <AppFooter onPrivacy={onPrivacy} onTerms={onTerms} onAbout={onAbout} />
      <BottomNav {...navProps} />
    </div>
  );
}
