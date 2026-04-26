"use client";

import { useEffect, useMemo, useState } from "react";
import { ComputeBudgetProgram, PublicKey, Transaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  TOKEN_DECIMALS,
  USDF_BASE_MINT,
  USDF_DECIMALS,
  planBuy,
  planSell,
  quoteBuy,
  quoteSell,
  tokensToMinOutQuarks,
  usdfToMinOutQuarks,
} from "@/lib/flipcash";
import type { IndexedCurrency } from "@/lib/flipcash/index-currencies";
import { fmtQuarks, parseInput } from "./format";
import { fmtCompactNumber, fmtPct, fmtUsd } from "./format-numbers";
import { useTokenBalance } from "./useTokenBalance";
import { useCurrencies } from "./useCurrencies";
import { TokenPicker } from "./TokenPicker";
import { CurrencyIcon } from "./CurrencyIcon";
import { TokenIcon } from "./TokenIcon";

type Direction = "buy" | "sell";

const SLIPPAGE_OPTIONS_BPS = [50, 100, 300]; // 0.5% / 1% / 3%

export function Swap() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();
  const [refresh, setRefresh] = useState(0);
  const currencies = useCurrencies(refresh);
  const [selected, setSelected] = useState<IndexedCurrency | null>(null);
  const [direction, setDirection] = useState<Direction>("buy");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [input, setInput] = useState("");
  const [slippageBps, setSlippageBps] = useState<number>(100);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "error"; message: string }
    | { kind: "success"; signature: string }
  >({ kind: "idle" });

  const isBuy = direction === "buy";

  const usdf = useTokenBalance(publicKey, USDF_BASE_MINT, refresh);
  const targetMint = useMemo(
    () => (selected ? new PublicKey(selected.mint) : null),
    [selected],
  );
  const target = useTokenBalance(publicKey, targetMint ?? USDF_BASE_MINT, refresh);
  // useTokenBalance always needs a mint; reuse USDF as a stable placeholder
  // when no currency is selected yet — its result is unused in that branch.
  const targetQuarks = targetMint ? target.quarks : null;

  // Auto-pick the most-liquid currency on first load.
  useEffect(() => {
    if (!selected && currencies.data?.length) {
      const firstWithPool = currencies.data.find((c) => c.pool);
      if (firstWithPool) setSelected(firstWithPool);
    }
  }, [currencies.data, selected]);

  const sourceDecimals = isBuy ? USDF_DECIMALS : TOKEN_DECIMALS;
  const destDecimals = isBuy ? TOKEN_DECIMALS : USDF_DECIMALS;
  const sourceBalance = isBuy ? usdf.quarks : targetQuarks;
  const destBalance = isBuy ? targetQuarks : usdf.quarks;

  const inputQuarks = useMemo(
    () => parseInput(input, sourceDecimals),
    [input, sourceDecimals],
  );

  const buyQuote = useMemo(() => {
    if (
      !isBuy ||
      !selected?.reserveTokenQuarks ||
      !selected?.reserveUsdfQuarks ||
      inputQuarks === null ||
      inputQuarks <= 0n
    )
      return null;
    return quoteBuy(
      BigInt(selected.reserveTokenQuarks),
      BigInt(selected.reserveUsdfQuarks),
      inputQuarks,
    );
  }, [isBuy, selected, inputQuarks]);

  const sellQuote = useMemo(() => {
    if (
      isBuy ||
      !selected?.reserveTokenQuarks ||
      !selected?.reserveUsdfQuarks ||
      selected?.sellFeeBps === null ||
      inputQuarks === null ||
      inputQuarks <= 0n
    )
      return null;
    return quoteSell(
      BigInt(selected!.reserveTokenQuarks!),
      BigInt(selected!.reserveUsdfQuarks!),
      inputQuarks,
      selected!.sellFeeBps ?? 100,
    );
  }, [isBuy, selected, inputQuarks]);

  const expectedOutDisplay = isBuy
    ? buyQuote
      ? fmtCompactNumber(buyQuote.expectedTokensOut)
      : "0"
    : sellQuote
      ? fmtCompactNumber(sellQuote.expectedUsdfOut)
      : "0";

  const priceLabel = useMemo(() => {
    if (!selected) return "—";
    if (isBuy) {
      return buyQuote
        ? `≈ ${fmtUsd(buyQuote.effectivePriceUsdf)} / ${selected.symbol}`
        : "spot price";
    }
    return sellQuote
      ? `≈ ${fmtUsd(sellQuote.effectivePriceUsdf)} / ${selected.symbol}`
      : "spot price";
  }, [isBuy, selected, buyQuote, sellQuote]);

  const validation = useMemo<{ ok: boolean; reason?: string }>(() => {
    if (!connected || !publicKey)
      return { ok: false, reason: "Connect wallet" };
    if (!selected) return { ok: false, reason: "Select a currency" };
    if (!selected.pool || !selected.vaultA || !selected.vaultB)
      return { ok: false, reason: "Currency has no pool" };
    if (!input)
      return {
        ok: false,
        reason: isBuy ? "Enter a USDF amount" : `Enter ${selected.symbol} amount`,
      };
    if (inputQuarks === null) return { ok: false, reason: "Invalid amount" };
    if (inputQuarks <= 0n) return { ok: false, reason: "Amount must be > 0" };
    if (sourceBalance !== null && inputQuarks > sourceBalance) {
      return {
        ok: false,
        reason: `Insufficient ${isBuy ? "USDF" : selected.symbol}`,
      };
    }
    if (!isBuy) {
      // Selling needs the pool to have at least the gross USDF available.
      if (!sellQuote) return { ok: false, reason: "Computing quote…" };
      if (sellQuote.expectedUsdfOut <= 0)
        return { ok: false, reason: "Pool has no USDF reserve" };
    }
    return { ok: true };
  }, [
    connected,
    publicKey,
    selected,
    input,
    inputQuarks,
    sourceBalance,
    sellQuote,
    isBuy,
  ]);

  function flip() {
    setDirection((d) => (d === "buy" ? "sell" : "buy"));
    setInput("");
    setStatus({ kind: "idle" });
  }

  function refreshBalances() {
    if (refreshing) return;
    setRefreshing(true);
    setRefresh((r) => r + 1);
    // Match the spin animation length so the button feels responsive even
    // when the RPC roundtrip is faster than 700ms.
    window.setTimeout(() => setRefreshing(false), 700);
  }

  function setMax() {
    if (sourceBalance === null || sourceBalance <= 0n) return;
    setInput(fmtQuarks(sourceBalance, sourceDecimals, sourceDecimals));
  }

  async function handleSubmit() {
    if (
      !publicKey ||
      !selected ||
      !selected.pool ||
      !selected.vaultA ||
      !selected.vaultB ||
      inputQuarks === null
    )
      return;
    setSubmitting(true);
    setStatus({ kind: "idle" });
    try {
      const tx = new Transaction();
      tx.add(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
      );

      if (isBuy) {
        if (!buyQuote) throw new Error("missing buy quote");
        const minOut = tokensToMinOutQuarks(
          buyQuote.expectedTokensOut,
          slippageBps,
        );
        const plan = await planBuy(connection, {
          buyer: publicKey,
          pool: new PublicKey(selected.pool),
          targetMint: new PublicKey(selected.mint),
          vaultA: new PublicKey(selected.vaultA),
          vaultB: new PublicKey(selected.vaultB),
          inAmountUsdfQuarks: inputQuarks,
          minAmountOutQuarks: minOut,
        });
        tx.add(...plan.preInstructions, plan.buyIx);
      } else {
        if (!sellQuote) throw new Error("missing sell quote");
        const minOut = usdfToMinOutQuarks(
          sellQuote.expectedUsdfOut,
          slippageBps,
        );
        const plan = await planSell(connection, {
          seller: publicKey,
          pool: new PublicKey(selected.pool),
          targetMint: new PublicKey(selected.mint),
          vaultA: new PublicKey(selected.vaultA),
          vaultB: new PublicKey(selected.vaultB),
          inAmountTokenQuarks: inputQuarks,
          minAmountOutUsdfQuarks: minOut,
        });
        tx.add(...plan.preInstructions, plan.sellIx);
      }

      const sig = await sendTransaction(tx, connection);
      const latest = await connection.getLatestBlockhash();
      await connection.confirmTransaction(
        { signature: sig, ...latest },
        "confirmed",
      );
      setStatus({ kind: "success", signature: sig });
      setInput("");
      setRefresh((r) => r + 1);
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  const sourceTokenChip = isBuy ? (
    <UsdfChip />
  ) : (
    <CurrencyChip selected={selected} onClick={() => setPickerOpen(true)} />
  );
  const destTokenChip = isBuy ? (
    <CurrencyChip selected={selected} onClick={() => setPickerOpen(true)} />
  ) : (
    <UsdfChip />
  );

  const activeQuote = isBuy ? buyQuote : sellQuote;
  const sellFeeBps = selected?.sellFeeBps ?? null;

  return (
    <div className="card p-2.5 shadow-card">
      <div className="flex items-center justify-between px-2.5 pt-1.5 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-spark animate-pulse-soft" />
          <span className="text-[12px] font-medium text-white/65 tracking-wide">
            Swap
          </span>
          <span className="text-[12px] text-white/35">
            {isBuy ? "· buy" : "· sell"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <RefreshButton spinning={refreshing} onClick={refreshBalances} />
          <WalletMultiButton />
        </div>
      </div>

      {/* You pay */}
      <div className="card-inset px-4 py-3.5 mb-1.5">
        <div className="flex items-center justify-between text-[11px] text-white/40 mb-1.5 uppercase tracking-wider">
          <span>You pay</span>
          <span className="normal-case tracking-normal text-white/45 flex items-center gap-2">
            <span>
              Balance{" "}
              <span className="tabular-nums text-white/65">
                {sourceBalance === null
                  ? "—"
                  : fmtQuarks(sourceBalance, sourceDecimals)}
              </span>
            </span>
            {sourceBalance !== null && sourceBalance > 0n && (
              <button
                type="button"
                onClick={setMax}
                className="px-1.5 py-0.5 rounded-md text-[10.5px] font-semibold text-spark hover:bg-spark/10 transition-colors"
              >
                MAX
              </button>
            )}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <input
            inputMode="decimal"
            placeholder="0"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="swap-input flex-1 min-w-0 bg-transparent outline-none text-[34px] sm:text-[40px] font-semibold tabular-nums tracking-[-0.03em] placeholder:text-white/15"
          />
          {sourceTokenChip}
        </div>
      </div>

      <FlipButton onClick={flip} />

      {/* You receive */}
      <div className="card-inset px-4 py-3.5">
        <div className="flex items-center justify-between text-[11px] text-white/40 mb-1.5 uppercase tracking-wider">
          <span>You receive</span>
          <span className="normal-case tracking-normal text-white/40">
            {priceLabel}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0 text-[34px] sm:text-[40px] font-semibold tabular-nums tracking-[-0.03em] text-white/85">
            {expectedOutDisplay}
          </div>
          {destTokenChip}
        </div>

        {selected && activeQuote && (
          <div className="mt-3 flex items-center justify-between text-[11px] text-white/45">
            <span>
              Impact{" "}
              <span
                className={
                  activeQuote.priceImpact > 0.05
                    ? "text-err"
                    : activeQuote.priceImpact > 0.01
                      ? "text-spark"
                      : "text-white/65"
                }
              >
                {fmtPct(activeQuote.priceImpact, 2)}
              </span>
            </span>
            <span className="tabular-nums">
              {isBuy
                ? `Mcap ${fmtUsd(activeQuote.marketCapUsdf)}`
                : `Fee ${
                    sellFeeBps !== null ? (sellFeeBps / 100).toFixed(2) : "1.00"
                  }%`}
            </span>
          </div>
        )}
      </div>

      {/* Slippage */}
      <div className="flex items-center justify-between px-1 pt-3 pb-1 text-[11px]">
        <span className="text-white/40 uppercase tracking-wider">
          Slippage
        </span>
        <div className="flex gap-1">
          {SLIPPAGE_OPTIONS_BPS.map((bps) => (
            <button
              key={bps}
              type="button"
              onClick={() => setSlippageBps(bps)}
              className={
                "px-2 py-1 rounded-md font-medium transition-colors " +
                (slippageBps === bps
                  ? "bg-white text-black"
                  : "text-white/55 hover:bg-white/[0.06]")
              }
            >
              {bps / 100}%
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!validation.ok || submitting}
        className="mt-2 w-full h-12 rounded-2xl bg-white text-black disabled:bg-white/[0.05] disabled:text-white/40 disabled:hover:shadow-none hover:shadow-glow font-semibold text-[14px] tracking-tight transition-all duration-200 disabled:cursor-not-allowed"
      >
        {submitting
          ? "Confirming…"
          : validation.ok
            ? `${isBuy ? "Buy" : "Sell"} ${selected?.symbol ?? ""}`
            : (validation.reason ?? (isBuy ? "Buy" : "Sell"))}
      </button>

      {status.kind === "success" && (
        <a
          href={`https://solscan.io/tx/${status.signature}`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 mx-1 flex items-center justify-between gap-2 rounded-xl bg-ok/[0.07] border border-ok/20 px-3 py-2.5 text-[12.5px] text-ok hover:bg-ok/[0.12] transition-colors"
        >
          <span>✅ {isBuy ? "Buy" : "Sell"} landed</span>
          <span className="font-mono text-[11px] truncate max-w-[160px] opacity-80">
            {status.signature.slice(0, 10)}…
          </span>
        </a>
      )}
      {status.kind === "error" && (
        <p className="mt-3 mx-1 text-[12.5px] text-err break-words rounded-xl bg-err/[0.07] border border-err/20 px-3 py-2.5">
          {status.message}
        </p>
      )}

      <TokenPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(c) => setSelected(c)}
        currencies={currencies.data}
      />
    </div>
  );
}

function CurrencyChip({
  selected,
  onClick,
}: {
  selected: IndexedCurrency | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full bg-white/[0.05] border border-white/[0.08] hover:border-white/20 hover:bg-white/[0.08] transition-colors"
    >
      {selected ? (
        <>
          <CurrencyIcon
            src={selected.image}
            symbol={selected.symbol}
            size={22}
          />
          <span className="text-[13px] font-semibold tracking-tight max-w-[80px] truncate">
            {selected.symbol}
          </span>
          <Chevron />
        </>
      ) : (
        <>
          <span className="text-[13px] font-semibold tracking-tight pl-2">
            Select
          </span>
          <Chevron />
        </>
      )}
    </button>
  );
}

function UsdfChip() {
  return (
    <div className="shrink-0 flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full bg-white/[0.05] border border-white/[0.08]">
      <TokenIcon symbol="USDF" size={20} />
      <span className="text-[13px] font-semibold tracking-tight">USDF</span>
    </div>
  );
}

function RefreshButton({
  spinning,
  onClick,
}: {
  spinning: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={spinning}
      aria-label="Refresh balances"
      className="w-9 h-9 rounded-full bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-white/55 hover:text-white hover:bg-white/[0.08] hover:border-white/20 transition-colors disabled:cursor-default"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        className={spinning ? "animate-spin" : ""}
      >
        <path
          d="M3 12a9 9 0 0 1 15.5-6.3L21 8M21 4v4h-4M21 12a9 9 0 0 1-15.5 6.3L3 16M3 20v-4h4"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function FlipButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex justify-center -my-2.5 relative z-10 pointer-events-none">
      <button
        type="button"
        onClick={onClick}
        className="pointer-events-auto w-9 h-9 rounded-full bg-elevated border border-white/[0.10] flex items-center justify-center hover:bg-white/[0.08] hover:border-white/20 hover:rotate-180 transition-all duration-300 shadow-card"
        aria-label="flip direction"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
          <path
            d="M7 4v12m0 0l-4-4m4 4l4-4M17 20V8m0 0l-4 4m4-4l4 4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
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
