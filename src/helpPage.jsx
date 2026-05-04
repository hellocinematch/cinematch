import { useMemo } from "react";
import { LegalTopBar } from "./legal.jsx";

const RATING_COLORS = [
  { hex: "#e8c96a", label: "Your score / selection", hint: "Gold for your rating chips and Cinemastro-aligned scores on posters and strips." },
  { hex: "#6aaa6a", label: "High confidence / strong signal", hint: "Personal prediction footer on title detail." },
  { hex: "#d0be68", label: "Medium confidence", hint: "Prediction range may be wider." },
  { hex: "#ca7c7c", label: "Low confidence", hint: "Little neighbor overlap yet; fallbacks rely more on community or TMDB context." },
  { hex: "#444", label: "Unset / muted", hint: "Score not chosen yet." },
];

/** @typedef {{ title: string, micro?: string, showFullHelpLink?: boolean, bullets?: string[], paragraphs?: string[], mobileOnly?: boolean }} PostHelpCard */

/** Max-width breakpoint: include phone + tablet for “Add to Home Screen” tour card (desktop skips it). */
const POST_HELP_MOBILEISH_MQ = "(max-width: 1023px)";

/** @type {PostHelpCard[]} */
const POST_HELP_CARDS = [
  {
    title: "Circles are private groups",
    bullets: [
      "Circles bring together people you trust — not the whole internet.",
      "Hosts create a circle and invite by email or share link. Members share activity inside that circle only.",
      'Invites can sit pending until someone joins or declines — check Circles anytime.',
    ],
    micro: "What gets shared inside a circle is on the next card.",
    showFullHelpLink: true,
  },
  {
    title: "How Circles use your ratings",
    bullets: [
      "Ratings you give in a circle feed shared strips and activity — richer than scoring something only for yourself.",
      "Recent rated titles surface on that circle's strip.",
      'Unseen badges flag new activity since you last looked.',
    ],
    micro: "The same title can read differently circle to circle — that’s intentional.",
    showFullHelpLink: true,
  },
  {
    title: "Regional taste on your home market",
    paragraphs: [
      "Your Profile → Secondary region choice (for example Indian) shapes Secondary Region titles — still surfaced for availability in your primary region (United States).",
      "Titles and providers may differ from main Streaming — regional taste layered on your home market.",
    ],
    micro: 'Wrong vibes? Adjust Profile → Secondary region.',
    showFullHelpLink: false,
  },
  {
    title: "Add Cinemastro to your Home Screen",
    bullets: [
      "On iPhone or iPad (Safari): tap Share → Add to Home Screen. Open from the new icon — full screen, like an app.",
      "On Android (Chrome): open the menu (⋮) → Install app or Add to Home screen (wording varies by device).",
    ],
    micro:
      "Same account as the website — one tap to open instead of hunting for a browser tab every time.",
    showFullHelpLink: true,
    mobileOnly: true,
  },
];

function postHelpDeckForInitialViewport() {
  const narrow =
    typeof window !== "undefined" && window.matchMedia(POST_HELP_MOBILEISH_MQ).matches;
  return POST_HELP_CARDS.filter((c) => !c.mobileOnly || narrow);
}

/**
 * One-time post-onboarding carousel (Circles ×2 + Secondary region + optional Home Screen on narrow viewports).
 */
export function PostOnboardingHelpTour({
  step,
  onStepChange,
  onSkip,
  onFullHelp,
  onFinish,
}) {
  const deck = useMemo(() => postHelpDeckForInitialViewport(), []);
  const len = deck.length;
  const idx = Math.min(Math.max(Number(step), 1), len) - 1;
  const card = deck[idx];
  const isLast = step >= len;

  return (
    <div
      className="post-help-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="post-help-title"
    >
      <div className="post-help-overlay__backdrop" aria-hidden />
      <div className="post-help-card">
        <div className="post-help-card__top">
          <span className="post-help-card__steps" aria-live="polite">
            {step} / {len}
          </span>
          <button type="button" className="post-help-card__skip" onClick={onSkip}>
            Skip tour
          </button>
        </div>
        <h2 id="post-help-title" className="post-help-card__title">{card.title}</h2>
        {card.paragraphs ? (
          <>
            {card.paragraphs.map((p) => (
              <p key={p} className="post-help-card__p">{p}</p>
            ))}
          </>
        ) : (
          <ul className="post-help-card__bullets">
            {(card.bullets || []).map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
        {card.micro ? <p className="post-help-card__micro">{card.micro}</p> : null}

        <div className="post-help-card__actions">
          {card.showFullHelpLink ? (
            <button type="button" className="btn-ghost post-help-card__fh" onClick={onFullHelp}>
              Full help →
            </button>
          ) : (
            <span />
          )}
          {!isLast ? (
            <button type="button" className="btn-primary" onClick={() => onStepChange(step + 1)}>
              Next
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={onFinish}>
              Got it
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Browseable Help & how-to (linked from About, tour, and profile menus).
 */
export function HelpFullPage({ onBack }) {
  return (
    <div className="legal-shell">
      <LegalTopBar title="Help & how to use" onBack={onBack} />
      <div className="help-page-body legal-body">

        <h2 className="legal-h2">Pulse</h2>
        <p className="legal-p">
          Trending theatre and catalogue-driven shelves — snapshots of what&apos;s buzzing in your market and taste mix.
          Open tiles for detail, ratings, and watch options.
        </p>

        <h2 className="legal-h2">In theaters</h2>
        <p className="legal-p">
          What&apos;s out now theatrically. Filter and open details the same way as elsewhere; saves and ratings sync with the rest of the app.
        </p>

        <h2 className="legal-h2">Streaming</h2>
        <p className="legal-p">
          Your main streaming hub for the US market: what&apos;s new and popular across services you care about, aligned with your profile preferences.
        </p>

        <h2 className="legal-h2">Secondary region</h2>
        <p className="legal-p">
          If you chose a Secondary region under Profile — Indian, Asian, Latin/Iberian, or European —
          its tab appears beside other main sections. It surfaces titles from that taste bucket still shown for{' '}
          <strong style={{ color: "#ccc", fontWeight: 600 }}>availability where you actively use Cinemastro</strong>{' '}
          (typically the United States), not as if your account were in another country.
        </p>
        <p className="legal-p legal-muted">
          Catalog and provider rows can diverge from main Streaming by design — adjust Profile if results feel narrow or off.
        </p>

        <h2 className="legal-h2">Watchlist</h2>
        <p className="legal-p">
          Save titles for later — ordered list with a sensible cap per account. Move or remove titles from Watchlist anytime.
        </p>

        <h2 className="legal-h2">Your picks &amp; Discover</h2>
        <p className="legal-p">
          Personalized recommendations from neighbors who overlap your ratings, plus Mood pickers and catalogue search via Discover — rate to tune both.
        </p>

        <h2 className="legal-h2">Circles</h2>
        <p className="legal-p">
          Invite-only spaces: shared activity feeds, invites by email, and ratings you intend for that circle. Hosts moderate membership; unseen badges help catch up quickly.
        </p>

        <h2 className="legal-h2">Profile</h2>
        <p className="legal-p">
          Your name and taste controls — genres, streaming focus, Mood regions, and Secondary region shape what each surface shows.
        </p>

        <h2 className="legal-h2">Add to Home Screen (mobile &amp; tablet)</h2>
        <p className="legal-p">
          Cinemastro runs in your browser, but you can <strong style={{ color: "#ccc", fontWeight: 600 }}>pin it to your Home Screen</strong>
          {' '}so it opens in its own window without the usual browser bars. Handy if you use it a lot on a phone — you don&apos;t install from the
          App Store or Play Store; it&apos;s the same site, and you get updates when we ship them.
        </p>
        <p className="legal-p legal-muted">
          You still need an internet connection for most features (ratings, Circles, recommendations). This shortcut is about opening Cinemastro faster, not full offline mode.
        </p>
        <p className="legal-p">
          <strong style={{ color: "#ccc", fontWeight: 600 }}>iPhone and iPad (Safari):</strong>{' '}
          use Safari (in-app browsers don&apos;t always support Add to Home Screen). Tap <strong style={{ color: "#ccc", fontWeight: 600 }}>Share</strong>
          {' → '}<strong style={{ color: "#ccc", fontWeight: 600 }}>Add to Home Screen</strong> and confirm. Then open Cinemastro from the icon on your Home Screen.
        </p>
        <p className="legal-p">
          <strong style={{ color: "#ccc", fontWeight: 600 }}>Android (Chrome):</strong>{' '}
          open the <strong style={{ color: "#ccc", fontWeight: 600 }}>⋮</strong> menu → look for <strong style={{ color: "#ccc", fontWeight: 600 }}>Install app</strong>
          {' '}or <strong style={{ color: "#ccc", fontWeight: 600 }}>Add to Home screen</strong> and follow the prompts. Wording varies by manufacturer; if you don&apos;t see it, try updating Chrome or opening the site in Chrome first.
        </p>
        <p className="legal-p legal-muted">
          If Cinemastro already opens full screen from an icon on your Home Screen, you&apos;re set — you can skip this section.
        </p>

        <h2 className="legal-h2">Ratings — colors</h2>
        <p className="legal-p">
          Cinemastro ties color to signal type, not a judgment of film quality:
        </p>
        <ul className="help-color-list">
          {RATING_COLORS.map((row) => (
            <li key={row.hex} className="help-color-row">
              <span className="help-color-swatch" style={{ background: row.hex }} aria-hidden />
              <span>
                <span className="help-color-row__label">{row.label}</span>
                {' — '}
                <span className="legal-muted">{row.hint}</span>
              </span>
            </li>
          ))}
        </ul>

        <h2 className="legal-h2">Strip badges</h2>
        <p className="legal-p">
          Poster corners may show Cinemastro/community scores vs your picks. Icons such as sparkle vs trending distinguish personal picks from popularity-driven placements.
        </p>
        <p className="legal-p legal-muted">
          A slim gold underline on some badges scales with how strong the community score sample is — not narrative quality for the title itself.
        </p>
      </div>
    </div>
  );
}
