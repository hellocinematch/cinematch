import { StripPosterImage } from "../StripPosterImage.jsx";

/**
 * Secondary Region — theaters / streaming. Presentational only; state and effects stay in `App.jsx`.
 * Indian shows both rows at once. Other regions keep the In Theaters / Streaming switch.
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
    secondaryTheaterRecsVisible,
    secondaryStreamingRecsVisible,
    openDetail,
    posterSrcThumb,
    PosterInsideMeta,
    tvStripMetaByTmdbId,
    recNeighborCount,
    userRatings,
    startDefaultRateMore,
    navProps,
  } = props;

  const PageShell = props.PageShell;
  const BottomNav = props.BottomNav;
  const StripPosterBadge = props.StripPosterBadge;
  const SkeletonStrip = props.SkeletonStrip;
  const indianStreamingNeedsService =
    secondaryRegionKey === "indian" && secondaryRegionStreamingProviderId == null;

  function renderPosterStrip(recs) {
    return (
      <div className="strip">
        {recs.map((rec) => (
          <div className="strip-card" key={rec.movie.id} onClick={() => openDetail(rec.movie, rec)}>
            <div className="strip-poster">
              <StripPosterImage src={rec.movie.poster ? posterSrcThumb(rec.movie.poster) : ""} title={rec.movie.title} alt={rec.movie.title} />
              <PosterInsideMeta movie={rec.movie} tvMetaByTmdbId={tvStripMetaByTmdbId} />
              <StripPosterBadge movie={rec.movie} predicted={rec.predicted} predictedNeighborCount={recNeighborCount(rec)} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderServiceSelect(id, quiet) {
    return (
      <select
        id={id}
        className={
          quiet
            ? `choice-box choice-box--menu${secondaryRegionStreamingProviderId != null ? " choice-box--on" : ""}`
            : `streaming-page-service-select${secondaryRegionStreamingProviderId != null ? " streaming-page-service-select--active" : ""}`
        }
        aria-label="Filter by streaming service"
        value={secondaryRegionStreamingProviderId == null ? "" : String(secondaryRegionStreamingProviderId)}
        onChange={(e) => {
          const v = e.target.value;
          onStreamingProviderIdChange(v === "" ? null : Number(v));
        }}
      >
        {secondaryRegionKey === "indian" ? (
          <option value="">Choose a service</option>
        ) : (
          <option value="">All services</option>
        )}
        {streamingServiceOptions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    );
  }

  const streamingEmptyText =
    secondaryRegionStreamingProviderId != null
      ? secondaryRegionKey === "indian"
        ? `No ${secondaryBlockStreamingTab === "movie" ? "movies" : "series"} for that service in India (TMDB) — try another.`
        : `No ${secondaryBlockStreamingTab === "movie" ? "movies" : "series"} in this US discover view for that service — try All services or another.`
      : secondaryBlockStreamingTab === "movie"
        ? "No matching streaming movies in the US right now"
        : "No matching streaming series in the US right now";

  const indianNudgeCount =
    (secondaryTheaterRecsVisible?.length || 0) +
    (indianStreamingNeedsService ? 0 : secondaryStreamingRecsVisible?.length || 0);

  return (
    <div className="home">
      <PageShell title={pageTitle} subtitle={pageSubtitle}>
        {!hasValidSecondaryProfile ? (
          <div className="disc-empty">
            <div className="disc-empty-text">
              Pick a secondary region in your profile to see matching US theaters and streaming here.
            </div>
          </div>
        ) : secondaryRegionKey === "indian" ? (
          <>
            <div className="section" style={{ paddingTop: 0 }}>
              <div className="section-header">
                <div className="section-title">In theaters</div>
              </div>
              {!secondaryStripReady ? (
                <SkeletonStrip />
              ) : secondaryTheaterRecsVisible.length === 0 ? (
                <div className="empty-box">
                  <div className="empty-text">No matching theatrical releases in the US right now</div>
                </div>
              ) : (
                renderPosterStrip(secondaryTheaterRecsVisible)
              )}
            </div>
            <div className="section">
              <div className="section-header section-header--choices">
                <div className="section-title">Streaming</div>
                <div className="choice-line choice-line--beside">
                  <div className="choice-boxes">
                    {renderServiceSelect("secondary-region-streaming-service", true)}
                    <button
                      type="button"
                      className={`choice-box${secondaryBlockStreamingTab === "tv" ? " choice-box--on" : ""}`}
                      onClick={onSelectStreamingTabTv}
                    >
                      Series
                    </button>
                    <button
                      type="button"
                      className={`choice-box${secondaryBlockStreamingTab === "movie" ? " choice-box--on" : ""}`}
                      onClick={onSelectStreamingTabMovie}
                    >
                      Movies
                    </button>
                  </div>
                </div>
              </div>
              {indianStreamingNeedsService ? (
                <div className="empty-box">
                  <div className="empty-text">Choose a service to see what’s streaming.</div>
                </div>
              ) : !secondaryStripReady || showSecondaryRefillEmptySkeleton ? (
                <SkeletonStrip />
              ) : secondaryStreamingRecsVisible.length === 0 ? (
                <div className="empty-box">
                  <div className="empty-text">{streamingEmptyText}</div>
                </div>
              ) : (
                renderPosterStrip(secondaryStreamingRecsVisible)
              )}
            </div>
            {Object.keys(userRatings).length === 0 && indianNudgeCount > 0 && (
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
                  {renderServiceSelect("secondary-region-streaming-service", false)}
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
                      : streamingEmptyText}
                  </div>
                </div>
              ) : (
                renderPosterStrip(secondaryStripRecsVisible)
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
      <BottomNav {...navProps} />
    </div>
  );
}
