/** Compact counts for nav / marketing (e.g. `1.2k`, `50k`). */
export function formatPublicStat(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  const x = Math.floor(n);
  if (x < 1000) return String(x);
  if (x < 10000) return `${(x / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (x < 1_000_000) return `${Math.round(x / 1000)}k`;
  return `${(x / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}
