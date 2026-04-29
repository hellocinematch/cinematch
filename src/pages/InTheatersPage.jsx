/**
 * In Theaters — now playing + popular strips. Presentational only; state and effects stay in `App.jsx`.
 */
export function InTheatersPage(props) {
  const {
    theaterRecs,
    inTheatersPagePopularRecsResolved,
    showRegionKeys,
    openDetail,
    posterSrcThumb,
    formatStripMeta,
    recNeighborCount,
    userRatings,
    startDefaultRateMore,
    navProps,
  } = props;

  const PageShell = props.PageShell;
  const BottomNav = props.BottomNav;
  const StripPosterBadge = props.StripPosterBadge;

  const emptyTheatersMessage =
    showRegionKeys.length > 0
      ? "Limited titles for this region in US theaters right now"
      : "No theatrical releases";

  return (
    <div className="home">
      <PageShell title="In Theaters" subtitle={"Now playing and what's buzzing in US theaters — scored for your taste"}>
        <div className="section" style={{ paddingTop: 0 }}>
          <div className="section-header">
            <div className="section-title">Now Playing</div>
            <div className="section-meta">In theaters</div>
          </div>
          {theaterRecs.length === 0 ? (
            <div className="empty-box">
              <div className="empty-text">{emptyTheatersMessage}</div>
            </div>
          ) : (
            <div className="strip">
              {theaterRecs.map((rec) => (
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
        <div className="section">
          <div className="section-header">
            <div className="section-title">Popular in theaters</div>
            <div className="section-meta">Weekly TMDB trending — same US theatrical filters as Now Playing</div>
          </div>
          {inTheatersPagePopularRecsResolved.length === 0 ? (
            <div className="empty-box">
              <div className="empty-text">{emptyTheatersMessage}</div>
            </div>
          ) : (
            <div className="strip">
              {inTheatersPagePopularRecsResolved.map((rec) => (
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
        {Object.keys(userRatings).length === 0 &&
          theaterRecs.length + inTheatersPagePopularRecsResolved.length > 0 && (
            <div className="section">
              <div className="no-recs" style={{ marginTop: 0, border: "none", padding: "0 0 8px" }}>
                <div className="no-recs-text" style={{ fontSize: 12 }}>Rate a few titles for tighter predictions</div>
                <button className="btn-confirm" style={{ marginTop: 12, width: "100%" }} onClick={startDefaultRateMore}>
                  Rate More Titles
                </button>
              </div>
            </div>
          )}
      </PageShell>
      <BottomNav {...navProps} />
    </div>
  );
}
