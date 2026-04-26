"use client";

import { useEffect, useState } from "react";
import { getJupiterQuote, type JupiterQuote } from "@/lib/jupiter";

export type LiveJupiterQuote = {
  quote: JupiterQuote | null;
  loading: boolean;
  error: string | null;
};

/**
 * Debounced Jupiter quote. Fires ~400ms after the last input change so the
 * "you receive" amount feels live without spamming the proxy. Returns null
 * when disabled or amount is 0.
 */
export function useJupiterQuote(
  enabled: boolean,
  inputMint: string,
  outputMint: string,
  amountQuarks: bigint | null,
  slippageBps: number,
): LiveJupiterQuote {
  const [quote, setQuote] = useState<JupiterQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amountKey = amountQuarks?.toString() ?? "";

  useEffect(() => {
    if (!enabled || !amountQuarks || amountQuarks <= 0n) {
      setQuote(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const t = window.setTimeout(async () => {
      try {
        const q = await getJupiterQuote({
          inputMint,
          outputMint,
          amount: amountQuarks.toString(),
          slippageBps,
          restrictIntermediateTokens: true,
        });
        if (!cancelled) setQuote(q);
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setQuote(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [enabled, inputMint, outputMint, amountKey, slippageBps]);

  return { quote, loading, error };
}
