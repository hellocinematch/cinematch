import { useEffect } from "react";
import { LEGAL_PRIVACY_HTML, LEGAL_TERMS_HTML } from "./legalMarkdown.js";
import { LEGAL_PLACEHOLDERS } from "./legalConstants.js";

/** Full legal pages — lazy-loaded from App.jsx to keep initial JS smaller on mobile. */

function scrollLegalHashIntoView() {
  const id = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
  if (!id) return;
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * In-page `#id` links must not do a native fragment navigation: that fires `popstate`, which the
 * SPA treats as Back from the legal overlay and returns to the previous screen (e.g. About).
 */
function onLegalInPageLinkClick(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target instanceof Element ? e.target.closest("a[href^='#']") : null;
  if (!a) return;
  const raw = a.getAttribute("href").slice(1);
  if (!raw) return;
  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  const el = document.getElementById(id);
  if (!el) return;
  e.preventDefault();
  const u = new URL(window.location.href);
  u.hash = raw;
  history.replaceState(history.state, "", u.toString());
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

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

export function LegalPagePrivacy({ onBack, signedIn = false, onDeleteAccount }) {
  const { contactEmail } = LEGAL_PLACEHOLDERS;

  useEffect(() => {
    const t = window.setTimeout(scrollLegalHashIntoView, 50);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="legal-shell" onClick={onLegalInPageLinkClick}>
      <LegalTopBar title="Privacy Policy" onBack={onBack} />
      <div
        id="data-request"
        className="legal-delete-account-card"
      >
        <h2 id="delete-account" className="legal-delete-account-card__title">
          Delete your account
        </h2>
        <p className="legal-p">
          Open Cinemastro, sign in, then go to <strong>Profile → Settings → Delete account</strong>.
          Type DELETE to confirm. Circles with other members stay; hosting moves to the next host.
          Your ratings and watchlist are permanently deleted.
        </p>
        {signedIn && typeof onDeleteAccount === "function" ? (
          <button type="button" className="profile-delete-account-btn" onClick={onDeleteAccount}>
            Delete account
          </button>
        ) : (
          <p className="legal-p legal-muted">
            If you cannot sign in, email{" "}
            <a className="about-mail-link" href={`mailto:${contactEmail}`}>
              {contactEmail}
            </a>
            .
          </p>
        )}
      </div>
      <hr className="legal-privacy-divider" />
      <div
        className="legal-body legal-body--markdown"
        dangerouslySetInnerHTML={{ __html: LEGAL_PRIVACY_HTML }}
      />
    </div>
  );
}

export function LegalPageTerms({ onBack }) {
  return (
    <div className="legal-shell" onClick={onLegalInPageLinkClick}>
      <LegalTopBar title="Terms of Use" onBack={onBack} />
      <div
        className="legal-body legal-body--markdown"
        dangerouslySetInnerHTML={{ __html: LEGAL_TERMS_HTML }}
      />
    </div>
  );
}
