import { useState } from "react";

/**
 * Poster art. A missing path or a failed load shows the title inside the box.
 * A loaded image stays picture-only.
 */
export function StripPosterImage({ src, title, alt = "" }) {
  const [broken, setBroken] = useState("");
  const url = typeof src === "string" ? src.trim() : "";
  if (url && broken !== url) {
    return (
      <img
        src={url}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setBroken(url)}
      />
    );
  }
  const name = String(title || "").trim();
  return (
    <div className="strip-poster-fallback">
      {name ? (
        <span className="strip-poster-fallback__title">{name}</span>
      ) : (
        <span aria-hidden="true">🎬</span>
      )}
    </div>
  );
}
