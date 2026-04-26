"use client";

import { useEffect, useMemo, useState } from "react";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  TOKEN_DECIMALS,
  USDF_BASE_MINT,
  USDF_DECIMALS,
  quoteBuy,
  quoteSell,
} from "@/lib/flipcash";
import { USDC_MINT, USDF_MINT } from "@/lib/usdf-swap";
import { SOL_MINT } from "@/lib/jupiter";
import {
  planMultiHopBuy,
  planMultiHopSell,
  type SignableStep,
} from "@/lib/multi-hop";
import { confirmSignaturePolling } from "@/lib/confirm";
import type { IndexedCurrency } from "@/lib/flipcash/index-currencies";
import { fmtQuarks, parseInput } from "./format";
import { fmtCompactNumber, fmtPct, fmtUsd } from "./format-numbers";
import { useTokenBalance } from "./useTokenBalance";
import { useSolBalance } from "./useSolBalance";
import { useCurrencies } from "./useCurrencies";
import { useJupiterQuote } from "./useJupiterQuote";
import { usePoolState } from "./usePoolState";
import { TokenPicker } from "./TokenPicker";
import { CurrencyIcon } from "./CurrencyIcon";
import { TokenIcon } from "./TokenIcon";
import { InputTokenChip } from "./InputTokenChip";
import { SwapSuccessModal, type SwapSummary } from "./SwapSuccessModal";
import { RouteSummary } from "./RouteSummary";
import type { Provider, RouteStep } from "@/lib/multi-hop";
import { jupiterDexLabel } from "@/lib/jupiter";

/** Mirrors lib/multi-hop's JUPITER_MAX_ACCOUNTS_DIRECT — kept in sync so
 *  the live UI quote and the eventual planner pick the same routes. */
const LIVE_DIRECT_MAX_ACCOUNTS = 48;
/** Mirrors JUPITER_MAX_ACCOUNTS_CURVE_LEG. */
const LIVE_CURVE_LEG_MAX_ACCOUNTS = 28;

type Direction = "buy" | "sell";
type SideTokenKey = "USDF" | "USDC" | "SOL";

const SLIPPAGE_OPTIONS_BPS = [50, 100, 300]; // 0.5% / 1% / 3%

const SIDE_TOKEN: Record<
  SideTokenKey,
  { mint: PublicKey; decimals: number; symbol: string }
> = {
  USDF: { mint: USDF_MINT, decimals: USDF_DECIMALS, symbol: "USDF" },
  USDC: { mint: USDC_MINT, decimals: USDF_DECIMALS, symbol: "USDC" },
  SOL: { mint: SOL_MINT, decimals: 9, symbol: "SOL" },
};

export function Swap() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();

  const [refresh, setRefresh] = useState(0);
  const currencies = useCurrencies(refresh);
  const [selected, setSelected] = useState<IndexedCurrency | null>(null);

  const [direction, setDirection] = useState<Direction>("buy");
  // Source token in buy mode; receive token in sell mode. Defaults to USDF
  // (single-hop) on both sides.
  const [inputToken, setInputToken] = useState<SideTokenKey>("USDF");
  const [outputToken, setOutputToken] = useState<SideTokenKey>("USDF");

  const [pickerOpen, setPickerOpen] = useState(false);
  const [input, setInput] = useState("");
  const [slippageBps, setSlippageBps] = useState<number>(100);
  const [submitting, setSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState<string>("");
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "error"; message: string }
    | { kind: "success"; signature: string; allSigs: string[] }
  >({ kind: "idle" });
  const [successSummary, setSuccessSummary] = useState<SwapSummary | null>(
    null,
  );

  const isBuy = direction === "buy";
  const sideToken = isBuy ? inputToken : outputToken;
  const sideInfo = SIDE_TOKEN[sideToken];

  // ─── Wallet balances ────────────────────────────────────────────────
  const usdf = useTokenBalance(publicKey, USDF_BASE_MINT, refresh);
  const usdc = useTokenBalance(publicKey, USDC_MINT, refresh);
  const sol = useSolBalance(publicKey, refresh);
  const bridge = usePoolState(refresh);
  const targetMint = useMemo(
    () => (selected ? new PublicKey(selected.mint) : null),
    [selected],
  );
  const target = useTokenBalance(
    publicKey,
    targetMint ?? USDF_BASE_MINT,
    refresh,
  );
  const targetQuarks = targetMint ? target.quarks : null;

  function balanceFor(key: SideTokenKey): bigint | null {
    if (key === "USDF") return usdf.quarks;
    if (key === "USDC") return usdc.quarks;
    return sol.lamports;
  }

  useEffect(() => {
    if (!selected && currencies.data?.length) {
      const firstWithPool = currencies.data.find((c) => c.pool);
      if (firstWithPool) setSelected(firstWithPool);
    }
  }, [currencies.data, selected]);

  const sourceDecimals = isBuy ? sideInfo.decimals : TOKEN_DECIMALS;
  const destDecimals = isBuy ? TOKEN_DECIMALS : sideInfo.decimals;
  const sourceBalance = isBuy ? balanceFor(inputToken) : targetQuarks;
  const sourceSymbol = isBuy ? inputToken : (selected?.symbol ?? "");

  const inputQuarks = useMemo(
    () => parseInput(input, sourceDecimals),
    [input, sourceDecimals],
  );

  // ─── Live Jupiter quotes ────────────────────────────────────────────
  // Two quotes per direction so the aggregator can compare paths live.
  // Buy mode:
  //   • buyJup     = input → USDC  (used by the curve path's first leg)
  //   • directBuy  = input → target (the direct-Jupiter alternative)
  const buyJupiterEnabled = isBuy && inputToken === "SOL";
  const buyJup = useJupiterQuote(
    buyJupiterEnabled,
    sideInfo.mint.toBase58(),
    USDC_MINT.toBase58(),
    inputQuarks,
    slippageBps,
    LIVE_CURVE_LEG_MAX_ACCOUNTS,
  );
  const directBuyEnabled =
    isBuy && !!selected && inputToken !== "USDF"; // USDF→target rarely on Jupiter
  const directBuy = useJupiterQuote(
    directBuyEnabled,
    sideInfo.mint.toBase58(),
    selected?.mint ?? "",
    inputQuarks,
    slippageBps,
    LIVE_DIRECT_MAX_ACCOUNTS,
  );

  // For sell side, Jupiter input is USDC = worst-case USDF after sell.
  // We compute it from the sell quote first, then debounce a Jupiter quote
  // sized at that USDC amount.
  const sellQuoteRaw = useMemo(() => {
    if (
      isBuy ||
      !selected?.reserveTokenQuarks ||
      !selected?.reserveUsdfQuarks ||
      inputQuarks === null ||
      inputQuarks <= 0n
    )
      return null;
    return quoteSell(
      BigInt(selected.reserveTokenQuarks),
      BigInt(selected.reserveUsdfQuarks),
      inputQuarks,
      selected.sellFeeBps ?? 100,
    );
  }, [isBuy, selected, inputQuarks]);

  // Worst-case USDF (= USDC) we'd hand to Jupiter on sell side.
  const sellUsdfWorstQuarks = useMemo(() => {
    if (!sellQuoteRaw) return null;
    const factor = (10_000 - slippageBps) / 10_000;
    const minUsdf = sellQuoteRaw.expectedUsdfOut * factor;
    return BigInt(Math.max(0, Math.floor(minUsdf * 10 ** USDF_DECIMALS)));
  }, [sellQuoteRaw, slippageBps]);

  const sellJupiterEnabled = !isBuy && outputToken === "SOL";
  const sellJup = useJupiterQuote(
    sellJupiterEnabled,
    USDC_MINT.toBase58(),
    sideInfo.mint.toBase58(),
    sellUsdfWorstQuarks,
    slippageBps,
    LIVE_CURVE_LEG_MAX_ACCOUNTS,
  );
  // Direct sell: source token (currency) → user's chosen output. Skip when
  // output is the same as source (no-op) or the currency is unselected.
  const directSellEnabled = !isBuy && !!selected;
  const directSell = useJupiterQuote(
    directSellEnabled,
    selected?.mint ?? "",
    sideInfo.mint.toBase58(),
    inputQuarks,
    slippageBps,
    LIVE_DIRECT_MAX_ACCOUNTS,
  );

  // ─── Display quote ──────────────────────────────────────────────────
  const buyQuote = useMemo(() => {
    if (
      !isBuy ||
      !selected?.reserveTokenQuarks ||
      !selected?.reserveUsdfQuarks ||
      inputQuarks === null ||
      inputQuarks <= 0n
    )
      return null;
    let usdfApprox: bigint;
    if (inputToken === "SOL") {
      if (!buyJup.quote) return null;
      usdfApprox = BigInt(buyJup.quote.outAmount);
    } else {
      // USDF and USDC are 1:1 at 6 decimals.
      usdfApprox = inputQuarks;
    }
    return quoteBuy(
      BigInt(selected.reserveTokenQuarks),
      BigInt(selected.reserveUsdfQuarks),
      usdfApprox,
    );
  }, [isBuy, selected, inputQuarks, inputToken, buyJup.quote]);

  // Sell-side display amount (in the user's chosen output mint's units).
  const sellDisplayAmount = useMemo<{
    formatted: string;
    decimals: number;
  } | null>(() => {
    if (isBuy) return null;
    if (!sellQuoteRaw) return null;
    if (outputToken === "USDF") {
      return {
        formatted: fmtCompactNumber(sellQuoteRaw.expectedUsdfOut),
        decimals: USDF_DECIMALS,
      };
    }
    if (outputToken === "USDC") {
      return {
        formatted: fmtCompactNumber(sellQuoteRaw.expectedUsdfOut),
        decimals: USDF_DECIMALS,
      };
    }
    // SOL — wait for Jupiter
    if (!sellJup.quote) return null;
    const outQuarks = Number(sellJup.quote.outAmount);
    return {
      formatted: fmtCompactNumber(outQuarks / 10 ** sideInfo.decimals),
      decimals: sideInfo.decimals,
    };
  }, [isBuy, sellQuoteRaw, outputToken, sellJup.quote, sideInfo.decimals]);

  // ─── Aggregated route — pick whichever path delivers more output ────
  // Mirrors lib/multi-hop's planMultiHopBuy/Sell logic so the live UI
  // matches what the planner ultimately submits.
  type Aggregated = {
    provider: Provider;
    expectedOut: number; // display units
    steps: RouteStep[];
    alt: { providerLabel: string; deltaPct: number } | null;
  };

  const aggregatedBuy = useMemo<Aggregated | null>(() => {
    if (!isBuy || !selected || !buyQuote) return null;
    const curveOut = buyQuote.expectedTokensOut;
    const directOut = directBuy.quote
      ? Number(directBuy.quote.outAmount) / 10 ** TOKEN_DECIMALS
      : null;

    // Build the curve route's steps based on inputToken.
    const curveSteps: RouteStep[] = [];
    if (inputToken === "USDF") {
      curveSteps.push({
        from: "USDF",
        to: selected.symbol,
        via: "Flipcash curve",
      });
    } else if (inputToken === "USDC") {
      curveSteps.push({
        from: "USDC",
        to: "USDF",
        via: "USDF/USDC bridge · 1:1",
      });
      curveSteps.push({
        from: "USDF",
        to: selected.symbol,
        via: "Flipcash curve",
      });
    } else {
      // SOL — Jupiter handles the SOL→USDC leg
      curveSteps.push({
        from: inputToken,
        to: "USDC",
        via: buyJup.quote
          ? `Jupiter · ${jupiterDexLabel(buyJup.quote)}`
          : "Jupiter",
      });
      curveSteps.push({
        from: "USDC",
        to: "USDF",
        via: "USDF/USDC bridge · 1:1",
      });
      curveSteps.push({
        from: "USDF",
        to: selected.symbol,
        via: "Flipcash curve",
      });
    }

    if (directOut !== null && directOut > curveOut) {
      const deltaPct = curveOut > 0 ? (directOut / curveOut - 1) * 100 : 0;
      return {
        provider: "jupiter-direct",
        expectedOut: directOut,
        steps: [
          {
            from: inputToken,
            to: selected.symbol,
            via: `Jupiter · ${jupiterDexLabel(directBuy.quote!)}`,
          },
        ],
        alt: { providerLabel: "Flipcash curve", deltaPct },
      };
    }
    const deltaPct =
      directOut !== null && directOut > 0
        ? (curveOut / directOut - 1) * 100
        : 0;
    return {
      provider: "curve",
      expectedOut: curveOut,
      steps: curveSteps,
      alt: directOut !== null ? { providerLabel: "Jupiter", deltaPct } : null,
    };
  }, [isBuy, selected, buyQuote, directBuy.quote, inputToken, buyJup.quote]);

  const aggregatedSell = useMemo<Aggregated | null>(() => {
    if (isBuy || !selected || !sellQuoteRaw) return null;

    // Curve path's expected output in user's chosen output mint's display
    // units.
    let curveOut: number;
    if (outputToken === "USDF" || outputToken === "USDC") {
      // 1:1 bridge USDF↔USDC, both 6 decimals → expected USDF == USDC
      curveOut = sellQuoteRaw.expectedUsdfOut;
    } else {
      // SOL: relies on Jupiter's USDC→SOL quote at sellUsdfWorstQuarks
      curveOut = sellJup.quote
        ? Number(sellJup.quote.outAmount) / 10 ** sideInfo.decimals
        : 0;
    }

    const directOut = directSell.quote
      ? Number(directSell.quote.outAmount) / 10 ** sideInfo.decimals
      : null;

    // Build curve route steps.
    const curveSteps: RouteStep[] = [
      { from: selected.symbol, to: "USDF", via: "Flipcash curve" },
    ];
    if (outputToken === "USDC") {
      curveSteps.push({
        from: "USDF",
        to: "USDC",
        via: "USDF/USDC bridge · 1:1",
      });
    } else if (outputToken === "SOL") {
      curveSteps.push({
        from: "USDF",
        to: "USDC",
        via: "USDF/USDC bridge · 1:1",
      });
      curveSteps.push({
        from: "USDC",
        to: outputToken,
        via: sellJup.quote
          ? `Jupiter · ${jupiterDexLabel(sellJup.quote)}`
          : "Jupiter",
      });
    }

    if (directOut !== null && directOut > curveOut) {
      const deltaPct = curveOut > 0 ? (directOut / curveOut - 1) * 100 : 0;
      return {
        provider: "jupiter-direct",
        expectedOut: directOut,
        steps: [
          {
            from: selected.symbol,
            to: outputToken,
            via: `Jupiter · ${jupiterDexLabel(directSell.quote!)}`,
          },
        ],
        alt: { providerLabel: "Flipcash curve", deltaPct },
      };
    }
    const deltaPct =
      directOut !== null && directOut > 0
        ? (curveOut / directOut - 1) * 100
        : 0;
    return {
      provider: "curve",
      expectedOut: curveOut,
      steps: curveSteps,
      alt: directOut !== null ? { providerLabel: "Jupiter", deltaPct } : null,
    };
  }, [
    isBuy,
    selected,
    sellQuoteRaw,
    directSell.quote,
    sellJup.quote,
    outputToken,
    sideInfo.decimals,
  ]);

  const aggregated = isBuy ? aggregatedBuy : aggregatedSell;

  const aggregatorLoading = isBuy
    ? directBuy.loading || (inputToken === "SOL" && buyJup.loading)
    : directSell.loading || (outputToken === "SOL" && sellJup.loading);

  const expectedOutDisplay = useMemo(() => {
    if (aggregated) return fmtCompactNumber(aggregated.expectedOut);
    if (aggregatorLoading) return "…";
    return "0";
  }, [aggregated, aggregatorLoading]);

  const priceLabel = useMemo(() => {
    if (!selected) return "—";
    if (isBuy) {
      if (buyQuote)
        return `≈ ${fmtUsd(buyQuote.effectivePriceUsdf)} / ${selected.symbol}`;
      return inputToken === "SOL" && buyJup.loading
        ? "fetching route…"
        : "spot price";
    }
    if (sellQuoteRaw)
      return `≈ ${fmtUsd(sellQuoteRaw.effectivePriceUsdf)} / ${selected.symbol}`;
    return "spot price";
  }, [isBuy, selected, buyQuote, sellQuoteRaw, inputToken, buyJup.loading]);

  // ─── Validation ─────────────────────────────────────────────────────
  const validation = useMemo<{ ok: boolean; reason?: string }>(() => {
    void bridge.data; // referenced inside conditionals below
    if (!connected || !publicKey)
      return { ok: false, reason: "Connect wallet" };
    if (!selected) return { ok: false, reason: "Select a currency" };
    if (!selected.pool || !selected.vaultA || !selected.vaultB)
      return { ok: false, reason: "Currency has no pool" };
    if (!input)
      return {
        ok: false,
        reason: isBuy
          ? `Enter ${sourceSymbol} amount`
          : `Enter ${selected.symbol} amount`,
      };
    if (inputQuarks === null) return { ok: false, reason: "Invalid amount" };
    if (inputQuarks <= 0n) return { ok: false, reason: "Amount must be > 0" };
    if (sourceBalance !== null && inputQuarks > sourceBalance)
      return { ok: false, reason: `Insufficient ${sourceSymbol}` };
    if (!isBuy) {
      if (!sellQuoteRaw) return { ok: false, reason: "Computing quote…" };
      if (sellQuoteRaw.expectedUsdfOut <= 0)
        return { ok: false, reason: "Pool has no USDF reserve" };
      if (outputToken === "SOL" && sellJup.loading && !sellJup.quote)
        return { ok: false, reason: "Fetching route…" };
      // Selling to USDC or SOL goes through the bridge USDF → USDC. The
      // bridge can only fill that direction if its USDC vault is funded.
      if (outputToken !== "USDF" && bridge.data) {
        const need = sellUsdfWorstQuarks ?? 0n;
        if (need > bridge.data.otherVaultBalance) {
          return {
            ok: false,
            reason: "Bridge out of USDC — try selling to USDF",
          };
        }
      }
    }
    if (isBuy && inputToken === "SOL" && buyJup.loading && !buyJup.quote)
      return { ok: false, reason: "Fetching route…" };
    // Symmetric guard for buy: USDC and SOL inputs both use the bridge to
    // convert USDC into USDF, so the USDF vault must hold enough.
    if (isBuy && inputToken !== "USDF" && bridge.data && inputQuarks) {
      const need = inputToken === "USDC" ? inputQuarks : 0n;
      // For SOL the bridge consumes the Jupiter output (USDC). Use the
      // live Jupiter worst-case if we have it; otherwise let the on-chain
      // simulation surface any shortfall instead of guessing.
      const finalNeed =
        inputToken === "SOL" && buyJup.quote
          ? BigInt(buyJup.quote.otherAmountThreshold)
          : need;
      if (finalNeed > 0n && finalNeed > bridge.data.usdfVaultBalance) {
        return { ok: false, reason: "Bridge out of USDF" };
      }
    }
    return { ok: true };
  }, [
    connected,
    publicKey,
    selected,
    input,
    inputQuarks,
    sourceBalance,
    sellQuoteRaw,
    isBuy,
    inputToken,
    outputToken,
    sourceSymbol,
    buyJup.loading,
    buyJup.quote,
    sellJup.loading,
    sellJup.quote,
    bridge.data,
    sellUsdfWorstQuarks,
  ]);

  // ─── Actions ────────────────────────────────────────────────────────
  function flip() {
    setDirection((d) => (d === "buy" ? "sell" : "buy"));
    setInput("");
    setStatus({ kind: "idle" });
  }

  function refreshBalances() {
    if (refreshing) return;
    setRefreshing(true);
    setRefresh((r) => r + 1);
    window.setTimeout(() => setRefreshing(false), 700);
  }

  function setMax() {
    if (sourceBalance === null || sourceBalance <= 0n) return;
    setInput(fmtQuarks(sourceBalance, sourceDecimals, sourceDecimals));
  }

  async function sendStep(step: SignableStep): Promise<string> {
    try {
      const sig = await sendTransaction(step.tx, connection);
      // Polling instead of confirmTransaction — Vercel Functions don't
      // proxy WebSockets, and the WS subscription confirmTransaction opens
      // would otherwise spew "WebSocket connection to wss://…/api/rpc" in
      // the browser console.
      await confirmSignaturePolling(connection, sig, {
        desiredCommitment: "confirmed",
        timeoutMs: 60_000,
      });
      return sig;
    } catch (err) {
      throw enrichTxError(err, step.label);
    }
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
    setSubmitProgress("");
    setStatus({ kind: "idle" });
    // Snapshot the user-facing amounts at submit time — `input` gets cleared
    // on success and we want the modal to show what they actually paid.
    const paidAmountStr = input;
    const expectedOutStr = expectedOutDisplay;
    const sideSymbolAtSubmit = sideToken;
    const sideIconSrc =
      sideToken === "SOL"
        ? "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png"
        : sideToken === "USDC"
          ? "/usdc.png"
          : "/usdf.png";
    const currencySymbol = selected.symbol;
    const currencyIcon = selected.image ?? null;
    try {
      const txs: SignableStep[] = isBuy
        ? (
            await planMultiHopBuy(
              connection,
              {
                user: publicKey,
                inputMint: sideInfo.mint,
                inAmount: inputQuarks,
                slippageBps,
                target: {
                  mint: new PublicKey(selected.mint),
                  pool: new PublicKey(selected.pool),
                  vaultA: new PublicKey(selected.vaultA),
                  vaultB: new PublicKey(selected.vaultB),
                  reserveTokenQuarks: BigInt(selected.reserveTokenQuarks ?? "0"),
                  reserveUsdfQuarks: BigInt(selected.reserveUsdfQuarks ?? "0"),
                },
              },
              selected.symbol,
            )
          ).txs
        : (
            await planMultiHopSell(
              connection,
              {
                user: publicKey,
                sourceMint: new PublicKey(selected.mint),
                inAmount: inputQuarks,
                outputMint: sideInfo.mint,
                slippageBps,
                source: {
                  pool: new PublicKey(selected.pool),
                  vaultA: new PublicKey(selected.vaultA),
                  vaultB: new PublicKey(selected.vaultB),
                  reserveTokenQuarks: BigInt(selected.reserveTokenQuarks ?? "0"),
                  reserveUsdfQuarks: BigInt(selected.reserveUsdfQuarks ?? "0"),
                  sellFeeBps: selected.sellFeeBps ?? 100,
                },
              },
              selected.symbol,
            )
          ).txs;

      const sigs: string[] = [];
      for (let i = 0; i < txs.length; i++) {
        if (txs.length > 1) {
          setSubmitProgress(`${i + 1}/${txs.length} · ${txs[i].label}`);
        }
        const sig = await sendStep(txs[i]);
        sigs.push(sig);
      }
      setStatus({
        kind: "success",
        signature: sigs[sigs.length - 1],
        allSigs: sigs,
      });
      setSuccessSummary({
        direction: isBuy ? "buy" : "sell",
        paid: isBuy
          ? {
              amount: paidAmountStr,
              symbol: sideSymbolAtSubmit,
              iconSrc: sideIconSrc,
            }
          : {
              amount: paidAmountStr,
              symbol: currencySymbol,
              iconSrc: currencyIcon,
            },
        received: isBuy
          ? {
              amount: expectedOutStr,
              symbol: currencySymbol,
              iconSrc: currencyIcon,
            }
          : {
              amount: expectedOutStr,
              symbol: sideSymbolAtSubmit,
              iconSrc: sideIconSrc,
            },
        signatures: sigs,
      });
      setInput("");
      setRefresh((r) => r + 1);
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
    } finally {
      setSubmitting(false);
      setSubmitProgress("");
    }
  }

  // ─── Chips ──────────────────────────────────────────────────────────
  const sourceTokenChip = isBuy ? (
    <InputTokenChip
      selected={inputToken}
      onSelect={(k) => {
        setInputToken(k as SideTokenKey);
        setInput("");
      }}
    />
  ) : (
    <CurrencyChip selected={selected} onClick={() => setPickerOpen(true)} />
  );
  const destTokenChip = isBuy ? (
    <CurrencyChip selected={selected} onClick={() => setPickerOpen(true)} />
  ) : (
    <InputTokenChip
      selected={outputToken}
      onSelect={(k) => setOutputToken(k as SideTokenKey)}
    />
  );

  const activeQuoteImpact = isBuy
    ? buyQuote?.priceImpact
    : sellQuoteRaw?.priceImpact;
  const sellFeeBps = selected?.sellFeeBps ?? null;

  // Combined Jupiter price-impact in addition to curve impact.
  const jupiterImpactPct = isBuy
    ? buyJup.quote
      ? Number(buyJup.quote.priceImpactPct)
      : null
    : sellJup.quote
      ? Number(sellJup.quote.priceImpactPct)
      : null;

  return (
    <div className="card p-2.5 shadow-card">
      <div className="flex items-center justify-between px-2.5 pt-1.5 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="inline-block w-1 h-1 rounded-full bg-white/30" />
          <span className="text-[12px] font-medium text-white/65 tracking-wide">
            Swap
          </span>
          <span className="text-[12px] text-white/35">
            {isBuy
              ? inputToken === "USDF"
                ? "· buy"
                : `· buy via ${inputToken}`
              : outputToken === "USDF"
                ? "· sell"
                : `· sell to ${outputToken}`}
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
                className="px-1.5 py-0.5 rounded-md text-[10.5px] font-semibold text-white/55 hover:text-white hover:bg-white/[0.06] transition-colors"
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
          <div
            className={
              "flex-1 min-w-0 text-[34px] sm:text-[40px] font-semibold tabular-nums tracking-[-0.03em] " +
              (expectedOutDisplay === "…" ? "text-white/40" : "text-white/85")
            }
          >
            {expectedOutDisplay}
          </div>
          {destTokenChip}
        </div>

        {selected && (activeQuoteImpact !== undefined || jupiterImpactPct !== null) && (
          <div className="mt-3 flex items-center justify-between text-[11px] text-white/45">
            <span>
              Impact{" "}
              <span
                className={impactClass(
                  combinedImpact(activeQuoteImpact, jupiterImpactPct),
                )}
              >
                {fmtPct(combinedImpact(activeQuoteImpact, jupiterImpactPct), 2)}
              </span>
            </span>
            <span className="tabular-nums">
              {isBuy
                ? buyQuote
                  ? `Mcap ${fmtUsd(buyQuote.marketCapUsdf)}`
                  : ""
                : sellQuoteRaw
                  ? `Mcap ${fmtUsd(sellQuoteRaw.marketCapUsdf)}`
                  : ""}
            </span>
          </div>
        )}
      </div>

      {/* Slippage */}
      <div className="flex items-center justify-between px-1 pt-3 pb-1 text-[11px]">
        <span className="text-white/40 uppercase tracking-wider">Slippage</span>
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
          ? submitProgress || "Confirming…"
          : validation.ok
            ? `${isBuy ? "Buy" : "Sell"} ${selected?.symbol ?? ""}`
            : (validation.reason ?? (isBuy ? "Buy" : "Sell"))}
      </button>

      {status.kind === "error" && (
        <p className="mt-3 mx-1 text-[12.5px] text-err break-words rounded-xl bg-err/[0.07] border border-err/20 px-3 py-2.5">
          {status.message}
        </p>
      )}

      <RouteSummary
        loading={aggregatorLoading && !aggregated}
        steps={aggregated?.steps ?? null}
        provider={aggregated?.provider ?? null}
        alt={aggregated?.alt ?? null}
      />

      <TokenPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(c) => setSelected(c)}
        currencies={currencies.data}
      />

      <SwapSuccessModal
        summary={successSummary}
        onClose={() => setSuccessSummary(null)}
      />
    </div>
  );
}

/**
 * The wallet adapter wraps every send error in WalletSendTransactionError,
 * which hides the actual reason behind a generic message. Underneath there's
 * usually a SendTransactionError from web3.js with `.logs` and a more useful
 * `.message`. Pull whatever we can find and produce a single readable line.
 */
function enrichTxError(err: unknown, label: string): Error {
  const e = err as {
    message?: string;
    error?: { message?: string; logs?: string[] };
    logs?: string[];
  };
  const inner = e?.error?.message ?? "";
  const logs = e?.error?.logs ?? e?.logs ?? [];
  // Find the first program-emitted error log line.
  const programErr = logs.find((l) =>
    /(Program log: |custom program error|failed: )/i.test(l),
  );
  const head = inner || e?.message || "transaction failed";
  const detail = programErr
    ? ` · ${programErr.replace(/^Program log:\s*/, "")}`
    : "";
  return new Error(`${label}: ${head}${detail}`);
}

function combinedImpact(
  curve: number | undefined,
  jupiter: number | null,
): number {
  return (curve ?? 0) + (jupiter ?? 0);
}

function impactClass(impact: number): string {
  if (impact > 0.05) return "text-err";
  if (impact > 0.01) return "text-spark";
  return "text-white/65";
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
