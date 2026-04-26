import {
  AccountMeta,
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";

export const SOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112",
);

export type JupiterQuote = {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  /**
   * Worst-case output (after slippage). Use this as the planning amount for
   * downstream legs that depend on Jupiter's output landing in a token
   * account.
   */
  otherAmountThreshold: string;
  swapMode: "ExactIn" | "ExactOut";
  slippageBps: number;
  priceImpactPct: string;
  routePlan: unknown[];
  contextSlot?: number;
  timeTaken?: number;
};

export type SerializedInstruction = {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string; // base64
};

export type SwapInstructionsResponse = {
  tokenLedgerInstruction?: SerializedInstruction;
  computeBudgetInstructions: SerializedInstruction[];
  setupInstructions: SerializedInstruction[];
  swapInstruction: SerializedInstruction;
  cleanupInstruction?: SerializedInstruction;
  addressLookupTableAddresses: string[];
  prioritizationFeeLamports?: number;
};

export type QuoteOptions = {
  inputMint: string;
  outputMint: string;
  amount: string | bigint;
  slippageBps: number;
  /** Restrict to direct routes; smaller tx, fewer hops, often worse rate. */
  onlyDirectRoutes?: boolean;
  /**
   * Restrict intermediate tokens. When chaining into our bridge (which
   * needs USDC), a quote with `restrictIntermediateTokens=true` produces a
   * leaner instruction set that's more likely to fit in a single tx.
   */
  restrictIntermediateTokens?: boolean;
};

/**
 * Base URL for the Jupiter proxy. Empty in the browser (relative path
 * goes to the same origin); Node scripts can pass an absolute URL.
 */
function proxyBase(): string {
  if (typeof window !== "undefined") return "";
  return process.env.WIRE_PROXY_BASE ?? "http://localhost:3127";
}

export async function getJupiterQuote(
  opts: QuoteOptions,
): Promise<JupiterQuote> {
  const search = new URLSearchParams({
    inputMint: opts.inputMint,
    outputMint: opts.outputMint,
    amount: opts.amount.toString(),
    slippageBps: opts.slippageBps.toString(),
  });
  if (opts.onlyDirectRoutes) search.set("onlyDirectRoutes", "true");
  if (opts.restrictIntermediateTokens)
    search.set("restrictIntermediateTokens", "true");

  const r = await fetch(
    `${proxyBase()}/api/jupiter/quote?${search.toString()}`,
    { cache: "no-store" },
  );
  const text = await r.text();
  if (!r.ok) throw new Error(`Jupiter quote: ${text}`);
  return JSON.parse(text) as JupiterQuote;
}

export type SwapInstructionsBody = {
  quoteResponse: JupiterQuote;
  userPublicKey: string;
  /** Auto-create + close wSOL ATA when input/output is SOL. */
  wrapAndUnwrapSol?: boolean;
  /** Cuts tx size at the cost of slightly fewer routes. */
  useSharedAccounts?: boolean;
  /** Lamports per CU. We layer our own compute-budget on top. */
  computeUnitPriceMicroLamports?: number;
  asLegacyTransaction?: boolean;
  /**
   * Skip Jupiter's built-in compute-budget ix; we add our own at the tx
   * level so the multi-hop tx fee is right-sized for all three legs.
   */
  skipUserAccountsRpcCalls?: boolean;
};

export async function getJupiterSwapInstructions(
  body: SwapInstructionsBody,
): Promise<SwapInstructionsResponse> {
  const r = await fetch(`${proxyBase()}/api/jupiter/swap-instructions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Jupiter swap-instructions: ${text}`);
  return JSON.parse(text) as SwapInstructionsResponse;
}

export function deserializeInstruction(
  ix: SerializedInstruction,
): TransactionInstruction {
  const keys: AccountMeta[] = ix.accounts.map((a) => ({
    pubkey: new PublicKey(a.pubkey),
    isSigner: a.isSigner,
    isWritable: a.isWritable,
  }));
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys,
    data: Buffer.from(ix.data, "base64"),
  });
}

export async function fetchAddressLookupTables(
  connection: Connection,
  addresses: string[],
): Promise<AddressLookupTableAccount[]> {
  if (!addresses.length) return [];
  const keys = addresses.map((a) => new PublicKey(a));
  const infos = await connection.getMultipleAccountsInfo(keys);
  const tables: AddressLookupTableAccount[] = [];
  for (let i = 0; i < keys.length; i++) {
    const info = infos[i];
    if (!info) continue;
    tables.push(
      new AddressLookupTableAccount({
        key: keys[i],
        state: AddressLookupTableAccount.deserialize(info.data),
      }),
    );
  }
  return tables;
}
