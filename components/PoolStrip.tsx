"use client";

import { usePoolState } from "./usePoolState";
import { fmtQuarks, shortAddr } from "./format";

export function PoolStrip() {
  const { data, loading } = usePoolState();
  if (!data) {
    return (
      <div className="mt-3 h-12 rounded-2xl bg-white/[0.02] border border-white/[0.05] animate-pulse" />
    );
  }
  const usdfDry = data.usdfVaultBalance === 0n;
  const usdcDry = data.otherVaultBalance === 0n;
  return (
    <div className="mt-3 rounded-2xl bg-white/[0.02] border border-white/[0.06] divide-y divide-white/[0.05]">
      <div className="grid grid-cols-2 divide-x divide-white/[0.05]">
        <Side
          label="USDF liquidity"
          value={fmtQuarks(data.usdfVaultBalance, data.pool.usdfDecimals)}
          dry={usdfDry}
        />
        <Side
          label="USDC liquidity"
          value={fmtQuarks(data.otherVaultBalance, data.pool.otherDecimals)}
          dry={usdcDry}
        />
      </div>
      <a
        href={`https://solscan.io/account/${data.pool.address.toBase58()}`}
        target="_blank"
        rel="noreferrer"
        className="flex items-center justify-between px-4 py-2.5 text-[11px] text-white/40 hover:text-white/70 transition-colors"
      >
        <span>Pool · {data.pool.name}</span>
        <span className="font-mono">
          {shortAddr(data.pool.address.toBase58())} ↗
        </span>
      </a>
    </div>
  );
}

function Side({
  label,
  value,
  dry,
}: {
  label: string;
  value: string;
  dry: boolean;
}) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-white/40">
        <span
          className={
            "inline-block w-1.5 h-1.5 rounded-full " +
            (dry ? "bg-err" : "bg-ok")
          }
        />
        {label}
      </div>
      <div className="mt-1 tabular-nums text-[15px] font-semibold tracking-tight text-white/85">
        {value}
      </div>
    </div>
  );
}
