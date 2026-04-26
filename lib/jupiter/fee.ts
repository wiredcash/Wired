import { PublicKey } from "@solana/web3.js";

/**
 * Owner pubkey that receives Jupiter platform fees on every multi-hop
 * route that touches Jupiter. Set via `NEXT_PUBLIC_WIRE_FEE_OWNER` (the
 * pubkey is public on-chain, so NEXT_PUBLIC_ is correct). Returns null
 * if not configured — in that case no fee is sent in the Jupiter call.
 */
export const WIRE_FEE_OWNER: PublicKey | null = (() => {
  const raw = process.env.NEXT_PUBLIC_WIRE_FEE_OWNER?.trim();
  if (!raw) return null;
  try {
    return new PublicKey(raw);
  } catch {
    return null;
  }
})();

/**
 * Fee in basis points (100 = 1%). Capped at 1000 (10%) for safety.
 * Defaults to 0 when unset, which disables the fee path entirely.
 */
export const WIRE_FEE_BPS: number = (() => {
  const raw = process.env.NEXT_PUBLIC_WIRE_FEE_BPS?.trim();
  if (!raw) return 0;
  const n = Number(raw);
  if (!isFinite(n) || n < 0) return 0;
  return Math.min(1000, Math.floor(n));
})();

export function feeEnabled(): boolean {
  return WIRE_FEE_OWNER !== null && WIRE_FEE_BPS > 0;
}
