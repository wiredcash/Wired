/** Compact USD display: $1.23, $12.5k, $4.1M, $1.2B */
export function fmtUsd(value: number, opts: { sign?: boolean } = {}): string {
  if (!isFinite(value) || value === 0) return "$0";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : opts.sign ? "+" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1e3).toFixed(2)}k`;
  if (abs >= 1) return `${sign}$${abs.toFixed(2)}`;
  if (abs >= 0.01) return `${sign}$${abs.toFixed(4)}`;
  return `${sign}$${abs.toPrecision(2)}`;
}

export function fmtPct(p: number, decimals = 2): string {
  return `${(p * 100).toFixed(decimals)}%`;
}

export function fmtCompactNumber(n: number): string {
  if (!isFinite(n) || n === 0) return "0";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1e3).toFixed(2)}k`;
  if (abs >= 1) return `${sign}${abs.toFixed(2)}`;
  return `${sign}${abs.toFixed(4)}`;
}
