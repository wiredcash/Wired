/**
 * Continuous-curve approximation of the on-chain discrete bonding curve.
 *
 * The on-chain program uses a 210k-entry discrete pricing table where the
 * price is constant within each 100-token step. The continuous form (used
 * to derive that table) is:
 *
 *   spot_price(S) = a * b * e^(c * S)
 *
 * where supply S is in *whole tokens* (not quarks) and price is in USD.
 *
 * Constants come from `flipcash-program/api/src/consts.rs` (CURVE_A/B/C).
 * They were chosen so spot(0) = $0.01 and spot(21M) = $1M.
 *
 * The continuous curve is exact up to discretization (≤ 1% error per step,
 * always favoring the pool). UI quotes use this; we then send the on-chain
 * tx with user-set slippage to absorb the discrete-vs-continuous gap.
 */

const A = 11400.230149967394933471;
const B = 0.000000877175273521;
const C = B; // CURVE_C is hard-coded equal to CURVE_B
const K = A; // since A*B/C = A*B/B = A

export const MAX_SUPPLY_TOKENS = 21_000_000;

/** Spot price (USDF per whole token) at the given supply (whole tokens). */
export function spotPrice(supplyTokens: number): number {
  return A * B * Math.exp(C * supplyTokens);
}

/** USDF value to buy `tokens` more, starting from `currentSupply`. */
export function tokensToValue(
  currentSupply: number,
  tokens: number,
): number {
  if (tokens <= 0) return 0;
  return (
    K *
    (Math.exp(C * (currentSupply + tokens)) - Math.exp(C * currentSupply))
  );
}

/** Tokens received for spending `value` USDF, starting from `currentSupply`. */
export function valueToTokens(
  currentSupply: number,
  value: number,
): number {
  if (value <= 0) return 0;
  return Math.log(value / K + Math.exp(C * currentSupply)) / C - currentSupply;
}

export function marketCapUsdf(supplyTokens: number): number {
  // total USDF spent to buy from 0 to supplyTokens
  return tokensToValue(0, supplyTokens);
}
