"use client";

import { useMemo, useState } from "react";
import { ComputeBudgetProgram, Transaction } from "@solana/web3.js";
import {
  useConnection,
  useWallet,
} from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  USDC_MINT,
  USDF_MINT,
  MAX_SWAP_DOLLARS,
  planSwap,
} from "@/lib/usdf-swap";
import { fmtQuarks, parseInput } from "./format";
import { usePoolState } from "./usePoolState";
import { useTokenBalance } from "./useTokenBalance";
import { TokenIcon } from "./TokenIcon";

type Direction = "usdf-to-usdc" | "usdc-to-usdf";

export function Bridge() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();
  const [direction, setDirection] = useState<Direction>("usdf-to-usdc");
  const [input, setInput] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "error"; message: string }
    | { kind: "success"; signature: string }
  >({ kind: "idle" });

  const pool = usePoolState(refresh);
  const usdf = useTokenBalance(publicKey, USDF_MINT, refresh);
  const usdc = useTokenBalance(publicKey, USDC_MINT, refresh);

  const usdfToOther = direction === "usdf-to-usdc";
  const sourceLabel = usdfToOther ? "USDF" : "USDC";
  const destLabel = usdfToOther ? "USDC" : "USDF";

  const decimals = pool.data
    ? usdfToOther
      ? pool.data.pool.usdfDecimals
      : pool.data.pool.otherDecimals
    : 6;
  const destDecimals = pool.data
    ? usdfToOther
      ? pool.data.pool.otherDecimals
      : pool.data.pool.usdfDecimals
    : 6;

  const inputQuarks = useMemo(() => parseInput(input, decimals), [input, decimals]);
  const sourceBalance = usdfToOther ? usdf.quarks : usdc.quarks;
  const destVaultBalance = pool.data
    ? usdfToOther
      ? pool.data.otherVaultBalance
      : pool.data.usdfVaultBalance
    : null;

  const expectedOutput = useMemo(() => {
    if (!inputQuarks) return null;
    if (decimals === destDecimals) return inputQuarks;
    if (destDecimals > decimals) {
      return inputQuarks * 10n ** BigInt(destDecimals - decimals);
    }
    return inputQuarks / 10n ** BigInt(decimals - destDecimals);
  }, [inputQuarks, decimals, destDecimals]);

  const maxAmount = useMemo(() => {
    if (!pool.data) return null;
    return BigInt(MAX_SWAP_DOLLARS) * 10n ** BigInt(decimals);
  }, [pool.data, decimals]);

  const validation = useMemo<{ ok: boolean; reason?: string }>(() => {
    if (!connected || !publicKey) return { ok: false, reason: "Connect wallet" };
    if (!pool.data) return { ok: false, reason: "Loading pool…" };
    if (!input) return { ok: false, reason: "Enter an amount" };
    if (inputQuarks === null) return { ok: false, reason: "Invalid amount" };
    if (inputQuarks <= 0n) return { ok: false, reason: "Amount must be > 0" };
    if (sourceBalance !== null && inputQuarks > sourceBalance) {
      return { ok: false, reason: `Insufficient ${sourceLabel}` };
    }
    if (maxAmount !== null && inputQuarks > maxAmount) {
      return { ok: false, reason: `Max $${MAX_SWAP_DOLLARS} per swap` };
    }
    if (
      expectedOutput !== null &&
      destVaultBalance !== null &&
      expectedOutput > destVaultBalance
    ) {
      return {
        ok: false,
        reason: `Pool out of ${destLabel}`,
      };
    }
    return { ok: true };
  }, [
    connected,
    publicKey,
    pool.data,
    input,
    inputQuarks,
    sourceBalance,
    maxAmount,
    expectedOutput,
    destVaultBalance,
    sourceLabel,
    destLabel,
  ]);

  async function handleSwap() {
    if (!publicKey || !pool.data || inputQuarks === null) return;
    setSubmitting(true);
    setStatus({ kind: "idle" });
    try {
      const plan = await planSwap(
        connection,
        pool.data.pool,
        publicKey,
        inputQuarks,
        usdfToOther,
      );
      const tx = new Transaction();
      tx.add(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: 80_000 }),
        ...plan.preInstructions,
        plan.swapIx,
      );
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

  function flip() {
    setDirection((d) => (d === "usdf-to-usdc" ? "usdc-to-usdf" : "usdf-to-usdc"));
    setInput("");
    setStatus({ kind: "idle" });
  }

  return (
    <div className="card p-2.5 shadow-card">
      <div className="flex items-center justify-between px-2.5 pt-1.5 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-spark animate-pulse-soft" />
          <span className="text-[12px] font-medium text-white/65 tracking-wide">
            Bridge
          </span>
          <span className="text-[12px] text-white/35">· 1:1</span>
        </div>
        <WalletMultiButton />
      </div>

      <TokenInput
        side="from"
        symbol={sourceLabel}
        value={input}
        onChange={setInput}
        balance={sourceBalance}
        decimals={decimals}
        onMax={() => {
          if (sourceBalance !== null && maxAmount !== null) {
            const cap = sourceBalance < maxAmount ? sourceBalance : maxAmount;
            setInput(fmtQuarks(cap, decimals, decimals));
          }
        }}
      />

      <FlipButton onClick={flip} />

      <TokenInput
        side="to"
        symbol={destLabel}
        value={
          expectedOutput !== null ? fmtQuarks(expectedOutput, destDecimals) : ""
        }
        balance={usdfToOther ? usdc.quarks : usdf.quarks}
        decimals={destDecimals}
        readOnly
        liquidity={destVaultBalance}
      />

      <button
        type="button"
        onClick={handleSwap}
        disabled={!validation.ok || submitting}
        className="mt-2 w-full h-12 rounded-2xl bg-white text-black disabled:bg-white/[0.05] disabled:text-white/40 disabled:hover:shadow-none hover:shadow-glow font-semibold text-[14px] tracking-tight transition-all duration-200 disabled:cursor-not-allowed"
      >
        {submitting
          ? "Confirming…"
          : validation.ok
            ? `Swap ${sourceLabel} → ${destLabel}`
            : (validation.reason ?? "Swap")}
      </button>

      {status.kind === "success" && (
        <a
          href={`https://solscan.io/tx/${status.signature}`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 mx-1 flex items-center justify-between gap-2 rounded-xl bg-ok/[0.07] border border-ok/20 px-3 py-2.5 text-[12.5px] text-ok hover:bg-ok/[0.12] transition-colors"
        >
          <span className="flex items-center gap-2">
            <Check />
            Swap landed
          </span>
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
    </div>
  );
}

function TokenInput(props: {
  side: "from" | "to";
  symbol: string;
  value: string;
  onChange?: (v: string) => void;
  balance: bigint | null;
  decimals: number;
  readOnly?: boolean;
  onMax?: () => void;
  liquidity?: bigint | null;
}) {
  return (
    <div className="card-inset px-4 py-3.5 mb-1.5">
      <div className="flex items-center justify-between text-[11px] text-white/40 mb-1.5 uppercase tracking-wider">
        <span>{props.side === "from" ? "You pay" : "You receive"}</span>
        <span className="normal-case tracking-normal text-white/45 flex items-center gap-2">
          <span>
            Balance{" "}
            <span className="tabular-nums text-white/65">
              {props.balance === null
                ? "—"
                : fmtQuarks(props.balance, props.decimals)}
            </span>
          </span>
          {props.onMax && props.balance !== null && props.balance > 0n && (
            <button
              type="button"
              onClick={props.onMax}
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
          value={props.value}
          onChange={(e) => props.onChange?.(e.target.value)}
          readOnly={props.readOnly}
          className="swap-input flex-1 min-w-0 bg-transparent outline-none text-[34px] sm:text-[40px] font-semibold tabular-nums tracking-[-0.03em] placeholder:text-white/15"
        />
        <TokenChip symbol={props.symbol} />
      </div>
      {props.liquidity !== undefined && props.liquidity !== null && (
        <p className="mt-2 text-[11px] text-white/35">
          Pool liquidity:{" "}
          <span className="tabular-nums text-white/55">
            {fmtQuarks(props.liquidity, props.decimals)}
          </span>{" "}
          {props.symbol}
        </p>
      )}
    </div>
  );
}

function TokenChip({ symbol }: { symbol: string }) {
  return (
    <div className="shrink-0 flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full bg-white/[0.05] border border-white/[0.08]">
      <TokenIcon symbol={symbol} size={20} />
      <span className="text-[13px] font-semibold tracking-tight">{symbol}</span>
    </div>
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

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path
        d="M5 13l4 4L19 7"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
