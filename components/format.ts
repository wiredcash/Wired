export function fmtQuarks(quarks: bigint, decimals: number, max = 6): string {
  const negative = quarks < 0n;
  const abs = negative ? -quarks : quarks;
  const s = abs.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals) || "0";
  const fracRaw = s.slice(-decimals);
  const frac = fracRaw.replace(/0+$/, "").slice(0, max);
  const out = frac ? `${whole}.${frac}` : whole;
  return negative ? `-${out}` : out;
}

export function parseInput(amount: string, decimals: number): bigint | null {
  const trimmed = amount.trim();
  if (!trimmed) return null;
  if (!/^\d*(\.\d*)?$/.test(trimmed)) return null;
  const [whole = "", frac = ""] = trimmed.split(".");
  if (whole === "" && frac === "") return null;
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const wholePart = whole === "" ? 0n : BigInt(whole);
  const fracPart = padded === "" ? 0n : BigInt(padded);
  return wholePart * 10n ** BigInt(decimals) + fracPart;
}

export function shortAddr(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}
