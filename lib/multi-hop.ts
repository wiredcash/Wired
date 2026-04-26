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
  quoteBuy,
  tokensToMinOutQuarks,
} from "./flipcash";
import {
  SOL_MINT,
  deserializeInstruction,
  fetchAddressLookupTables,
  getJupiterQuote,
  getJupiterSwapInstructions,
  type JupiterQuote,
} from "./jupiter";

export type HopRoute = "usdf-direct" | "usdc-bridge" | "jupiter-bridge";

export type MultiHopBuyInput = {
  user: PublicKey;
  /** Mint of the token the user is paying with. */
  inputMint: PublicKey;
  /** Smallest-units of the input token the user is spending. */
  inAmount: bigint;
  /** Slippage applied independently to each hop, in bps (1% = 100). */
  slippageBps: number;
  /** Flipcash currency mint, pool, vaults, and reserves (from indexer). */
  target: {
    mint: PublicKey;
    pool: PublicKey;
    vaultA: PublicKey;
    vaultB: PublicKey;
    reserveTokenQuarks: bigint;
    reserveUsdfQuarks: bigint;
  };
};

export type MultiHopPlan = {
  route: HopRoute;
  /** Worst-case currency tokens the user will receive (10 decimals). */
  minTokensOutQuarks: bigint;
  /** Best-case currency tokens (used for display). */
  expectedTokensOut: number;
  /** USDF that will hit the user's USDF ATA after the bridge (worst case). */
  worstUsdfQuarks: bigint;
  /** Jupiter quote, if used. */
  jupiterQuote: JupiterQuote | null;
  /** Final composed VersionedTransaction, ready to sign. */
  tx: VersionedTransaction;
  /** Tx size in bytes (post-serialization). */
  txSize: number;
};

const TX_SIZE_LIMIT = 1232;

/**
 * Compose a single multi-hop "buy" transaction:
 *
 *   inputMint  ─Jupiter──▶  USDC  ─bridge──▶  USDF  ─flipcash buy──▶  target
 *
 * Hops can be skipped:
 *   • inputMint == USDF  →  flipcash buy only ("usdf-direct")
 *   • inputMint == USDC  →  bridge + buy        ("usdc-bridge")
 *   • otherwise           →  Jupiter + bridge + buy ("jupiter-bridge")
 *
 * All three legs land in the same Solana transaction → atomic if it fits.
 * If the composed tx exceeds the 1232-byte limit, this throws — callers
 * should fall back to splitting (Jupiter in one tx, bridge+buy in another).
 */
export async function planMultiHopBuy(
  connection: Connection,
  input: MultiHopBuyInput,
): Promise<MultiHopPlan> {
  const route = pickRoute(input.inputMint);

  // Fetch the bridge pool once if we need it.
  const bridgePool: BridgePoolState | null =
    route === "usdf-direct"
      ? null
      : await fetchBridgePool(connection, FLIPCASH_USDF_USDC_POOL);

  // ─── Jupiter leg ─────────────────────────────────────────────────────
  let jupiterQuote: JupiterQuote | null = null;
  let jupiterIxs: {
    compute: TransactionInstruction[];
    setup: TransactionInstruction[];
    swap: TransactionInstruction;
    cleanup: TransactionInstruction | null;
  } | null = null;
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

    const swapIxs = await getJupiterSwapInstructions({
      quoteResponse: jupiterQuote,
      userPublicKey: input.user.toBase58(),
      wrapAndUnwrapSol: input.inputMint.equals(SOL_MINT),
      useSharedAccounts: true,
    });
    jupiterIxs = {
      compute: swapIxs.computeBudgetInstructions.map(deserializeInstruction),
      setup: swapIxs.setupInstructions.map(deserializeInstruction),
      swap: deserializeInstruction(swapIxs.swapInstruction),
      cleanup: swapIxs.cleanupInstruction
        ? deserializeInstruction(swapIxs.cleanupInstruction)
        : null,
    };
    jupiterAlts = await fetchAddressLookupTables(
      connection,
      swapIxs.addressLookupTableAddresses,
    );
  } else if (route === "usdc-bridge") {
    usdcInBest = input.inAmount;
    usdcInWorst = input.inAmount;
  } else {
    // usdf-direct
    usdcInBest = 0n;
    usdcInWorst = 0n;
  }

  // ─── Bridge USDC → USDF (skipped on usdf-direct) ────────────────────
  // The bridge is 1:1 with same decimals (6/6), so USDC quarks == USDF
  // quarks. Use the worst-case as the bridge `amount` so the ix never
  // exceeds the user's USDC balance after Jupiter.
  let usdfInWorst: bigint;
  if (route === "usdf-direct") {
    usdfInWorst = input.inAmount;
  } else {
    usdfInWorst = usdcInWorst;
  }

  // ─── Flipcash buy quote ─────────────────────────────────────────────
  const buyQuoteWorst = quoteBuy(
    input.target.reserveTokenQuarks,
    input.target.reserveUsdfQuarks,
    usdfInWorst,
  );
  const buyQuoteBest = quoteBuy(
    input.target.reserveTokenQuarks,
    input.target.reserveUsdfQuarks,
    route === "jupiter-bridge" ? usdcInBest : usdfInWorst,
  );
  const minTokensOutQuarks = tokensToMinOutQuarks(
    buyQuoteWorst.expectedTokensOut,
    input.slippageBps,
  );

  // ─── ATA pre-instructions ───────────────────────────────────────────
  const targetAta = getAssociatedTokenAddressSync(
    input.target.mint,
    input.user,
  );
  const usdfAta = getAssociatedTokenAddressSync(USDF_BASE_MINT, input.user);
  const usdcAta = getAssociatedTokenAddressSync(USDC_MINT, input.user);

  const ataChecks = [
    [targetAta, input.target.mint] as const,
    [usdfAta, USDF_BASE_MINT] as const,
  ];
  // USDC ATA only needed when the bridge runs (i.e. route != usdf-direct).
  if (route !== "usdf-direct") {
    ataChecks.push([usdcAta, USDC_MINT] as const);
  }
  const ataInfos = await connection.getMultipleAccountsInfo(
    ataChecks.map(([a]) => a),
  );
  const setupAtas: TransactionInstruction[] = [];
  for (let i = 0; i < ataChecks.length; i++) {
    if (!ataInfos[i]) {
      const [ata, mint] = ataChecks[i];
      setupAtas.push(
        createAssociatedTokenAccountInstruction(
          input.user,
          ata,
          input.user,
          mint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      );
    }
  }

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
          /* usdfToOther */ false, // false = OTHER (USDC) → USDF
        );

  // ─── Flipcash buy ix ────────────────────────────────────────────────
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

  // ─── Compose v0 tx ──────────────────────────────────────────────────
  // Layer order:
  //   1. Our compute-budget ixs (fee + CU limit) — sized for all hops
  //   2. Jupiter setup ixs (wSOL ATA, etc.)
  //   3. Our ATA setup ixs (target / USDF / USDC if missing)
  //   4. Jupiter swap
  //   5. Jupiter cleanup (close wSOL)
  //   6. Bridge swap
  //   7. Flipcash buy
  //
  // We omit Jupiter's compute-budget ixs in favor of our own — Solana only
  // honors the *first* compute-budget ix of each kind, and ours sets a
  // CU ceiling that covers all three legs.
  const ixs: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
    ComputeBudgetProgram.setComputeUnitLimit({
      units: route === "jupiter-bridge" ? 600_000 : 250_000,
    }),
  ];
  if (jupiterIxs) ixs.push(...jupiterIxs.setup);
  ixs.push(...setupAtas);
  if (jupiterIxs) ixs.push(jupiterIxs.swap);
  if (jupiterIxs?.cleanup) ixs.push(jupiterIxs.cleanup);
  if (bridgeIx) ixs.push(bridgeIx);
  ixs.push(buyIx);

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: input.user,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message(jupiterAlts);

  const tx = new VersionedTransaction(message);
  const serialized = tx.serialize();
  const txSize = serialized.length;

  if (txSize > TX_SIZE_LIMIT) {
    throw new Error(
      `Composed tx is ${txSize} bytes, exceeds ${TX_SIZE_LIMIT} limit. ` +
        `Try a smaller amount or a more direct token (USDC) so the Jupiter ` +
        `route is leaner.`,
    );
  }

  return {
    route,
    minTokensOutQuarks,
    expectedTokensOut: buyQuoteBest.expectedTokensOut,
    worstUsdfQuarks: usdfInWorst,
    jupiterQuote,
    tx,
    txSize,
  };
}

function pickRoute(inputMint: PublicKey): HopRoute {
  if (inputMint.equals(USDF_MINT)) return "usdf-direct";
  if (inputMint.equals(USDC_MINT)) return "usdc-bridge";
  return "jupiter-bridge";
}
