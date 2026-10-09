import { useEffect, useId, useRef, useState } from "react";

const FEATURES = [
  { icon: "score", text: "Rate a film or a show from 1 to 10, including halves." },
  { icon: "circle", text: "Share that score with your circle, not with everyone on the internet." },
  { icon: "pick", text: "Get recommendations from your circle, and pick a title someone there already rated." },
  { icon: "kin", text: "See picks based on people who rate the way you do." },
  { icon: "mood", text: "Pick a vibe and see titles that fit the mood you’re in." },
  { icon: "save", text: "Save what you want to watch next." },
  { icon: "where", text: "See what’s in theaters and streaming for where you watch." },
  { icon: "watch", text: "Open a title and see where you can watch it." },
];

const stroke = {
  fill: "none",
  stroke: "#f0ebe0",
  strokeWidth: 1.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

function FeatureGlyph({ icon }) {
  const glyph = {
    score: (
      <>
        <path d="M4 16h16" {...stroke} />
        <path d="M7 16V9" {...stroke} />
        <path d="M12 16V6" {...stroke} />
        <path d="M17 16v-4" {...stroke} />
      </>
    ),
    circle: (
      <>
        <circle cx="9" cy="12" r="4.2" {...stroke} />
        <circle cx="15" cy="12" r="4.2" {...stroke} />
      </>
    ),
    pick: (
      <>
        <rect x="5" y="4" width="10" height="14" rx="1" {...stroke} />
        <path d="M8 18l2.2-1.4L12.4 18" {...stroke} />
        <path d="M16 9l2 2 3.5-4" {...stroke} />
      </>
    ),
    kin: (
      <>
        <circle cx="8" cy="9" r="2.2" {...stroke} />
        <circle cx="16" cy="9" r="2.2" {...stroke} />
        <path d="M4.5 17c.6-2.2 2-3.4 3.5-3.4S11 14.8 11.6 17" {...stroke} />
        <path d="M12.4 17c.6-2.2 2-3.4 3.5-3.4s2.9 1.2 3.6 3.4" {...stroke} />
      </>
    ),
    mood: (
      <>
        <path d="M15 6.5A6.2 6.2 0 1 0 16.8 16" {...stroke} />
        <path d="M14 4.5l.4 2.2 2.2.3-1.7 1.4.6 2.1-1.8-1.2-1.9 1.1.6-2.1-1.6-1.5 2.2-.2z" {...stroke} />
      </>
    ),
    save: <path d="M7 4h10v16l-5-3.2L7 20z" {...stroke} />,
    where: (
      <>
        <rect x="3.5" y="6" width="12" height="9" rx="1" {...stroke} />
        <path d="M7 18.5h5" {...stroke} />
        <circle cx="17.5" cy="15.5" r="3" {...stroke} />
        <path d="M17.5 14.2v1.5l1 .6" {...stroke} />
      </>
    ),
    watch: (
      <>
        <path d="M12 20s5-3.6 5-8a5 5 0 1 0-10 0c0 4.4 5 8 5 8z" {...stroke} />
        <circle cx="12" cy="12" r="1.6" {...stroke} />
      </>
    ),
  }[icon];

  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      {glyph}
    </svg>
  );
}

/** Dim city-and-marquee still behind the pitch. Decorative only. */
function FilmStill() {
  const wall = "#1a1a1a";
  const wallDeep = "#141414";
  const line = "rgba(240,235,224,0.22)";
  return (
    <svg
      className="logged-out-still"
      viewBox="0 0 1440 760"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <rect width="1440" height="760" fill="#0c0c0c" />
      <circle cx="1188" cy="118" r="36" fill="rgba(240,235,224,0.14)" />
      <rect x="0" y="250" width="220" height="280" fill={wallDeep} />
      <rect x="180" y="210" width="280" height="320" fill={wall} />
      <rect x="420" y="250" width="160" height="280" fill="#161616" />
      <rect x="560" y="180" width="250" height="350" fill={wallDeep} />
      <rect x="790" y="230" width="300" height="300" fill={wall} />
      <rect x="1060" y="200" width="220" height="330" fill="#171717" />
      <rect x="1240" y="270" width="200" height="260" fill={wallDeep} />
      {[40, 70, 100, 250, 280, 310, 360, 640, 680, 860, 900, 940, 1120, 1160, 1280, 1320].map((x, i) => (
        <rect
          key={x}
          x={x}
          y={300 + (i % 3) * 36}
          width="14"
          height="18"
          fill={i % 5 === 0 ? "rgba(232,201,106,0.28)" : "rgba(240,235,224,0.08)"}
        />
      ))}
      <rect x="230" y="248" width="180" height="16" fill="#221e16" />
      {[248, 272, 296, 320, 344, 368].map((x) => (
        <circle key={x} cx={x} cy="256" r="3" fill="rgba(232,201,106,0.45)" />
      ))}
      <rect x="268" y="300" width="104" height="150" fill="#101010" stroke={line} strokeWidth="1" />
      <line x1="0" y1="530" x2="1440" y2="530" stroke="rgba(240,235,224,0.12)" strokeWidth="1" />
      <rect x="0" y="530" width="1440" height="230" fill="#0e0e0e" />
      <rect x="860" y="548" width="150" height="28" fill="#161616" />
      <circle cx="888" cy="590" r="10" fill="#121212" stroke={line} strokeWidth="1" />
      <circle cx="982" cy="590" r="10" fill="#121212" stroke={line} strokeWidth="1" />
      <circle cx="900" cy="562" r="3" fill="rgba(240,235,224,0.2)" />
      <path d="M470 530c0-28 10-46 22-46s22 18 22 46" fill="#101010" />
      <circle cx="492" cy="468" r="8" fill="#101010" />
      <path d="M530 530c0-32 12-52 24-52s24 20 24 52" fill="#0c0c0c" />
      <circle cx="554" cy="460" r="8" fill="#0c0c0c" />
      <rect x="80" y="470" width="4" height="60" fill="rgba(240,235,224,0.16)" />
      <circle cx="82" cy="466" r="5" fill="rgba(232,201,106,0.35)" />
      <rect width="1440" height="760" fill="rgba(10,10,10,0.62)" />
    </svg>
  );
}

/**
 * Logged-out homepage. Poster taps stay here: overview, then sign up.
 * `loadPosterRow` returns `{ id, title, overview, poster }[]`.
 */
export default function LoggedOutLanding({ onSignIn, onGetStarted, loadPosterRow }) {
  const [posters, setPosters] = useState(null);
  const [picked, setPicked] = useState(null);
  const closeRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    let cancelled = false;
    loadPosterRow()
      .then((rows) => {
        if (!cancelled) setPosters(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setPosters([]);
      });
    return () => {
      cancelled = true;
    };
  }, [loadPosterRow]);

  useEffect(() => {
    if (!picked) return undefined;
    const onKey = (ev) => {
      if (ev.key === "Escape") setPicked(null);
    };
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [picked]);

  return (
    <div className={`logged-out-landing${picked ? " logged-out-landing--modal" : ""}`}>
      <header className="logged-out-hero">
        <FilmStill />
        <div className="logged-out-hero-inner">
          <div className="logged-out-topbar">
            <img
              className="logged-out-logo"
              src="/cinemastro-logo.svg"
              alt="Cinemastro"
              decoding="async"
            />
            <button type="button" className="logged-out-signin" onClick={onSignIn}>
              Sign in
            </button>
          </div>
          <div className="logged-out-hero-spacer" />
          <h1 className="logged-out-lines">
            <span className="logged-out-line">Rate what you watch.</span>
            <span className="logged-out-line">See what your circle loves.</span>
            <span className="logged-out-line">Discover what’s made for your taste.</span>
          </h1>
          <button type="button" className="logged-out-cta" onClick={onGetStarted}>
            Get started — it’s free
          </button>
          <p className="logged-out-quiet">Your ratings. Your circle. Your perfect next watch.</p>
        </div>
      </header>

      {(posters == null || posters.length > 0) && (
        <section className="logged-out-section logged-out-section--posters" aria-label="Titles">
          <div className="logged-out-posters">
            {posters == null
              ? Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="logged-out-poster logged-out-poster--skeleton" aria-hidden="true" />
              ))
              : posters.map((poster) => (
                <button
                  key={poster.id}
                  type="button"
                  className="logged-out-poster"
                  onClick={() => setPicked(poster)}
                  aria-label={`${poster.title}. Overview`}
                >
                  <img src={poster.poster} alt="" decoding="async" />
                </button>
              ))}
          </div>
        </section>
      )}

      <section className="logged-out-section">
        <h2 className="logged-out-kicker">Cinemastro lets you…</h2>
        <div className="logged-out-features">
          {FEATURES.map((feature) => (
            <div key={feature.text} className="logged-out-feature">
              <FeatureGlyph icon={feature.icon} />
              <p>{feature.text}</p>
            </div>
          ))}
        </div>
      </section>

      {picked && (
        <div className="logged-out-dialog-root">
          <button
            type="button"
            className="logged-out-dialog-backdrop"
            aria-label="Close"
            onClick={() => setPicked(null)}
          />
          <div
            className="logged-out-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
          >
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
                <img className="logged-out-dialog-poster" src={picked.poster} alt="" />
              ) : null}
              <h2 id={titleId} className="logged-out-dialog-title">{picked.title}</h2>
            </div>
            <h3 className="logged-out-dialog-overview-label">Overview</h3>
            <p className="logged-out-dialog-overview">{picked.overview}</p>
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
