"use client";

import { useEffect, useRef, useState } from "react";
import { TokenIcon } from "./TokenIcon";

export type InputTokenOption = {
  key: string;
  symbol: string;
  /** "/usdf.png" | "/usdc.png" | inline emoji string for SOL fallback. */
  iconSrc?: string;
};

const SOL_ICON =
  "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png";

const OPTIONS: InputTokenOption[] = [
  { key: "USDF", symbol: "USDF" },
  { key: "USDC", symbol: "USDC" },
  { key: "SOL", symbol: "SOL", iconSrc: SOL_ICON },
];

export function InputTokenChip({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const sel = OPTIONS.find((o) => o.key === selected) ?? OPTIONS[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="shrink-0 flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full bg-white/[0.05] border border-white/[0.08] hover:border-white/20 hover:bg-white/[0.08] transition-colors"
      >
        <TokenIconWrapper option={sel} size={20} />
        <span className="text-[13px] font-semibold tracking-tight">
          {sel.symbol}
        </span>
        <Chevron />
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-30 min-w-[140px] rounded-xl bg-elevated border border-white/[0.08] shadow-2xl py-1">
          {OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => {
                onSelect(opt.key);
                setOpen(false);
              }}
              className={
                "w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-white/[0.06] text-left transition-colors " +
                (opt.key === selected ? "bg-white/[0.04]" : "")
              }
            >
              <TokenIconWrapper option={opt} size={20} />
              <span className="text-[13px] font-semibold tracking-tight">
                {opt.symbol}
              </span>
              {opt.key === selected && (
                <span className="ml-auto text-spark text-[11px]">✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TokenIconWrapper({
  option,
  size,
}: {
  option: InputTokenOption;
  size: number;
}) {
  if (option.iconSrc) {
    // External icon (SOL)
    return (
      <span
        className="inline-flex items-center justify-center rounded-full overflow-hidden ring-1 ring-white/10 bg-black"
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={option.iconSrc}
          alt={option.symbol}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
        />
      </span>
    );
  }
  return <TokenIcon symbol={option.symbol} size={size} />;
}

function Chevron() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      className="opacity-60"
    >
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
