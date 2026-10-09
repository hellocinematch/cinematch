/** Profile text size. Small is today’s size. Saved on this device only. */

export const TEXT_SIZE_STORAGE_KEY = "cinemastro_text_size";

export const TEXT_SIZE_OPTIONS = [
  { id: "small", label: "Small" },
  { id: "medium", label: "Medium" },
  { id: "large", label: "Large" },
];

export function normalizeTextSize(value) {
  if (value === "medium" || value === "large") return value;
  return "small";
}

export function readTextSize() {
  try {
    return normalizeTextSize(localStorage.getItem(TEXT_SIZE_STORAGE_KEY));
  } catch {
    return "small";
  }
}

/** Sets `data-text-size` on the document. Does not follow the phone text-size setting. */
export function applyTextSize(value) {
  const next = normalizeTextSize(value);
  if (typeof document !== "undefined") {
    document.documentElement.dataset.textSize = next;
  }
  return next;
}

export function applyStoredTextSize() {
  return applyTextSize(readTextSize());
}

export function writeTextSize(value) {
  const next = applyTextSize(value);
  try {
    if (next === "small") localStorage.removeItem(TEXT_SIZE_STORAGE_KEY);
    else localStorage.setItem(TEXT_SIZE_STORAGE_KEY, next);
  } catch {
    /* private mode: the choice still applies for this visit */
  }
  return next;
}
