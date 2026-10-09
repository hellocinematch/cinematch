/**
 * In Theaters — now playing + popular strips. Presentational only; state and effects stay in `App.jsx`.
 */
export function InTheatersPage(props) {
  const {
    theaterRecs,
    inTheatersPagePopularRecsResolved,
    showRegionKeys,
    availabilityRegion,
    showLanguageFirst,
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

  const india = availabilityRegion === "IN";
  const canada = availabilityRegion === "CA";
  const languageLead = india
    ? (showLanguageFirst || [])
      .map((code) => ({
        hi: "Hindi", ta: "Tamil", te: "Telugu", ml: "Malayalam", kn: "Kannada", bn: "Bengali", mr: "Marathi",
      }[code]))
      .filter(Boolean)
      .join(", ")
    : "";
  const emptyTheatersMessage = india
    ? "No Indian-language releases in this window"
    : showRegionKeys.length > 0
      ? `Limited titles for this region in ${canada ? "Canadian" : "US"} theaters right now`
      : canada
        ? "No theatrical releases in Canada right now"
        : "No theatrical releases";
  const emptyAlsoMessage = india ? "No other films playing in India right now" : emptyTheatersMessage;

  return (
    <div className="home">
      <PageShell
        title="In Theaters"
        subtitle={india
          ? "Now playing in India — scored for your taste"
          : canada
            ? "Now playing and what's popular in theaters in Canada — scored for your taste"
            : "Now playing and what's buzzing in US theaters — scored for your taste"}
      >
        <div className="section" style={{ paddingTop: 0 }}>
          <div className="section-header">
            <div className="section-title">Now Playing</div>
            <div className="section-meta">
              {india
                ? (languageLead ? `${languageLead} first, then other Indian languages` : "Indian languages")
                : canada
                  ? "In theaters in Canada"
                  : "In theaters"}
            </div>
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
                    <PosterInsideMeta movie={rec.movie} tvMetaByTmdbId={tvStripMetaByTmdbId} />
                    <StripPosterBadge movie={rec.movie} predicted={rec.predicted} predictedNeighborCount={recNeighborCount(rec)} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="section">
          <div className="section-header">
            <div className="section-title">{india ? "Also in theaters" : "Popular in theaters"}</div>
            <div className="section-meta">
              {india
                ? "Other films playing in India"
                : canada
                  ? "Most popular films playing in Canada"
                  : "Weekly TMDB trending — same US theatrical filters as Now Playing"}
            </div>
          </div>
          {inTheatersPagePopularRecsResolved.length === 0 ? (
            <div className="empty-box">
              <div className="empty-text">{emptyAlsoMessage}</div>
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
                    <PosterInsideMeta movie={rec.movie} tvMetaByTmdbId={tvStripMetaByTmdbId} />
                    <StripPosterBadge movie={rec.movie} predicted={rec.predicted} predictedNeighborCount={recNeighborCount(rec)} />
                  </div>
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
