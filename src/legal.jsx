import { LEGAL_PRIVACY_HTML, LEGAL_TERMS_HTML } from "./legalMarkdown.js";

/** Full legal pages — lazy-loaded from App.jsx to keep initial JS smaller on mobile. */

export function LegalTopBar({ title, onBack, titleAside = null }) {
  return (
    <div className="legal-topbar">
      <button type="button" className="legal-back" onClick={onBack}>
        ← Back
      </button>
      <div className="legal-topbar-title-wrap">
        <div className="legal-topbar-title">{title}</div>
      </div>
      <div className="legal-topbar-trailing">
        {titleAside ? <div className="legal-topbar-title-aside">{titleAside}</div> : null}
      </div>
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
