"use client";

import { useEffect } from "react";

export type SwapLeg = {
  amount: string;
  symbol: string;
  /**
   * Optional icon URL. USDF/USDC/SOL get baked-in defaults; pass for
   * currencies (`selected.image`).
   */
  iconSrc?: string | null;
};

export type SwapSummary = {
  direction: "buy" | "sell";
  paid: SwapLeg;
  received: SwapLeg;
  signatures: string[];
};

export function SwapSuccessModal({
  summary,
  onClose,
}: {
  summary: SwapSummary | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!summary) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [summary, onClose]);

  if (!summary) return null;
  const multi = summary.signatures.length > 1;
  const lastSig = summary.signatures[summary.signatures.length - 1];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0 animate-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/75 backdrop-blur-md" />

      <div className="relative w-full sm:max-w-[420px] rounded-3xl bg-elevated border border-white/[0.07] shadow-2xl overflow-hidden animate-modal">
        {/* Top accent gradient */}
        <div
          aria-hidden
          className="absolute -top-32 left-1/2 -translate-x-1/2 w-[120%] h-64 pointer-events-none"
          style={{
            background:
              "radial-gradient(50% 60% at 50% 0%, rgba(125,255,183,0.10) 0%, rgba(0,0,0,0) 70%)",
          }}
        />

        {/* Close */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/[0.06] hover:bg-white/[0.12] flex items-center justify-center text-white/55 hover:text-white transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path
              d="M6 6l12 12M18 6l-12 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>

        {/* Header */}
        <div className="px-6 pt-7 pb-5 relative">
          <div className="w-12 h-12 rounded-full bg-ok/[0.10] border border-ok/30 flex items-center justify-center mb-3">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M5 13l4 4L19 7"
                stroke="#7DFFB7"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="text-[20px] font-semibold tracking-tight">
            Swap complete
          </div>
          <div className="text-[12px] text-white/45 mt-0.5">
            {summary.direction === "buy" ? "Bought" : "Sold"}{" "}
            {summary.direction === "buy"
              ? summary.received.symbol
              : summary.paid.symbol}
            {multi ? ` · ${summary.signatures.length} transactions` : ""}
          </div>
        </div>

        {/* Flow */}
        <div className="px-5 pb-3 relative space-y-1.5">
          <Leg label="Paid" leg={summary.paid} />
          <FlowArrow />
          <Leg label="Received" leg={summary.received} highlight />
        </div>

        {/* Tx links */}
        <div className="px-5 pt-4 pb-5 relative">
          <div className="text-[10.5px] uppercase tracking-[0.16em] text-white/35 mb-2">
            {multi ? "Transactions" : "Transaction"}
          </div>
          <div className="space-y-1">
            {summary.signatures.map((sig, i) => (
              <a
                key={sig}
                href={`https://solscan.io/tx/${sig}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.05] hover:bg-white/[0.06] hover:border-white/[0.12] transition-colors group"
              >
                <span className="font-mono text-[11.5px] text-white/65 group-hover:text-white">
                  {multi && (
                    <span className="text-white/35 mr-2">{i + 1}.</span>
                  )}
                  {sig.slice(0, 8)}…{sig.slice(-8)}
                </span>
                <span className="text-[11px] text-white/40 group-hover:text-white/80 flex items-center gap-1">
                  Solscan
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    className="opacity-70"
                  >
                    <path
                      d="M7 17L17 7M9 7h8v8"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </a>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="px-5 pb-5 relative">
          <button
            type="button"
            onClick={onClose}
            className="w-full h-11 rounded-2xl bg-white text-black hover:bg-white/85 font-semibold text-[14px] tracking-tight transition-colors"
          >
            Done
          </button>
          <a
            href={`https://solscan.io/tx/${lastSig}`}
            target="_blank"
            rel="noreferrer"
            className="block mt-2 text-center text-[12px] text-white/40 hover:text-white/65 transition-colors"
          >
            Open last tx in Solscan ↗
          </a>
        </div>
      </div>
    </div>
  );
}

function Leg({
  label,
  leg,
  highlight,
}: {
  label: string;
  leg: SwapLeg;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        "flex items-center gap-3 px-3.5 py-3 rounded-2xl border " +
        (highlight
          ? "bg-ok/[0.04] border-ok/15"
          : "bg-white/[0.02] border-white/[0.05]")
      }
    >
      <LegIcon symbol={leg.symbol} src={leg.iconSrc ?? null} />
      <div className="flex-1 min-w-0">
        <div className="text-[10.5px] uppercase tracking-[0.16em] text-white/40">
          {label}
        </div>
        <div className="flex items-baseline gap-1.5 mt-0.5">
          <span
            className={
              "text-[22px] font-semibold tabular-nums tracking-tight " +
              (highlight ? "text-ok" : "text-white/85")
            }
          >
            {leg.amount}
          </span>
          <span className="text-[13px] font-semibold text-white/55">
            {leg.symbol}
          </span>
        </div>
      </div>
    </div>
  );
}

function FlowArrow() {
  return (
    <div className="flex justify-center">
      <div className="w-7 h-7 -my-1 rounded-full bg-elevated border border-white/[0.08] flex items-center justify-center text-white/45 z-10 relative">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 5v14m0 0l-6-6m6 6l6-6"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

const SOL_ICON_URL =
  "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png";

function LegIcon({ symbol, src }: { symbol: string; src: string | null }) {
  let resolved = src;
  if (!resolved) {
    if (symbol === "USDF") resolved = "/usdf.png";
    else if (symbol === "USDC") resolved = "/usdc.png";
    else if (symbol === "SOL") resolved = SOL_ICON_URL;
  }
  return (
    <span
      className="inline-flex items-center justify-center rounded-full overflow-hidden ring-1 ring-white/10 bg-black shrink-0"
      style={{ width: 36, height: 36 }}
    >
      {resolved ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={resolved}
          alt={symbol}
          width={36}
          height={36}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
        />
      ) : (
        <span className="font-bold text-white/70 text-[14px]">
          {(symbol[0] ?? "?").toUpperCase()}
        </span>
      )}
    </span>
  );
}
