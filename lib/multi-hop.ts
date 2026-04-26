import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  FLIPCASH_USDF_USDC_POOL,
  USDC_MINT,
  USDF_MINT,
  buildSwapIx as buildBridgeSwapIx,
  fetchPoolState as fetchBridgePool,
  type PoolState as BridgePoolState,
} from "./usdf-swap";
import {
  USDF_BASE_MINT,
  buildBuyTokensIx,
  buildSellTokensIx,
  quoteBuy,
  quoteSell,
  tokensToMinOutQuarks,
  usdfToMinOutQuarks,
} from "./flipcash";
import {
  SOL_MINT,
  deserializeInstruction,
  fetchAddressLookupTables,
  getJupiterQuote,
  getJupiterSwapInstructions,
  jupiterDexLabel,
  type JupiterQuote,
  type SwapInstructionsResponse,
} from "./jupiter";
import { WIRE_FEE_BPS, WIRE_FEE_OWNER, feeEnabled } from "./jupiter/fee";
import { QUARKS_PER_TOKEN } from "./flipcash";

export type HopRoute = "usdf-direct" | "usdc-bridge" | "jupiter-bridge";
export type SellRoute = "to-usdf" | "to-usdc" | "to-jupiter";
export type Provider = "curve" | "jupiter-direct";

/** A single human-readable hop in the chosen swap route. */
export type RouteStep = {
  /** Source token symbol (USDF / USDC / SOL / currency symbol / mint short). */
  from: string;
  to: string;
  /** Pool/AMM/program label, e.g. "Flipcash curve", "USDF↔USDC bridge", "Jupiter (Meteora DAMM v2)". */
  via: string;
};

const TX_SIZE_LIMIT = 1232;

/**
 * Account-count caps for Jupiter quotes — chosen so the resulting tx
 * always fits in Solana's 1232-byte limit and only ever needs one
 * signature. The two values reflect different tx compositions:
 *
 *   • Curve path: Jupiter is one leg, plus ~16 accounts of bridge +
 *     flipcash + ATAs + signer. 28 accounts on Jupiter leaves headroom.
 *
 *   • Direct path: Jupiter is the only program. We can afford a much
 *     larger account budget — most pools for niche tokens (e.g.,
 *     Meteora DAMM v2) need 36–48 to find a route at all.
 */
const JUPITER_MAX_ACCOUNTS_CURVE_LEG = 28;
const JUPITER_MAX_ACCOUNTS_DIRECT = 48;

export type SignableStep = {
  /** Short label for UI progress: "Jupiter swap", "Bridge + buy", etc. */
  label: string;
  tx: VersionedTransaction;
  size: number;
};

export type MultiHopBuyPlan = {
  /** Which side of the aggregator won. */
  provider: Provider;
  /** Curve sub-classification when provider="curve". */
  route: HopRoute;
  /** Human-readable route hops for UI display. */
  routeSteps: RouteStep[];
  /** True if everything fits in a single tx → atomic. */
  atomic: boolean;
  txs: SignableStep[];
  /** Worst-case currency tokens the user will receive (10 decimals). */
  minTokensOutQuarks: bigint;
  /** Best-case currency tokens (display). */
  expectedTokensOut: number;
  /** USDF that will hit the user's USDF ATA after the bridge (worst case). 0 for jupiter-direct. */
  worstUsdfQuarks: bigint;
  jupiterQuote: JupiterQuote | null;
};

export type MultiHopSellPlan = {
  provider: Provider;
  route: SellRoute;
  routeSteps: RouteStep[];
  atomic: boolean;
  txs: SignableStep[];
  /** Worst-case output (in the user's chosen output mint's smallest units). */
  minOutputQuarks: bigint;
  /** Best-case output for display. */
  expectedOutput: number;
  /** USDF the user will have after the flipcash sell (worst case). 0 for jupiter-direct. */
  worstUsdfQuarks: bigint;
  jupiterQuote: JupiterQuote | null;
};

// ─────────────────────────────────────────────────────────────────────
//                              BUY
// ─────────────────────────────────────────────────────────────────────

export type MultiHopBuyInput = {
  user: PublicKey;
  inputMint: PublicKey;
  inAmount: bigint;
  slippageBps: number;
  target: {
    mint: PublicKey;
    pool: PublicKey;
    vaultA: PublicKey;
    vaultB: PublicKey;
    reserveTokenQuarks: bigint;
    reserveUsdfQuarks: bigint;
  };
};

/**
 * Curve-only buy planner — input → (Jupiter→USDC if needed) → bridge USDC→USDF
 * if needed → flipcash buy. Always single-tx (caps Jupiter at maxAccounts).
 *
 * Wrapped by `planMultiHopBuy` which compares this against a pure-Jupiter
 * route and picks whichever delivers more.
 */
async function planCurveBuy(
  connection: Connection,
  input: MultiHopBuyInput,
  targetSymbol: string,
): Promise<MultiHopBuyPlan> {
  const route = pickBuyRoute(input.inputMint);

  // ─── Jupiter leg (input → USDC) ──────────────────────────────────────
  let jupiterQuote: JupiterQuote | null = null;
  let jupiterSwap: SwapInstructionsResponse | null = null;
  let jupiterIxs: ReturnType<typeof unpackJupiter> | null = null;
  let jupiterAlts: AddressLookupTableAccount[] = [];
  let usdcInBest: bigint;
  let usdcInWorst: bigint;

  if (route === "jupiter-bridge") {
    // Jupiter fee — output mint of the Jupiter leg is USDC for buy.
    const fee = computeFeeAccount(USDC_MINT);

    jupiterQuote = await getJupiterQuote({
      inputMint: input.inputMint.toBase58(),
      outputMint: USDC_MINT.toBase58(),
      amount: input.inAmount.toString(),
      slippageBps: input.slippageBps,
      restrictIntermediateTokens: true,
      platformFeeBps: fee?.bps,
      maxAccounts: JUPITER_MAX_ACCOUNTS_CURVE_LEG,
    });
    usdcInBest = BigInt(jupiterQuote.outAmount);
    usdcInWorst = BigInt(jupiterQuote.otherAmountThreshold);

    jupiterSwap = await getJupiterSwapInstructions({
      quoteResponse: jupiterQuote,
      userPublicKey: input.user.toBase58(),
      wrapAndUnwrapSol: input.inputMint.equals(SOL_MINT),
      useSharedAccounts: true,
      feeAccount: fee?.ata.toBase58(),
    });
    jupiterIxs = unpackJupiter(jupiterSwap);
    jupiterAlts = await fetchAddressLookupTables(
      connection,
      jupiterSwap.addressLookupTableAddresses,
    );
  } else if (route === "usdc-bridge") {
    usdcInBest = input.inAmount;
    usdcInWorst = input.inAmount;
  } else {
    usdcInBest = 0n;
    usdcInWorst = 0n;
  }

  // ─── Bridge planning (USDC → USDF, 1:1, same decimals) ───────────────
  const usdfInWorst =
    route === "usdf-direct" ? input.inAmount : usdcInWorst;
  const usdfInBest =
    route === "usdf-direct"
      ? input.inAmount
      : route === "usdc-bridge"
        ? input.inAmount
        : usdcInBest;

  const bridgePool: BridgePoolState | null =
    route === "usdf-direct"
      ? null
      : await fetchBridgePool(connection, FLIPCASH_USDF_USDC_POOL);

  // ─── Flipcash buy quote ─────────────────────────────────────────────
  const buyQuoteWorst = quoteBuy(
    input.target.reserveTokenQuarks,
    input.target.reserveUsdfQuarks,
    usdfInWorst,
  );
  const buyQuoteBest = quoteBuy(
    input.target.reserveTokenQuarks,
    input.target.reserveUsdfQuarks,
    usdfInBest,
  );
  const minTokensOutQuarks = tokensToMinOutQuarks(
    buyQuoteWorst.expectedTokensOut,
    input.slippageBps,
  );

  // ─── ATA setups ─────────────────────────────────────────────────────
  const targetAta = getAssociatedTokenAddressSync(
    input.target.mint,
    input.user,
  );
  const usdfAta = getAssociatedTokenAddressSync(USDF_BASE_MINT, input.user);
  const usdcAta = getAssociatedTokenAddressSync(USDC_MINT, input.user);

  const ataPairs: Array<readonly [PublicKey, PublicKey]> = [
    [targetAta, input.target.mint],
    [usdfAta, USDF_BASE_MINT],
  ];
  if (route !== "usdf-direct") {
    ataPairs.push([usdcAta, USDC_MINT]);
  }
  // When fees are on and the Jupiter leg outputs USDC, the integrator's
  // USDC fee ATA must exist before the swap or Jupiter rejects the tx.
  if (route === "jupiter-bridge") {
    const fee = computeFeeAccount(USDC_MINT);
    if (fee) ataPairs.push([fee.ata, USDC_MINT]);
  }
  const setupAtas = await buildAtaSetups(connection, input.user, ataPairs);

  // ─── Bridge ix (USDC → USDF) ────────────────────────────────────────
  const bridgeIx =
    route === "usdf-direct"
      ? null
      : buildBridgeSwapIx(
          {
            user: input.user,
            pool: bridgePool!.address,
            usdfVault: bridgePool!.usdfVault,
            otherVault: bridgePool!.otherVault,
            userUsdfToken: usdfAta,
            userOtherToken: usdcAta,
          },
          usdcInWorst,
          /* usdfToOther */ false, // USDC → USDF
        );

  const buyIx = buildBuyTokensIx(
    {
      buyer: input.user,
      pool: input.target.pool,
      targetMint: input.target.mint,
      baseMint: USDF_BASE_MINT,
      vaultA: input.target.vaultA,
      vaultB: input.target.vaultB,
      buyerTarget: targetAta,
      buyerBase: usdfAta,
    },
    usdfInWorst,
    minTokensOutQuarks,
  );

  // ─── Pack into 1 or 2 transactions ──────────────────────────────────
  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  // Try single-tx first.
  const singleIxs: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
    ComputeBudgetProgram.setComputeUnitLimit({
      units: route === "jupiter-bridge" ? 600_000 : 250_000,
    }),
    ...(jupiterIxs?.setup ?? []),
    ...setupAtas,
    ...(jupiterIxs?.swap ? [jupiterIxs.swap] : []),
    ...(jupiterIxs?.cleanup ? [jupiterIxs.cleanup] : []),
    ...(bridgeIx ? [bridgeIx] : []),
    buyIx,
  ];
  const singleTx = buildV0Tx(singleIxs, input.user, blockhash, jupiterAlts);

  if (singleTx.serialize().length <= TX_SIZE_LIMIT) {
    return {
      provider: "curve",
      route,
      routeSteps: curveBuyRouteSteps(route, input.inputMint, targetSymbol, jupiterQuote),
      atomic: true,
      txs: [
        {
          label: route === "jupiter-bridge" ? "Multi-hop swap" : route === "usdc-bridge" ? "Bridge + buy" : "Buy",
          tx: singleTx,
          size: singleTx.serialize().length,
        },
      ],
      minTokensOutQuarks,
      expectedTokensOut: buyQuoteBest.expectedTokensOut,
      worstUsdfQuarks: usdfInWorst,
      jupiterQuote,
    };
  }

  throw new Error(
    `Route is too big to fit in one transaction (${singleTx.serialize().length} bytes). ` +
      `Try a smaller amount or pay with USDF/USDC instead.`,
  );
}

/**
 * Direct-Jupiter buy planner — single Jupiter swap input→target. Returns
 * null if Jupiter has no route or the resulting tx overflows 1232 bytes.
 */
async function planJupiterDirectBuy(
  connection: Connection,
  input: MultiHopBuyInput,
  targetSymbol: string,
): Promise<MultiHopBuyPlan | null> {
  // Skip when input mint == output mint (no-op).
  if (input.inputMint.equals(input.target.mint)) return null;

  const fee = computeFeeAccount(input.target.mint);
  let jupiterQuote: JupiterQuote;
  try {
    jupiterQuote = await getJupiterQuote({
      inputMint: input.inputMint.toBase58(),
      outputMint: input.target.mint.toBase58(),
      amount: input.inAmount.toString(),
      slippageBps: input.slippageBps,
      restrictIntermediateTokens: true,
      platformFeeBps: fee?.bps,
      maxAccounts: JUPITER_MAX_ACCOUNTS_DIRECT,
    });
  } catch (e) {
    if (process.env.WIRE_DEBUG) console.error("[direct-buy] quote failed:", (e as Error).message);
    return null;
  }

  let swapResp: SwapInstructionsResponse;
  try {
    swapResp = await getJupiterSwapInstructions({
      quoteResponse: jupiterQuote,
      userPublicKey: input.user.toBase58(),
      wrapAndUnwrapSol: input.inputMint.equals(SOL_MINT),
      // Some "simple AMMs" (Meteora DAMM v2 etc.) reject shared accounts.
      // Direct Jupiter routes don't need them anyway — leave false.
      useSharedAccounts: false,
      feeAccount: fee?.ata.toBase58(),
    });
  } catch (e) {
    if (process.env.WIRE_DEBUG) console.error("[direct-buy] swap-ix failed:", (e as Error).message);
    return null;
  }
  const ixs = unpackJupiter(swapResp);
  const alts = await fetchAddressLookupTables(
    connection,
    swapResp.addressLookupTableAddresses,
  );

  const targetAta = getAssociatedTokenAddressSync(
    input.target.mint,
    input.user,
  );
  const ataPairs: Array<readonly [PublicKey, PublicKey]> = [
    [targetAta, input.target.mint],
  ];
  if (fee) ataPairs.push([fee.ata, input.target.mint]);
  const setupAtas = await buildAtaSetups(connection, input.user, ataPairs);

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const ixsList: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
    ...ixs.setup,
    ...setupAtas,
    ixs.swap,
    ...(ixs.cleanup ? [ixs.cleanup] : []),
  ];
  const tx = buildV0Tx(ixsList, input.user, blockhash, alts);
  const size = tx.serialize().length;
  if (size > TX_SIZE_LIMIT) return null;

  // expectedTokensOut in display units (10 decimals).
  const expectedTokensOut =
    Number(jupiterQuote.outAmount) / Number(QUARKS_PER_TOKEN);
  const minTokensOutQuarks = BigInt(jupiterQuote.otherAmountThreshold);

  return {
    provider: "jupiter-direct",
    route: "usdf-direct", // unused for jupiter-direct; just satisfies the type
    routeSteps: [
      {
        from: symbolOfMint(input.inputMint),
        to: targetSymbol,
        via: `Jupiter · ${jupiterDexLabel(jupiterQuote)}`,
      },
    ],
    atomic: true,
    txs: [{ label: "Direct swap", tx, size }],
    minTokensOutQuarks,
    expectedTokensOut,
    worstUsdfQuarks: 0n,
    jupiterQuote,
  };
}

/**
 * Aggregator: race the curve path and the direct-Jupiter path, return the
 * one that delivers more target tokens. Single-tx and atomic regardless.
 */
export async function planMultiHopBuy(
  connection: Connection,
  input: MultiHopBuyInput,
  targetSymbol = "TOKEN",
): Promise<MultiHopBuyPlan> {
  const [curvePlan, jupiterPlan] = await Promise.all([
    planCurveBuy(connection, input, targetSymbol),
    planJupiterDirectBuy(connection, input, targetSymbol).catch(() => null),
  ]);
  if (jupiterPlan && jupiterPlan.expectedTokensOut > curvePlan.expectedTokensOut) {
    return jupiterPlan;
  }
  return curvePlan;
}

// ─────────────────────────────────────────────────────────────────────
//                              SELL
// ─────────────────────────────────────────────────────────────────────

export type MultiHopSellInput = {
  user: PublicKey;
  /** Currency mint being sold. */
  sourceMint: PublicKey;
  /** Currency-token quarks (10 decimals). */
  inAmount: bigint;
  /** Mint of the token the user wants to receive (USDF/USDC/any). */
  outputMint: PublicKey;
  slippageBps: number;
  source: {
    pool: PublicKey;
    vaultA: PublicKey;
    vaultB: PublicKey;
    reserveTokenQuarks: bigint;
    reserveUsdfQuarks: bigint;
    sellFeeBps: number;
  };
};

/**
 * Curve-only sell planner — flipcash sell → bridge USDF→USDC if needed →
 * Jupiter USDC→output if needed. Always single-tx.
 */
async function planCurveSell(
  connection: Connection,
  input: MultiHopSellInput,
  sourceSymbol: string,
): Promise<MultiHopSellPlan> {
  const route: SellRoute = input.outputMint.equals(USDF_MINT)
    ? "to-usdf"
    : input.outputMint.equals(USDC_MINT)
      ? "to-usdc"
      : "to-jupiter";

  // ─── Sell quote (currency → USDF) ───────────────────────────────────
  const sellQ = quoteSell(
    input.source.reserveTokenQuarks,
    input.source.reserveUsdfQuarks,
    input.inAmount,
    input.source.sellFeeBps,
  );
  // Apply user slippage on top of the on-chain fee.
  const minUsdfQuarks = usdfToMinOutQuarks(
    sellQ.expectedUsdfOut,
    input.slippageBps,
  );
  const usdfWorst = minUsdfQuarks; // bridge will use this as `amount`
  const usdfBest = BigInt(
    Math.floor(sellQ.expectedUsdfOut * 10 ** 6),
  );

  const bridgePool: BridgePoolState | null =
    route === "to-usdf"
      ? null
      : await fetchBridgePool(connection, FLIPCASH_USDF_USDC_POOL);

  // ─── Jupiter leg (USDC → output mint), only when route=to-jupiter ───
  let jupiterQuote: JupiterQuote | null = null;
  let jupiterSwap: SwapInstructionsResponse | null = null;
  let jupiterIxs: ReturnType<typeof unpackJupiter> | null = null;
  let jupiterAlts: AddressLookupTableAccount[] = [];
  let minOutputQuarks: bigint;
  let expectedOutput: number;

  if (route === "to-jupiter") {
    if (usdfWorst <= 0n) {
      throw new Error("Sell would yield 0 USDF — cannot route through Jupiter");
    }
    // Jupiter takes the worst-case USDC (= usdfWorst since 1:1) as input.
    // Fee is taken in the OUTPUT mint (user's chosen output, e.g., wSOL).
    const fee = computeFeeAccount(input.outputMint);

    jupiterQuote = await getJupiterQuote({
      inputMint: USDC_MINT.toBase58(),
      outputMint: input.outputMint.toBase58(),
      amount: usdfWorst.toString(),
      slippageBps: input.slippageBps,
      restrictIntermediateTokens: true,
      platformFeeBps: fee?.bps,
      maxAccounts: JUPITER_MAX_ACCOUNTS_CURVE_LEG,
    });
    jupiterSwap = await getJupiterSwapInstructions({
      quoteResponse: jupiterQuote,
      userPublicKey: input.user.toBase58(),
      wrapAndUnwrapSol: input.outputMint.equals(SOL_MINT),
      useSharedAccounts: true,
      feeAccount: fee?.ata.toBase58(),
    });
    jupiterIxs = unpackJupiter(jupiterSwap);
    jupiterAlts = await fetchAddressLookupTables(
      connection,
      jupiterSwap.addressLookupTableAddresses,
    );
    minOutputQuarks = BigInt(jupiterQuote.otherAmountThreshold);
    // For "expected", recompute Jupiter quote at best-case USDF would be
    // marginal — use the worst-case quote's outAmount as a close proxy.
    expectedOutput = Number(jupiterQuote.outAmount);
  } else if (route === "to-usdc") {
    minOutputQuarks = usdfWorst; // 1:1 bridge
    expectedOutput = Number(usdfBest);
  } else {
    minOutputQuarks = usdfWorst;
    expectedOutput = Number(usdfBest);
  }

  // ─── ATA setups ─────────────────────────────────────────────────────
  const sourceAta = getAssociatedTokenAddressSync(
    input.sourceMint,
    input.user,
  );
  const usdfAta = getAssociatedTokenAddressSync(USDF_BASE_MINT, input.user);
  const usdcAta = getAssociatedTokenAddressSync(USDC_MINT, input.user);

  const sellAtaPairs: Array<readonly [PublicKey, PublicKey]> = [
    [sourceAta, input.sourceMint],
    [usdfAta, USDF_BASE_MINT],
  ];
  if (route !== "to-usdf") sellAtaPairs.push([usdcAta, USDC_MINT]);
  // For sell→non-USDF/USDC routes, fee ATA is for the user's output mint.
  if (route === "to-jupiter") {
    const fee = computeFeeAccount(input.outputMint);
    if (fee) sellAtaPairs.push([fee.ata, input.outputMint]);
  }
  const setupAtas = await buildAtaSetups(connection, input.user, sellAtaPairs);

  // ─── Build instructions ─────────────────────────────────────────────
  const sellIx = buildSellTokensIx(
    {
      seller: input.user,
      pool: input.source.pool,
      targetMint: input.sourceMint,
      baseMint: USDF_BASE_MINT,
      vaultA: input.source.vaultA,
      vaultB: input.source.vaultB,
      sellerTarget: sourceAta,
      sellerBase: usdfAta,
    },
    input.inAmount,
    minUsdfQuarks,
  );

  const bridgeIx =
    route === "to-usdf"
      ? null
      : buildBridgeSwapIx(
          {
            user: input.user,
            pool: bridgePool!.address,
            usdfVault: bridgePool!.usdfVault,
            otherVault: bridgePool!.otherVault,
            userUsdfToken: usdfAta,
            userOtherToken: usdcAta,
          },
          usdfWorst,
          /* usdfToOther */ true, // USDF → USDC
        );

  // ─── Pack into 1 or 2 transactions ──────────────────────────────────
  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  const singleIxs: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
    ComputeBudgetProgram.setComputeUnitLimit({
      units: route === "to-jupiter" ? 600_000 : 250_000,
    }),
    ...(jupiterIxs?.setup ?? []),
    ...setupAtas,
    sellIx,
    ...(bridgeIx ? [bridgeIx] : []),
    ...(jupiterIxs?.swap ? [jupiterIxs.swap] : []),
    ...(jupiterIxs?.cleanup ? [jupiterIxs.cleanup] : []),
  ];
  const singleTx = buildV0Tx(singleIxs, input.user, blockhash, jupiterAlts);

  if (singleTx.serialize().length <= TX_SIZE_LIMIT) {
    return {
      provider: "curve",
      route,
      routeSteps: curveSellRouteSteps(
        route,
        sourceSymbol,
        input.outputMint,
        jupiterQuote,
      ),
      atomic: true,
      txs: [
        {
          label:
            route === "to-jupiter"
              ? "Multi-hop sell"
              : route === "to-usdc"
                ? "Sell + bridge"
                : "Sell",
          tx: singleTx,
          size: singleTx.serialize().length,
        },
      ],
      minOutputQuarks,
      expectedOutput,
      worstUsdfQuarks: usdfWorst,
      jupiterQuote,
    };
  }

  throw new Error(
    `Route is too big to fit in one transaction (${singleTx.serialize().length} bytes). ` +
      `Try a smaller amount or sell to USDF/USDC instead.`,
  );
}

/**
 * Direct-Jupiter sell planner — single Jupiter swap source→output. Returns
 * null if Jupiter has no route or the resulting tx overflows 1232 bytes.
 */
async function planJupiterDirectSell(
  connection: Connection,
  input: MultiHopSellInput,
  sourceSymbol: string,
): Promise<MultiHopSellPlan | null> {
  if (input.sourceMint.equals(input.outputMint)) return null;

  const fee = computeFeeAccount(input.outputMint);
  let jupiterQuote: JupiterQuote;
  try {
    jupiterQuote = await getJupiterQuote({
      inputMint: input.sourceMint.toBase58(),
      outputMint: input.outputMint.toBase58(),
      amount: input.inAmount.toString(),
      slippageBps: input.slippageBps,
      restrictIntermediateTokens: true,
      platformFeeBps: fee?.bps,
      maxAccounts: JUPITER_MAX_ACCOUNTS_DIRECT,
    });
  } catch {
    return null;
  }

  let swapResp: SwapInstructionsResponse;
  try {
    swapResp = await getJupiterSwapInstructions({
      quoteResponse: jupiterQuote,
      userPublicKey: input.user.toBase58(),
      wrapAndUnwrapSol: input.outputMint.equals(SOL_MINT),
      useSharedAccounts: false,
      feeAccount: fee?.ata.toBase58(),
    });
  } catch (e) {
    if (process.env.WIRE_DEBUG)
      console.error("[direct-sell] swap-ix failed:", (e as Error).message);
    return null;
  }
  const ixs = unpackJupiter(swapResp);
  const alts = await fetchAddressLookupTables(
    connection,
    swapResp.addressLookupTableAddresses,
  );

  const sourceAta = getAssociatedTokenAddressSync(
    input.sourceMint,
    input.user,
  );
  const outputAta = getAssociatedTokenAddressSync(
    input.outputMint,
    input.user,
  );
  const ataPairs: Array<readonly [PublicKey, PublicKey]> = [
    [sourceAta, input.sourceMint],
    [outputAta, input.outputMint],
  ];
  if (fee) ataPairs.push([fee.ata, input.outputMint]);
  const setupAtas = await buildAtaSetups(connection, input.user, ataPairs);

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const ixsList: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
    ...ixs.setup,
    ...setupAtas,
    ixs.swap,
    ...(ixs.cleanup ? [ixs.cleanup] : []),
  ];
  const tx = buildV0Tx(ixsList, input.user, blockhash, alts);
  const size = tx.serialize().length;
  if (size > TX_SIZE_LIMIT) return null;

  return {
    provider: "jupiter-direct",
    route: "to-usdf",
    routeSteps: [
      {
        from: sourceSymbol,
        to: symbolOfMint(input.outputMint),
        via: `Jupiter · ${jupiterDexLabel(jupiterQuote)}`,
      },
    ],
    atomic: true,
    txs: [{ label: "Direct swap", tx, size }],
    minOutputQuarks: BigInt(jupiterQuote.otherAmountThreshold),
    expectedOutput: Number(jupiterQuote.outAmount),
    worstUsdfQuarks: 0n,
    jupiterQuote,
  };
}

/**
 * Aggregator: race the curve sell path and the direct-Jupiter sell, return
 * whichever delivers more output. Single-tx and atomic regardless.
 */
export async function planMultiHopSell(
  connection: Connection,
  input: MultiHopSellInput,
  sourceSymbol = "TOKEN",
): Promise<MultiHopSellPlan> {
  const [curvePlan, jupiterPlan] = await Promise.all([
    planCurveSell(connection, input, sourceSymbol),
    planJupiterDirectSell(connection, input, sourceSymbol).catch(() => null),
  ]);
  if (jupiterPlan && jupiterPlan.expectedOutput > curvePlan.expectedOutput) {
    return jupiterPlan;
  }
  return curvePlan;
}

// ─────────────────────────────────────────────────────────────────────
//                              helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Resolve the integrator-fee ATA for a Jupiter-leg output mint, plus the
 * basis-points value to pass alongside in the quote. Returns null when
 * the fee is disabled (env vars unset), in which case Jupiter calls run
 * without `platformFeeBps`/`feeAccount`.
 */
function computeFeeAccount(
  outputMint: PublicKey,
): { ata: PublicKey; bps: number } | null {
  if (!feeEnabled() || !WIRE_FEE_OWNER) return null;
  const ata = getAssociatedTokenAddressSync(outputMint, WIRE_FEE_OWNER);
  return { ata, bps: WIRE_FEE_BPS };
}

/** Resolve a known mint to its symbol, or fall back to a short mint hash. */
function symbolOfMint(mint: PublicKey, fallback?: string): string {
  if (mint.equals(USDF_MINT)) return "USDF";
  if (mint.equals(USDC_MINT)) return "USDC";
  if (mint.equals(SOL_MINT)) return "SOL";
  return fallback ?? mint.toBase58().slice(0, 4);
}

const BRIDGE_VIA = "USDF/USDC bridge · 1:1";
const FLIPCASH_BUY_VIA = "Flipcash curve";
const FLIPCASH_SELL_VIA = "Flipcash curve";

function curveBuyRouteSteps(
  route: HopRoute,
  inputMint: PublicKey,
  targetSymbol: string,
  jupiterQuote: JupiterQuote | null,
): RouteStep[] {
  if (route === "usdf-direct") {
    return [{ from: "USDF", to: targetSymbol, via: FLIPCASH_BUY_VIA }];
  }
  if (route === "usdc-bridge") {
    return [
      { from: "USDC", to: "USDF", via: BRIDGE_VIA },
      { from: "USDF", to: targetSymbol, via: FLIPCASH_BUY_VIA },
    ];
  }
  // jupiter-bridge
  return [
    {
      from: symbolOfMint(inputMint),
      to: "USDC",
      via: jupiterQuote
        ? `Jupiter · ${jupiterDexLabel(jupiterQuote)}`
        : "Jupiter",
    },
    { from: "USDC", to: "USDF", via: BRIDGE_VIA },
    { from: "USDF", to: targetSymbol, via: FLIPCASH_BUY_VIA },
  ];
}

function curveSellRouteSteps(
  route: SellRoute,
  sourceSymbol: string,
  outputMint: PublicKey,
  jupiterQuote: JupiterQuote | null,
): RouteStep[] {
  if (route === "to-usdf") {
    return [{ from: sourceSymbol, to: "USDF", via: FLIPCASH_SELL_VIA }];
  }
  if (route === "to-usdc") {
    return [
      { from: sourceSymbol, to: "USDF", via: FLIPCASH_SELL_VIA },
      { from: "USDF", to: "USDC", via: BRIDGE_VIA },
    ];
  }
  return [
    { from: sourceSymbol, to: "USDF", via: FLIPCASH_SELL_VIA },
    { from: "USDF", to: "USDC", via: BRIDGE_VIA },
    {
      from: "USDC",
      to: symbolOfMint(outputMint),
      via: jupiterQuote
        ? `Jupiter · ${jupiterDexLabel(jupiterQuote)}`
        : "Jupiter",
    },
  ];
}

function pickBuyRoute(inputMint: PublicKey): HopRoute {
  if (inputMint.equals(USDF_MINT)) return "usdf-direct";
  if (inputMint.equals(USDC_MINT)) return "usdc-bridge";
  return "jupiter-bridge";
}

function unpackJupiter(s: SwapInstructionsResponse) {
  return {
    compute: s.computeBudgetInstructions.map(deserializeInstruction),
    setup: s.setupInstructions.map(deserializeInstruction),
    swap: deserializeInstruction(s.swapInstruction),
    cleanup: s.cleanupInstruction
      ? deserializeInstruction(s.cleanupInstruction)
      : null,
  };
}

async function buildAtaSetups(
  connection: Connection,
  payer: PublicKey,
  pairs: ReadonlyArray<readonly [PublicKey, PublicKey]>,
): Promise<TransactionInstruction[]> {
  if (!pairs.length) return [];
  const infos = await connection.getMultipleAccountsInfo(
    pairs.map(([ata]) => ata),
  );
  const out: TransactionInstruction[] = [];
  for (let i = 0; i < pairs.length; i++) {
    if (!infos[i]) {
      const [ata, mint] = pairs[i];
      out.push(
        createAssociatedTokenAccountInstruction(
          payer,
          ata,
          payer,
          mint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      );
    }
  }
  return out;
}

function buildV0Tx(
  ixs: TransactionInstruction[],
  payer: PublicKey,
  blockhash: string,
  alts: AddressLookupTableAccount[],
): VersionedTransaction {
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message(alts);
  return new VersionedTransaction(message);
}
