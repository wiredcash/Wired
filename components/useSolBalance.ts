"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";

/** SOL native balance in lamports (1 SOL = 1e9 lamports). */
export function useSolBalance(
  owner: PublicKey | null,
  refreshKey = 0,
): { lamports: bigint | null; loading: boolean } {
  const { connection } = useConnection();
  const [lamports, setLamports] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!owner) {
      setLamports(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const bal = await connection.getBalance(owner, "confirmed");
        if (!cancelled) setLamports(BigInt(bal));
      } catch {
        if (!cancelled) setLamports(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [owner?.toBase58(), connection, refreshKey]);

  return { lamports, loading };
}
