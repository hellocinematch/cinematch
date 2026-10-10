import { useEffect, useId, useRef, useState } from "react";
import { CinemastroLetsYou } from "../LoggedOutLanding.jsx";
import {
  arrivalPhrase,
  formatWeekendRange,
  loadNewThisWeekCatalog,
  loadSharedNewThisWeekCatalog,
  presentNewThisWeekCatalog,
  weekendEdition,
} from "../newThisWeek.js";

function regionName(region) {
  if (region === "IN") return "India";
  if (region === "CA") return "Canada";
  return "United States";
}

function Poster({ title, src, hero, badge, logo, insideLabel, image }) {
  const url = image || (src ? src(title.poster) : title.poster);
  return (
    <div className={hero ? "ntw-hero-poster" : "strip-poster ntw-poster"}>
      {url ? (
        <img src={url} alt="" decoding="async" />
      ) : (
        <div className="strip-poster-fallback">🎬</div>
      )}
      {insideLabel ? <div className="poster-inside-meta">{insideLabel}</div> : null}
      {logo ? (
        <span className="ntw-service-logo">
          <img src={logo} alt="" />
        </span>
      ) : null}
      {badge || null}
    </div>
  );
}

/** "TV · 2024 · S2" on the poster. Season count fills in after the show detail loads. */
function tvPosterLabel(title, seasonById) {
  if (title?.type !== "tv") return null;
  const extra = seasonById?.[title.tmdbId];
  const year = extra?.year || title.year || "—";
  const n = Number(extra?.season);
  if (Number.isFinite(n) && n > 0) return `TV · ${year} · S${n}`;
  return `TV · ${year}`;
}

/**
 * Weekend home. Members get the bottom menu from the parent.
 * Guests get Sign in, and after the list an explanation with Get started. A poster tap for a guest
 * stays on this page: overview, then sign up.
 */
export function NewThisWeekPage({
  region = "US",
  signedIn = false,
  viewerKey: _viewerKey = "guest",
  fetchTmdb,
  services = [],
  languageFirst = [],
  posterSrc,
  posterHeroSrc,
  posterBadge: _posterBadge,
  onOpenTitle,
  onGetStarted,
  onSignIn,
  onSettled,
}) {
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
  const [pack, setPack] = useState(null);
  const [failed, setFailed] = useState(false);
  const [tvSeasonById, setTvSeasonById] = useState({});
  const tvSeasonRequested = useRef(new Set());
  const [picked, setPicked] = useState(null);
  const closeRef = useRef(null);
  const titleId = useId();
  const edition = weekendEdition(new Date());
  const editionKey = edition?.key || "";
  const languageKey = (languageFirst || []).join(",");

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setPack(null);
    const langs = languageKey ? languageKey.split(",") : [];
    (async () => {
      try {
        const editionNow = weekendEdition(new Date());
        const shared = editionNow
          ? await loadSharedNewThisWeekCatalog({ region, edition: editionNow, date: new Date() })
          : null;
        if (cancelled) return;
        const catalog = shared || await loadNewThisWeekCatalog({
          region,
          fetchTmdb,
          services,
          languageFirst: langs,
        });
        if (cancelled) return;
        const view = presentNewThisWeekCatalog(
          { ...catalog, todayIso: catalog.todayIso },
          langs,
        );
        if (!cancelled) {
          setPack({
            feature: view.feature,
            streaming: view.streaming,
            theaters: view.theaters,
            circleScores: new Map(),
            todayIso: view.todayIso,
          });
        }
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) onSettledRef.current?.();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [region, editionKey, fetchTmdb, services, languageKey]);

  useEffect(() => {
    if (!pack || typeof fetchTmdb !== "function") return undefined;
    const ids = [pack.feature, ...(pack.streaming || []), ...(pack.theaters || [])]
      .filter((title) => title?.type === "tv" && title.tmdbId != null)
      .map((title) => title.tmdbId)
      .filter((id) => !tvSeasonRequested.current.has(id));
    if (ids.length === 0) return undefined;
    for (const id of ids) tvSeasonRequested.current.add(id);
    let cancelled = false;
    (async () => {
      const patch = {};
      await Promise.all(ids.map(async (id) => {
        try {
          const detail = await fetchTmdb(`/tv/${id}?language=en-US`);
          const n = Number(detail?.number_of_seasons);
          const year = String(detail?.last_air_date || detail?.first_air_date || "").slice(0, 4);
          patch[id] = {
            season: Number.isFinite(n) && n > 0 ? n : null,
            year: year || null,
          };
        } catch {
          patch[id] = { season: null, year: null };
        }
      }));
      if (!cancelled) setTvSeasonById((prev) => ({ ...prev, ...patch }));
    })();
    return () => { cancelled = true; };
  }, [pack, fetchTmdb]);

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
          <Poster
            title={pack.feature}
            src={posterHeroSrc || posterSrc}
            hero
            image={pack.feature.backdrop || null}
            insideLabel={tvPosterLabel(pack.feature, tvSeasonById)}
          />
          <div className="ntw-hero-copy">
            <div className="ntw-hero-where">
              {pack.feature.where}
              {arrivalPhrase(pack.feature.releaseDate, pack.todayIso, pack.feature.row)
                ? ` · ${arrivalPhrase(pack.feature.releaseDate, pack.todayIso, pack.feature.row)}`
                : ""}
            </div>
            <div className="ntw-hero-title">{pack.feature.title}</div>
            {pack.feature.synopsis ? <p className="ntw-hero-overview">{pack.feature.synopsis}</p> : null}
          </div>
        </button>
      )}

      <Group
        heading="New to Streaming"
        items={pack?.streaming}
        loading={pack == null && !failed}
        openTitle={openTitle}
        posterSrc={posterSrc}
        tvSeasonById={tvSeasonById}
      />
      {pack?.streaming?.length > 0 && pack?.theaters?.length > 0 ? <div className="ntw-rule" /> : null}
      <Group
        heading="New in Theaters"
        items={pack?.theaters}
        loading={pack == null && !failed}
        openTitle={openTitle}
        posterSrc={posterSrc}
        tvSeasonById={tvSeasonById}
      />

      <div className="ntw-close">
        <div className="ntw-close-title">That’s what’s new.</div>
        <div className="ntw-close-note">A fresh list arrives Thursday night.</div>
      </div>

      {!signedIn && <CinemastroLetsYou onGetStarted={onGetStarted} showButton />}

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

function Group({ heading, note, items, loading, openTitle, posterSrc, tvSeasonById }) {
  if (!loading && (!items || items.length === 0)) return null;
  return (
    <section className="ntw-group" aria-label={heading}>
      <div className="ntw-group-head">
        <h2 className="ntw-group-title">{heading}</h2>
        {note ? <div className="ntw-group-note">{note}</div> : null}
      </div>
      <div className="strip ntw-strip">
        {loading
          ? Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="strip-card-skeleton" aria-hidden="true">
              <div className="strip-poster ntw-skeleton" />
            </div>
          ))
          : items.map((title) => {
            const logo = title.serviceLogo || "";
            const where = String(title.where || "").trim();
            return (
              <button
                key={title.id}
                type="button"
                className="strip-card ntw-card"
                aria-label={logo && where && where !== "Streaming" && where !== "In theaters" ? `${title.title}, ${where}` : title.title}
                onClick={() => openTitle(title)}
              >
                <Poster
                  title={title}
                  src={posterSrc}
                  logo={logo}
                  insideLabel={tvPosterLabel(title, tvSeasonById)}
                />
              </button>
            );
          })}
      </div>
    </section>
  );
}
