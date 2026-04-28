import { LEGAL_PRIVACY_HTML, LEGAL_TERMS_HTML } from "./legalMarkdown.js";
import { LEGAL_PLACEHOLDERS } from "./legalConstants.js";

/** Full legal pages — lazy-loaded from App.jsx to keep initial JS smaller on mobile. */

function LegalTopBar({ title, onBack }) {
  return (
    <div className="legal-topbar">
      <button type="button" className="legal-back" onClick={onBack}>
        ← Back
      </button>
      <div className="legal-topbar-title">{title}</div>
      <div />
    </div>
  );
}

export function LegalPagePrivacy({ onBack }) {
  return (
    <div className="legal-shell">
      <LegalTopBar title="Privacy Policy" onBack={onBack} />
      <div
        className="legal-body legal-body--markdown"
        dangerouslySetInnerHTML={{ __html: LEGAL_PRIVACY_HTML }}
      />
    </div>
  );
}

export function LegalPageTerms({ onBack }) {
  return (
    <div className="legal-shell">
      <LegalTopBar title="Terms of Use" onBack={onBack} />
      <div
        className="legal-body legal-body--markdown"
        dangerouslySetInnerHTML={{ __html: LEGAL_TERMS_HTML }}
      />
    </div>
  );
}

export function LegalPageAbout({ onBack }) {
  const { entity, siteUrl } = LEGAL_PLACEHOLDERS;
  return (
    <div className="legal-shell">
      <LegalTopBar title="About Cinemastro" onBack={onBack} />
      <div className="legal-body">
        <p className="legal-p">
          <strong>Cinemastro</strong> helps you discover movies and shows with ratings, watchlists, and recommendations
          tailored to your taste.
        </p>
        <p className="legal-p">
          This build is under active development. Operator: <strong>{entity}</strong> ·{" "}
          <a href={siteUrl} target="_blank" rel="noopener noreferrer">
            {siteUrl}
          </a>{" "}
          (placeholder).
        </p>
        <p className="legal-p legal-muted">
          Movie and TV metadata and images are provided by TMDB; see the footer on the main screens for attribution.
        </p>
      </div>
    </div>
  );
}
