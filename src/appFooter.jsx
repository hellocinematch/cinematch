import { LEGAL_PLACEHOLDERS } from "./legalConstants.js";

export function AppFooter({ onPrivacy, onTerms, onAbout }) {
  const { entity, contactEmail, siteUrl } = LEGAL_PLACEHOLDERS;

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
