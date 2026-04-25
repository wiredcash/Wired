"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

export function useTokenBalance(
  owner: PublicKey | null,
  mint: PublicKey,
  refreshKey = 0,
): { quarks: bigint | null; ata: PublicKey | null; loading: boolean } {
  const { connection } = useConnection();
  const [quarks, setQuarks] = useState<bigint | null>(null);
  const [ata, setAta] = useState<PublicKey | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!owner) {
      setQuarks(null);
      setAta(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const tokenAta = getAssociatedTokenAddressSync(mint, owner);
    setAta(tokenAta);
    (async () => {
      try {
        const info = await connection.getAccountInfo(tokenAta);
        if (cancelled) return;
        if (!info) {
          setQuarks(0n);
        } else {
          const bal = await connection.getTokenAccountBalance(tokenAta);
          if (!cancelled) setQuarks(BigInt(bal.value.amount));
        }
      } catch {
        if (!cancelled) setQuarks(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [owner?.toBase58(), mint.toBase58(), connection, refreshKey]);

  return { quarks, ata, loading };
}
