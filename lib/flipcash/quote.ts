import { QUARKS_PER_TOKEN, MAX_TOKEN_SUPPLY, USDF_DECIMALS } from "./constants";
import {
  MAX_SUPPLY_TOKENS,
  marketCapUsdf,
  spotPrice,
  tokensToValue,
  valueToTokens,
} from "./curve";

const USDF_QUARKS_PER_DOLLAR = 10n ** BigInt(USDF_DECIMALS);

function quarksToTokens(quarks: bigint): number {
  return Number(quarks) / Number(QUARKS_PER_TOKEN);
}

function quarksToUsdf(quarks: bigint): number {
  return Number(quarks) / Number(USDF_QUARKS_PER_DOLLAR);
}

export type CurrencyQuote = {
  /** Tokens already sold (whole token units, may be fractional). */
  soldTokens: number;
  /** Pool's USDF reserve, in whole USDF (display units). */
  reserveUsdf: number;
  /** Spot price at current supply (USDF per token). */
  spotPriceUsdf: number;
  /** Notional total market cap if all sold tokens were valued at spot. */
  marketCapUsdf: number;
  /** Tokens received for `inUsdf` USDF (display units). */
  expectedTokensOut: number;
  /** Effective price (USDF per token) for this purchase. */
  effectivePriceUsdf: number;
  /** Price impact = (effectivePrice / spotPrice - 1). */
  priceImpact: number;
};

export function quoteBuy(
  reserveTokenQuarks: bigint,
  reserveUsdfQuarks: bigint,
  inUsdfQuarks: bigint,
): CurrencyQuote {
  const soldTokens = Math.max(
    0,
    MAX_SUPPLY_TOKENS - quarksToTokens(reserveTokenQuarks),
  );
  const reserveUsdf = quarksToUsdf(reserveUsdfQuarks);

  const spot = spotPrice(soldTokens);
  const inUsdf = quarksToUsdf(inUsdfQuarks);
  const tokensOut = valueToTokens(soldTokens, inUsdf);
  const effectivePrice = tokensOut > 0 ? inUsdf / tokensOut : 0;

  return {
    soldTokens,
    reserveUsdf,
    spotPriceUsdf: spot,
    marketCapUsdf: marketCapUsdf(soldTokens),
    expectedTokensOut: tokensOut,
    effectivePriceUsdf: effectivePrice,
    priceImpact: spot > 0 ? effectivePrice / spot - 1 : 0,
  };
}

export type SellQuote = {
  soldTokens: number;
  reserveUsdf: number;
  spotPriceUsdf: number;
  marketCapUsdf: number;
  /** Net USDF (whole units) the seller receives after the pool's sell fee. */
  expectedUsdfOut: number;
  /** Pre-fee gross USDF, capped at the pool's USDF reserve. */
  grossUsdfOut: number;
  /** Fee paid to the pool (whole USDF units). */
  feeUsdfPaid: number;
  effectivePriceUsdf: number;
  /**
   * Negative impact: how far below spot the effective per-token sell price
   * is (i.e., 0.02 = you got 2% less per token than spot due to curve slope
   * + fee).
   */
  priceImpact: number;
};

/**
 * Mirror of the on-chain `sell` math in `flipcash-program/program/src/instruction/sell.rs`:
 *   gross = ∫spot dS  from (sold − in) to sold
 *   net   = gross · (10000 − sell_fee_bps) / 10000
 * Capped at the pool's actual USDF reserve (excluding accumulated fees).
 */
export function quoteSell(
  reserveTokenQuarks: bigint,
  reserveUsdfQuarks: bigint,
  inTokenQuarks: bigint,
  sellFeeBps: number,
): SellQuote {
  const soldTokens = Math.max(
    0,
    MAX_SUPPLY_TOKENS - quarksToTokens(reserveTokenQuarks),
  );
  const reserveUsdf = quarksToUsdf(reserveUsdfQuarks);
  const inTokens = quarksToTokens(inTokenQuarks);

  const newSupply = Math.max(0, soldTokens - inTokens);
  const grossUncapped =
    tokensToValue(0, soldTokens) - tokensToValue(0, newSupply);
  const grossUsdf = Math.max(0, Math.min(grossUncapped, reserveUsdf));
  const feeRate = Math.max(0, 10_000 - sellFeeBps) / 10_000;
  const netUsdf = grossUsdf * feeRate;
  const feeUsdf = grossUsdf - netUsdf;

  const spot = spotPrice(soldTokens);
  const effectivePrice = inTokens > 0 ? netUsdf / inTokens : 0;
  const impact = spot > 0 ? 1 - effectivePrice / spot : 0;

  return {
    soldTokens,
    reserveUsdf,
    spotPriceUsdf: spot,
    marketCapUsdf: marketCapUsdf(soldTokens),
    expectedUsdfOut: netUsdf,
    grossUsdfOut: grossUsdf,
    feeUsdfPaid: feeUsdf,
    effectivePriceUsdf: effectivePrice,
    priceImpact: impact,
  };
}

/**
 * Apply slippage tolerance to convert the quote into a `min_amount_out` value
 * suitable for the on-chain `BuyTokens` instruction.
 */
export function tokensToMinOutQuarks(
  expectedTokens: number,
  slippageBps: number,
): bigint {
  const factor = Math.max(0, 10_000 - slippageBps) / 10_000;
  const minTokens = expectedTokens * factor;
  // Truncate down so we never set min_out higher than the on-chain rounding.
  const minQuarks = BigInt(Math.floor(minTokens * Number(QUARKS_PER_TOKEN)));
  return minQuarks < 0n ? 0n : minQuarks;
}

/** Slippage-protected `min_amount_out` for a sell, in USDF quarks. */
export function usdfToMinOutQuarks(
  expectedUsdf: number,
  slippageBps: number,
): bigint {
  const factor = Math.max(0, 10_000 - slippageBps) / 10_000;
  const minUsdf = expectedUsdf * factor;
  const minQuarks = BigInt(
    Math.floor(minUsdf * Number(USDF_QUARKS_PER_DOLLAR)),
  );
  return minQuarks < 0n ? 0n : minQuarks;
}

export { MAX_TOKEN_SUPPLY, MAX_SUPPLY_TOKENS };
