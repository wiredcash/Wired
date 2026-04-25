import { QUARKS_PER_TOKEN, MAX_TOKEN_SUPPLY, USDF_DECIMALS } from "./constants";
import {
  MAX_SUPPLY_TOKENS,
  marketCapUsdf,
  spotPrice,
  tokensToValue,
  valueToTokens,
} from "./curve";

const USDF_QUARKS_PER_DOLLAR = 10n ** BigInt(USDF_DECIMALS);

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
  const reserveTokensRaw = Number(reserveTokenQuarks) / Number(QUARKS_PER_TOKEN);
  const reserveUsdf = Number(reserveUsdfQuarks) / Number(USDF_QUARKS_PER_DOLLAR);
  const soldTokens = Math.max(0, MAX_SUPPLY_TOKENS - reserveTokensRaw);

  const spot = spotPrice(soldTokens);
  const inUsdf = Number(inUsdfQuarks) / Number(USDF_QUARKS_PER_DOLLAR);
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

export { MAX_TOKEN_SUPPLY, MAX_SUPPLY_TOKENS };
