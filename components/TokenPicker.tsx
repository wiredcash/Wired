"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { IndexedCurrency } from "@/lib/flipcash/index-currencies";
import { CurrencyIcon } from "./CurrencyIcon";
import { fmtUsd } from "./format-numbers";
import { QUARKS_PER_TOKEN, USDF_DECIMALS } from "@/lib/flipcash";
import { spotPrice, MAX_SUPPLY_TOKENS } from "@/lib/flipcash";

const USDF_DEC = 10n ** BigInt(USDF_DECIMALS);

export function TokenPicker({
  open,
  onClose,
  onSelect,
  currencies,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (c: IndexedCurrency) => void;
  currencies: IndexedCurrency[] | null;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    requestAnimationFrame(() => inputRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    if (!currencies) return [];
    const q = query.trim().toLowerCase();
    if (!q) return currencies;
    return currencies.filter((c) => {
      return (
        c.symbol.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.mint.toLowerCase().startsWith(q)
      );
    });
  }, [currencies, query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative w-full sm:max-w-md mx-auto sm:my-6 rounded-t-3xl sm:rounded-3xl bg-elevated border border-white/[0.07] shadow-2xl max-h-[85vh] flex flex-col">
        <div className="px-4 pt-4 pb-3 border-b border-white/[0.06]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Select a currency</h3>
            <button
              type="button"
              onClick={onClose}
              className="text-white/40 hover:text-white text-sm"
            >
              ✕
            </button>
          </div>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by ticker, name, or mint…"
            className="w-full h-10 px-3 rounded-xl bg-black/40 border border-white/[0.08] text-[14px] outline-none focus:border-white/25 placeholder:text-white/30"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {!currencies && (
            <div className="px-4 py-8 text-center text-white/40 text-sm">
              Loading currencies…
            </div>
          )}
          {currencies && filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-white/40 text-sm">
              No matches.
            </div>
          )}
          {filtered.map((c) => (
            <CurrencyRow
              key={c.mint}
              currency={c}
              onClick={() => {
                onSelect(c);
                onClose();
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function CurrencyRow({
  currency,
  onClick,
}: {
  currency: IndexedCurrency;
  onClick: () => void;
}) {
  const reserveUsdf =
    currency.reserveUsdfQuarks !== null
      ? Number(BigInt(currency.reserveUsdfQuarks)) / Number(USDF_DEC)
      : null;
  const sold = useMemo(() => {
    if (!currency.reserveTokenQuarks) return 0;
    const remaining =
      Number(BigInt(currency.reserveTokenQuarks)) / Number(QUARKS_PER_TOKEN);
    return Math.max(0, MAX_SUPPLY_TOKENS - remaining);
  }, [currency.reserveTokenQuarks]);
  const price = sold > 0 ? spotPrice(sold) : 0.01;
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.04] active:bg-white/[0.07] transition-colors text-left"
    >
      <CurrencyIcon src={currency.image} symbol={currency.symbol} size={32} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[14px] truncate">
            {currency.symbol}
          </span>
          <span className="text-[12px] text-white/45 truncate">
            {currency.name || currency.metadataName || ""}
          </span>
        </div>
        <div className="text-[11px] text-white/40">
          {fmtUsd(price)} ·{" "}
          {reserveUsdf !== null ? `${fmtUsd(reserveUsdf)} reserve` : "—"}
        </div>
      </div>
    </button>
  );
}
