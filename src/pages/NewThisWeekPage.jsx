import { useEffect, useId, useRef, useState } from "react";
import {
  arrivalPhrase,
  chooseFeature,
  displayRow,
  formatWeekendRange,
  loadCircleScores,
  loadNewThisWeekCatalog,
  readFeaturePin,
  weekendEdition,
  writeFeaturePin,
} from "../newThisWeek.js";

function regionName(region) {
  if (region === "IN") return "India";
  if (region === "CA") return "Canada";
  return "United States";
}

function Scores({ circle, tmdb }) {
  if (circle == null && tmdb == null) return null;
  return (
    <div className="ntw-scores">
      {circle != null && (
        <span className="ntw-score-circle">
          Circle <span className="ntw-score-num">{Number(circle).toFixed(1)}</span>
        </span>
      )}
      {tmdb != null && <span className="ntw-score-tmdb">TMDB {tmdb}%</span>}
    </div>
  );
}

function Poster({ title, src, hero }) {
  const url = src ? src(title.poster) : title.poster;
  return (
    <div className={hero ? "ntw-hero-poster" : "strip-poster ntw-poster"}>
      {url ? (
        <img src={url} alt="" decoding="async" />
      ) : (
        <div className="strip-poster-fallback">🎬</div>
      )}
    </div>
  );
}

/**
 * Weekend home. Members get the bottom menu from the parent.
 * Guests get Sign in and a small Get started. A poster tap for a guest
 * stays on this page: overview, then sign up.
 */
export function NewThisWeekPage({
  region = "US",
  signedIn = false,
  viewerKey = "guest",
  fetchTmdb,
  services = [],
  languageFirst = [],
  posterSrc,
  posterHeroSrc,
  onOpenTitle,
  onGetStarted,
  onSignIn,
}) {
  const [pack, setPack] = useState(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState(null);
  const closeRef = useRef(null);
  const titleId = useId();
  const edition = weekendEdition(new Date());
  const languageKey = (languageFirst || []).join(",");

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setPack(null);
    (async () => {
      try {
        const catalog = await loadNewThisWeekCatalog({
          region,
          fetchTmdb,
          services,
          languageFirst: languageKey ? languageKey.split(",") : [],
        });
        if (cancelled) return;
        const circleScores = signedIn ? await loadCircleScores() : new Map();
        if (cancelled) return;
        const pinnedId = catalog.edition
          ? readFeaturePin(catalog.edition.key, catalog.region || region, viewerKey)
          : null;
        const feature = chooseFeature({
          streaming: catalog.streaming.filter((title) => title.inWeek !== false || circleScores.has(title.id)),
          theaters: catalog.theaters,
          circleScores,
          pinnedId,
        });
        if (feature && catalog.edition) {
          writeFeaturePin(catalog.edition.key, catalog.region || region, viewerKey, feature.id);
        }
        const streaming = displayRow(catalog.streaming, feature?.id);
        const theaters = displayRow(catalog.theaters, feature?.id);
        if (!cancelled) {
          setPack({
            feature,
            streaming,
            theaters,
            circleScores,
            todayIso: catalog.todayIso,
          });
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [region, signedIn, viewerKey, fetchTmdb, services, languageKey]);

  useEffect(() => {
    if (!picked) return undefined;
    const onKey = (ev) => {
      if (ev.key === "Escape") setPicked(null);
    };
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [picked]);

  const openTitle = (title) => {
    if (!signedIn) {
      setPicked(title);
      return;
    }
    onOpenTitle?.(title);
  };

  const scoreFor = (title) => {
    if (!signedIn || !pack) return { circle: null, tmdb: title.tmdbPercent };
    const circle = pack.circleScores.get(title.id);
    return {
      circle: circle ? circle.score : null,
      tmdb: title.tmdbPercent,
    };
  };

  const range = edition ? formatWeekendRange(edition.start, edition.end) : "";

  return (
    <div className={signedIn ? "ntw" : `ntw ntw--guest${picked ? " ntw--modal" : ""}`}>
      {!signedIn && (
        <div className="ntw-guest-bar">
          <img className="logged-out-logo" src="/cinemastro-logo.svg" alt="Cinemastro" decoding="async" />
          <button type="button" className="logged-out-signin" onClick={onSignIn}>
            Sign in
          </button>
        </div>
      )}

      <div className="ntw-intro">
        <div className="ntw-intro-row">
          <div className="ntw-kicker">This weekend{range ? ` · ${range}` : ""}</div>
          <div className="ntw-region">{regionName(region)}</div>
        </div>
        <h1 className="ntw-title">New this week</h1>
        <p className="ntw-blurb">What opened in theaters and started streaming near you.</p>
        {!signedIn && (
          <button type="button" className="ntw-start" onClick={onGetStarted}>
            Get started
          </button>
        )}
      </div>

      {failed && (
        <p className="ntw-empty">Couldn’t load this weekend’s titles.</p>
      )}

      {!failed && pack == null && (
        <div className="ntw-hero" aria-hidden="true">
          <div className="ntw-hero-poster ntw-skeleton" />
          <div className="ntw-skeleton-line" />
          <div className="ntw-skeleton-line ntw-skeleton-line--short" />
        </div>
      )}

      {!failed && pack && !pack.feature && pack.streaming.length === 0 && pack.theaters.length === 0 && (
        <p className="ntw-empty">Nothing new opened in this window.</p>
      )}

      {pack?.feature && (
        <button type="button" className="ntw-hero" onClick={() => openTitle(pack.feature)}>
          <Poster title={pack.feature} src={posterHeroSrc || posterSrc} hero />
          <div className="ntw-hero-copy">
            <div className="ntw-hero-where">
              {pack.feature.where}
              {arrivalPhrase(pack.feature.releaseDate, pack.todayIso, pack.feature.row)
                ? ` · ${arrivalPhrase(pack.feature.releaseDate, pack.todayIso, pack.feature.row)}`
                : ""}
            </div>
            <div className="ntw-hero-title">{pack.feature.title}</div>
            {pack.feature.synopsis ? <p className="ntw-hero-overview">{pack.feature.synopsis}</p> : null}
            <Scores {...scoreFor(pack.feature)} />
          </div>
        </button>
      )}

      <Group
        heading="Just arrived"
        note={region === "IN" ? "Recently started streaming" : "Started streaming this week"}
        items={pack?.streaming}
        loading={pack == null && !failed}
        openTitle={openTitle}
        posterSrc={posterSrc}
        scoreFor={scoreFor}
      />
      {pack?.streaming?.length > 0 && pack?.theaters?.length > 0 ? <div className="ntw-rule" /> : null}
      <Group
        heading="In theaters"
        note="Opened this week"
        items={pack?.theaters}
        loading={pack == null && !failed}
        openTitle={openTitle}
        posterSrc={posterSrc}
        scoreFor={scoreFor}
      />

      <div className="ntw-close">
        <div className="ntw-close-title">That’s what’s new.</div>
        <div className="ntw-close-note">A fresh list arrives Thursday night.</div>
      </div>

      {picked && (
        <div className="logged-out-dialog-root">
          <button type="button" className="logged-out-dialog-backdrop" aria-label="Close" onClick={() => setPicked(null)} />
          <div className="logged-out-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
            <button
              ref={closeRef}
              type="button"
              className="logged-out-dialog-close"
              aria-label="Close"
              onClick={() => setPicked(null)}
            >
              ×
            </button>
            <div className="logged-out-dialog-head">
              {picked.poster ? (
                <img className="logged-out-dialog-poster" src={posterSrc ? posterSrc(picked.poster) : picked.poster} alt="" />
              ) : null}
              <h2 id={titleId} className="logged-out-dialog-title">{picked.title}</h2>
            </div>
            <h3 className="logged-out-dialog-overview-label">Overview</h3>
            <p className="logged-out-dialog-overview">{picked.synopsis || "No overview yet."}</p>
            <p className="logged-out-dialog-ask">Sign up to rate it, see where you can watch it, and more.</p>
            <button type="button" className="logged-out-cta logged-out-cta--dialog" onClick={onGetStarted}>
              Get started — it’s free
            </button>
            <p className="logged-out-dialog-switch">
              Already have an account?{" "}
              <button type="button" className="logged-out-dialog-signin" onClick={onSignIn}>
                Sign in
              </button>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Group({ heading, note, items, loading, openTitle, posterSrc, scoreFor }) {
  if (!loading && (!items || items.length === 0)) return null;
  return (
    <section className="ntw-group" aria-label={heading}>
      <div className="ntw-group-head">
        <h2 className="ntw-group-title">{heading}</h2>
        <div className="ntw-group-note">{note}</div>
      </div>
      <div className="strip ntw-strip">
        {loading
          ? Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="strip-card-skeleton" aria-hidden="true">
              <div className="strip-poster ntw-skeleton" />
            </div>
          ))
          : items.map((title) => {
            const scores = scoreFor(title);
            return (
              <button
                key={title.id}
                type="button"
                className="strip-card ntw-card"
                onClick={() => openTitle(title)}
              >
                <Poster title={title} src={posterSrc} />
                <div className="strip-title">{title.title}</div>
                <div className="strip-genre">
                  {title.where}
                  {title.type === "tv" ? " · Series" : ""}
                </div>
                <Scores circle={scores.circle} tmdb={scores.tmdb} />
              </button>
            );
          })}
      </div>
    </section>
  );
}
