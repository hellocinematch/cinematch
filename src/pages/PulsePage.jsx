/**
 * Pulse — trending & popular strips (worldwide, or India / Canada per Where you watch).
 * Presentational only; state and effects stay in `App.jsx`.
 */
export function PulsePage(props) {
  const {
    pulseCatalogReady,
    pulseIndia = false,
    pulseCanada = false,
    pulseTrendingRecsResolved,
    pulsePopularRecsResolved,
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
  const SkeletonStrip = props.SkeletonStrip;
  const StripPosterBadge = props.StripPosterBadge;
  const trendingMeta = pulseIndia ? "Now in India" : pulseCanada ? "Now in Canada" : "This week";
  const subtitle = pulseIndia
    ? "Trending & popular in India — scored for your taste"
    : pulseCanada
      ? "Trending & popular in Canada — scored for your taste"
      : "Trending & popular worldwide — scored for your taste";

  return (
    <div className="home">
      <PageShell
        title="Pulse"
        subtitle={subtitle}
      >
        {!pulseCatalogReady ? (
          <>
            <div className="section">
              <div className="section-header">
                <div className="section-title">Trending</div>
                <div className="section-meta">{trendingMeta}</div>
              </div>
              <SkeletonStrip />
            </div>
            <div className="section">
              <div className="section-header">
                <div className="section-title">Popular</div>
                <div className="section-meta">Movies &amp; TV</div>
              </div>
              <SkeletonStrip />
            </div>
          </>
        ) : (
          <>
            <div className="section">
              <div className="section-header">
                <div className="section-title">Trending</div>
                <div className="section-meta">{trendingMeta}</div>
              </div>
              {pulseTrendingRecsResolved.length === 0 ? (
                <div className="empty-box">
                  <div className="empty-text">No trending titles right now</div>
                </div>
              ) : (
                <div className="strip">
                  {pulseTrendingRecsResolved.map((rec) => (
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
                <div className="section-title">Popular</div>
                <div className="section-meta">Movies &amp; TV</div>
              </div>
              {pulsePopularRecsResolved.length === 0 ? (
                <div className="empty-box">
                  <div className="empty-text">No popular titles right now</div>
                </div>
              ) : (
                <div className="strip">
                  {pulsePopularRecsResolved.map((rec) => (
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
              pulseTrendingRecsResolved.length + pulsePopularRecsResolved.length > 0 && (
                <div className="no-recs" style={{ marginTop: 16, border: "none", padding: "12px 0 0" }}>
                  <div className="no-recs-text" style={{ fontSize: 12 }}>Rate a few titles for tighter predictions</div>
                  <button className="btn-confirm" style={{ marginTop: 12, width: "100%" }} onClick={startDefaultRateMore}>
                    Rate More Titles
                  </button>
                </div>
              )}
          </>
        )}
      </PageShell>
      <BottomNav {...navProps} />
    </div>
  );
}
