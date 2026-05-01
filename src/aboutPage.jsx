import { PUBLIC_BETA_LABEL } from "./productLabels.js";
import { LEGAL_PLACEHOLDERS } from "./legalConstants.js";
import { LegalTopBar } from "./legal.jsx";
import { formatPublicStat } from "./formatPublicStat.js";

const TMDB_SITE = "https://www.themoviedb.org/";

/**
 * About Cinemastro — app metadata, legal entry points, third‑party attribution.
 * Loaded lazily from `App.jsx`.
 */
export function AboutPage({ onBack, onPrivacy, onTerms, onHelp, appVersion, usersCount, ratingsCount }) {
  const { contactEmail, siteUrl } = LEGAL_PLACEHOLDERS;
  const year = new Date().getFullYear();
  const showStats =
    usersCount != null &&
    ratingsCount != null &&
    Number.isFinite(Number(usersCount)) &&
    Number.isFinite(Number(ratingsCount));

  return (
    <div className="legal-shell about-shell">
      <LegalTopBar
        title="About"
        onBack={onBack}
        titleAside={
          showStats ? (
            <>
              users: {formatPublicStat(Number(usersCount))}, ratings: {formatPublicStat(Number(ratingsCount))}
            </>
          ) : null
        }
      />
      <div className="legal-body about-page-body">
        <section className="about-section about-section--hero" aria-labelledby="about-hero-heading">
          <div className="about-logo-wrap">
            <img className="about-logo" src="/cinemastro-logo.svg" alt="" width={176} height={48} decoding="async" />
          </div>
          <h1 id="about-hero-heading" className="about-tagline">
            Your Personal Film Maestro
          </h1>
          <p className="about-version-line">
            Cinemastro
            {PUBLIC_BETA_LABEL ? (
              <>
                {" "}
                <span className="product-beta-pill product-beta-pill--about">Beta</span>
              </>
            ) : null}{" "}
            <span className="about-version-num">v{appVersion}</span>
          </p>
          <p className="legal-p about-intro">
            Discover movies and TV with predictions tuned to your taste, circles for sharing picks, watchlists,
            and theatrical / streaming surfaces — scored where neighbours overlap your ratings.
          </p>
          <p className="legal-p legal-muted about-site-line">
            <a href={siteUrl} target="_blank" rel="noopener noreferrer">
              {siteUrl}
            </a>
          </p>
        </section>

        <section className="about-section" aria-labelledby="about-legal-heading">
          <h2 id="about-legal-heading" className="about-section-heading">
            Legal &amp; compliance
          </h2>
          <p className="legal-p legal-muted about-compliance-note">
            Cinemastro is currently available to US users only.
          </p>
          <ul className="about-link-list">
            {typeof onHelp === "function" ? (
              <li>
                <button type="button" className="about-inline-link" onClick={onHelp}>
                  Help &amp; how to use
                </button>
              </li>
            ) : null}
            <li>
              <button type="button" className="about-inline-link" onClick={onPrivacy}>
                Privacy Policy
              </button>
            </li>
            <li>
              <button type="button" className="about-inline-link" onClick={onTerms}>
                Terms of Use
              </button>
            </li>
            <li>
              Contact:{" "}
              <a className="about-mail-link" href={`mailto:${contactEmail}`}>
                {contactEmail}
              </a>
            </li>
          </ul>
        </section>

        <section className="about-section about-section--credits" aria-labelledby="about-credits-heading">
          <h2 id="about-credits-heading" className="about-section-heading">
            Credits &amp; attribution
          </h2>
          <p className="about-copy-muted">
            © {year} Cinemastro, LLC. All rights reserved.
          </p>
          <p className="about-tmdb-line">
            This product uses the TMDB API but is not endorsed or certified by TMDB.
          </p>
          <a className="about-tmdb-logo-link" href={TMDB_SITE} target="_blank" rel="noopener noreferrer" aria-label="The Movie Database (TMDB)">
            <img className="about-tmdb-logo" src="/tmdb-attribution-logo.svg" alt="" width={74} height={53} decoding="async" />
          </a>
        </section>
      </div>
    </div>
  );
}
