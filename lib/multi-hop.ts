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
  type JupiterQuote,
  type SwapInstructionsResponse,
} from "./jupiter";

export type HopRoute = "usdf-direct" | "usdc-bridge" | "jupiter-bridge";
export type SellRoute = "to-usdf" | "to-usdc" | "to-jupiter";

const TX_SIZE_LIMIT = 1232;

export type SignableStep = {
  /** Short label for UI progress: "Jupiter swap", "Bridge + buy", etc. */
  label: string;
  tx: VersionedTransaction;
  size: number;
};

export type MultiHopBuyPlan = {
  route: HopRoute;
  /** True if everything fits in a single tx → atomic. */
  atomic: boolean;
  txs: SignableStep[];
  /** Worst-case currency tokens the user will receive (10 decimals). */
  minTokensOutQuarks: bigint;
  /** Best-case currency tokens (display). */
  expectedTokensOut: number;
  /** USDF that will hit the user's USDF ATA after the bridge (worst case). */
  worstUsdfQuarks: bigint;
  jupiterQuote: JupiterQuote | null;
};

export type MultiHopSellPlan = {
  route: SellRoute;
  atomic: boolean;
  txs: SignableStep[];
  /** Worst-case output (in the user's chosen output mint's smallest units). */
  minOutputQuarks: bigint;
  /** Best-case output for display. */
  expectedOutput: number;
  /** USDF the user will have after the flipcash sell (worst case). */
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

export async function planMultiHopBuy(
  connection: Connection,
  input: MultiHopBuyInput,
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
    jupiterQuote = await getJupiterQuote({
      inputMint: input.inputMint.toBase58(),
      outputMint: USDC_MINT.toBase58(),
      amount: input.inAmount.toString(),
      slippageBps: input.slippageBps,
      restrictIntermediateTokens: true,
    });
    usdcInBest = BigInt(jupiterQuote.outAmount);
    usdcInWorst = BigInt(jupiterQuote.otherAmountThreshold);

    jupiterSwap = await getJupiterSwapInstructions({
      quoteResponse: jupiterQuote,
      userPublicKey: input.user.toBase58(),
      wrapAndUnwrapSol: input.inputMint.equals(SOL_MINT),
      useSharedAccounts: true,
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

  const setupAtas = await buildAtaSetups(
    connection,
    input.user,
    [
      [targetAta, input.target.mint],
      [usdfAta, USDF_BASE_MINT],
      ...(route === "usdf-direct"
        ? []
        : ([[usdcAta, USDC_MINT]] as const)),
    ],
  );

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
      route,
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

  // Single tx too big → split. Only happens on jupiter-bridge route.
  if (route !== "jupiter-bridge" || !jupiterIxs || !bridgeIx) {
    throw new Error(
      `Composed tx is ${singleTx.serialize().length} bytes, exceeds ${TX_SIZE_LIMIT} limit. ` +
        `Try a smaller amount.`,
    );
  }

  // TX1 — Jupiter only (use Jupiter's own compute budget, its setups,
  // its swap, and its cleanup). Lands USDC in the user's USDC ATA.
  const tx1Ixs: TransactionInstruction[] = [
    ...jupiterIxs.compute,
    ...jupiterIxs.setup,
    jupiterIxs.swap,
    ...(jupiterIxs.cleanup ? [jupiterIxs.cleanup] : []),
  ];
  const tx1 = buildV0Tx(tx1Ixs, input.user, blockhash, jupiterAlts);

  // TX2 — bridge + flipcash buy. Uses worst-case USDC delivered by TX1.
  const tx2Ixs: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }),
    ...setupAtas,
    bridgeIx,
    buyIx,
  ];
  const tx2 = buildV0Tx(tx2Ixs, input.user, blockhash, []);

  return {
    route,
    atomic: false,
    txs: [
      { label: "Jupiter swap", tx: tx1, size: tx1.serialize().length },
      { label: "Bridge + buy", tx: tx2, size: tx2.serialize().length },
    ],
    minTokensOutQuarks,
    expectedTokensOut: buyQuoteBest.expectedTokensOut,
    worstUsdfQuarks: usdfInWorst,
    jupiterQuote,
  };
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

export async function planMultiHopSell(
  connection: Connection,
  input: MultiHopSellInput,
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
    jupiterQuote = await getJupiterQuote({
      inputMint: USDC_MINT.toBase58(),
      outputMint: input.outputMint.toBase58(),
      amount: usdfWorst.toString(),
      slippageBps: input.slippageBps,
      restrictIntermediateTokens: true,
    });
    jupiterSwap = await getJupiterSwapInstructions({
      quoteResponse: jupiterQuote,
      userPublicKey: input.user.toBase58(),
      wrapAndUnwrapSol: input.outputMint.equals(SOL_MINT),
      useSharedAccounts: true,
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

  const setupAtas = await buildAtaSetups(
    connection,
    input.user,
    [
      [sourceAta, input.sourceMint],
      [usdfAta, USDF_BASE_MINT],
      ...(route === "to-usdf"
        ? []
        : ([[usdcAta, USDC_MINT]] as const)),
    ],
  );

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
      route,
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

  if (route !== "to-jupiter" || !jupiterIxs || !bridgeIx) {
    throw new Error(
      `Composed tx is ${singleTx.serialize().length} bytes, exceeds ${TX_SIZE_LIMIT} limit. ` +
        `Try a smaller amount.`,
    );
  }

  // TX1 — flipcash sell + bridge USDF→USDC. Lands USDC in the user's ATA.
  const tx1Ixs: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }),
    ...setupAtas,
    sellIx,
    bridgeIx,
  ];
  const tx1 = buildV0Tx(tx1Ixs, input.user, blockhash, []);

  // TX2 — Jupiter swap (USDC → output mint).
  const tx2Ixs: TransactionInstruction[] = [
    ...jupiterIxs.compute,
    ...jupiterIxs.setup,
    jupiterIxs.swap,
    ...(jupiterIxs.cleanup ? [jupiterIxs.cleanup] : []),
  ];
  const tx2 = buildV0Tx(tx2Ixs, input.user, blockhash, jupiterAlts);

  return {
    route,
    atomic: false,
    txs: [
      { label: "Sell + bridge", tx: tx1, size: tx1.serialize().length },
      { label: "Jupiter swap", tx: tx2, size: tx2.serialize().length },
    ],
    minOutputQuarks,
    expectedOutput,
    worstUsdfQuarks: usdfWorst,
    jupiterQuote,
  };
}

// ─────────────────────────────────────────────────────────────────────
//                              helpers
// ─────────────────────────────────────────────────────────────────────

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
