"use client";

import { useEffect, useState } from "react";
import type { IndexedCurrency } from "@/lib/flipcash/index-currencies";

export function useCurrencies(refreshKey = 0): {
  data: IndexedCurrency[] | null;
  loading: boolean;
  error: string | null;
} {
  const [data, setData] = useState<IndexedCurrency[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const r = await fetch("/api/currencies", { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as { items: IndexedCurrency[] };
        if (!cancelled) setData(json.items);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return { data, loading, error };
}
