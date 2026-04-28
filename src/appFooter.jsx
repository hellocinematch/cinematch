import { LEGAL_PLACEHOLDERS } from "./legalConstants.js";

const TMDB_SITE = "https://www.themoviedb.org/";

export function AppFooter({ onPrivacy, onTerms, onAbout }) {
  const { contactEmail, siteUrl } = LEGAL_PLACEHOLDERS;

  function spaNavigate(e, fn) {
    if (typeof fn !== "function") return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    fn();
  }

  return (
    <footer className="app-footer" aria-label="Site">
      <div className="app-footer-links">
        <a href="/about" className="app-footer-link" onClick={(e) => spaNavigate(e, onAbout)}>
          About
        </a>
        <span className="app-footer-dot" aria-hidden>
          ·
        </span>
        <a href="/privacy" className="app-footer-link" onClick={(e) => spaNavigate(e, onPrivacy)}>
          Privacy
        </a>
        <span className="app-footer-dot" aria-hidden>
          ·
        </span>
        <a href="/terms" className="app-footer-link" onClick={(e) => spaNavigate(e, onTerms)}>
          Terms
        </a>
        <span className="app-footer-dot" aria-hidden>
          ·
        </span>
        <a className="app-footer-link" href={`mailto:${contactEmail}`}>
          Contact
        </a>
      </div>
      <p className="app-footer-line">
        © {new Date().getFullYear()} Cinemastro, LLC. All rights reserved.
      </p>
      <p className="app-footer-line app-footer-us-notice">
        Cinemastro is currently available to US users only.
      </p>
      <p className="app-footer-line app-footer-muted">
        Site:{" "}
        <a href={siteUrl} target="_blank" rel="noopener noreferrer">
          {siteUrl}
        </a>
      </p>
      <div className="app-footer-tmdb-block">
        <p className="app-footer-tmdb-text">
          This product uses the TMDB API but is not endorsed or certified by TMDB.
        </p>
        <a
          className="app-footer-tmdb-logo-link"
          href={TMDB_SITE}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="The Movie Database (TMDB)"
        >
          <img
            className="app-footer-tmdb-logo"
            src="/tmdb-attribution-logo.svg"
            alt=""
            width="74"
            height="53"
            decoding="async"
          />
        </a>
      </div>
    </footer>
  );
}
