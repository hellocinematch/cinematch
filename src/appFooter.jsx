import { LEGAL_PLACEHOLDERS } from "./legalConstants.js";

export function AppFooter({ onPrivacy, onTerms, onAbout }) {
  const { entity, contactEmail, siteUrl } = LEGAL_PLACEHOLDERS;
  return (
    <footer className="app-footer" aria-label="Site">
      <div className="app-footer-links">
        <button type="button" className="app-footer-link" onClick={onAbout}>
          About
        </button>
        <span className="app-footer-dot" aria-hidden>
          ·
        </span>
        <button type="button" className="app-footer-link" onClick={onPrivacy}>
          Privacy
        </button>
        <span className="app-footer-dot" aria-hidden>
          ·
        </span>
        <button type="button" className="app-footer-link" onClick={onTerms}>
          Terms
        </button>
        <span className="app-footer-dot" aria-hidden>
          ·
        </span>
        <a className="app-footer-link" href={`mailto:${contactEmail}`}>
          Contact
        </a>
      </div>
      <p className="app-footer-line">
        © {new Date().getFullYear()} Cinemastro · {entity}
      </p>
      <p className="app-footer-line app-footer-muted">
        Site:{" "}
        <a href={siteUrl} target="_blank" rel="noopener noreferrer">
          {siteUrl}
        </a>{" "}
        (placeholder)
      </p>
      <p className="app-footer-tmdb">
        This product uses the{" "}
        <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">
          TMDB
        </a>{" "}
        API but is not endorsed or certified by{" "}
        <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">
          TMDB
        </a>
        .
      </p>
    </footer>
  );
}
