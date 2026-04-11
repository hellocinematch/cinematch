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
  const { entity, contactEmail, siteUrl, lastUpdated } = LEGAL_PLACEHOLDERS;
  return (
    <div className="legal-shell">
      <LegalTopBar title="Privacy Policy" onBack={onBack} />
      <div className="legal-body">
        <p className="legal-meta">Last updated: {lastUpdated} · Placeholder — not legal advice.</p>
        <p className="legal-p">
          <strong>{entity}</strong> (“we”, “us”) operates the Cinemastro service ({siteUrl} — placeholder). This page
          describes how we handle information in this early version of the product. Replace this text with a policy
          reviewed for your jurisdiction before launch.
        </p>
        <h2 className="legal-h2">What we collect</h2>
        <p className="legal-p">
          If you create an account, our authentication provider (Supabase) processes your email and credentials. We may
          store profile preferences, ratings, and watchlist data you choose to save. We use The Movie Database (TMDB) for
          film and TV metadata and images; queries may go to TMDB’s servers according to their terms.
        </p>
        <h2 className="legal-h2">How we use data</h2>
        <p className="legal-p">
          We use account and activity data to provide recommendations, sync your library, and improve the app. We do
          not sell your personal information as described here; update this section if your practices change.
        </p>
        <h2 className="legal-h2">Contact</h2>
        <p className="legal-p">
          Questions:{" "}
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a> (placeholder).
        </p>
      </div>
    </div>
  );
}

export function LegalPageTerms({ onBack }) {
  const { entity, contactEmail, siteUrl, lastUpdated } = LEGAL_PLACEHOLDERS;
  return (
    <div className="legal-shell">
      <LegalTopBar title="Terms of Use" onBack={onBack} />
      <div className="legal-body">
        <p className="legal-meta">Last updated: {lastUpdated} · Placeholder — not legal advice.</p>
        <p className="legal-p">
          By using Cinemastro operated by <strong>{entity}</strong> at {siteUrl} (placeholder), you agree to these terms
          in their placeholder form. Have counsel review before relying on them.
        </p>
        <h2 className="legal-h2">Service</h2>
        <p className="legal-p">
          Cinemastro is provided “as is”. We may change or discontinue features. TMDB content is subject to TMDB’s
          terms; we do not guarantee availability or accuracy of third-party data.
        </p>
        <h2 className="legal-h2">Accounts</h2>
        <p className="legal-p">
          You are responsible for your account and for ratings and lists you submit. Do not misuse the service or
          attempt to access others’ data.
        </p>
        <h2 className="legal-h2">Limitation of liability</h2>
        <p className="legal-p">
          To the maximum extent permitted by law, {entity} is not liable for indirect or consequential damages arising
          from use of the service. Your sole remedy may be to stop using Cinemastro.
        </p>
        <h2 className="legal-h2">Contact</h2>
        <p className="legal-p">
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
        </p>
      </div>
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
