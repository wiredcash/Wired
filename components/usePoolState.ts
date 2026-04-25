"use client";

import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import {
  FLIPCASH_USDF_USDC_POOL,
  fetchPoolState,
  type PoolState,
} from "@/lib/usdf-swap";

export type PoolWithLiquidity = {
  pool: PoolState;
  usdfVaultBalance: bigint;
  otherVaultBalance: bigint;
};

export function usePoolState(refreshKey = 0): {
  data: PoolWithLiquidity | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const { connection } = useConnection();
  const [data, setData] = useState<PoolWithLiquidity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const pool = await fetchPoolState(connection, FLIPCASH_USDF_USDC_POOL);
        const [usdf, other] = await Promise.all([
          connection.getTokenAccountBalance(pool.usdfVault),
          connection.getTokenAccountBalance(pool.otherVault),
        ]);
        if (cancelled) return;
        setData({
          pool,
          usdfVaultBalance: BigInt(usdf.value.amount),
          otherVaultBalance: BigInt(other.value.amount),
        });
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, tick, refreshKey]);

  return { data, loading, error, refresh: () => setTick((t) => t + 1) };
}
