# SDK reference

Four runtime-agnostic TS modules ship with Wired. They take a `Connection`
and a public key, return instructions or decoded state, and don't reach for
window/global state — usable from any Node, Bun, or browser environment.

```
lib/usdf-swap     →  USDF ↔ USDC bridge SDK (1:1 swaps)
lib/flipcash      →  Flipcash currency SDK (curve buy/sell + quoting)
lib/jupiter       →  Jupiter quote + swap-instructions client (via /api proxy)
lib/multi-hop     →  Aggregator — races curve vs Jupiter, builds single-tx plans
```

A small companion module `lib/confirm.ts` provides polling-based tx
confirmation (no WebSocket subscriptions).

---

## `lib/multi-hop` — the aggregator

The high-level entry point most code should use.

### `planMultiHopBuy(connection, input, targetSymbol?)`

Races a curve-only path and a direct-Jupiter path; returns the better one as
a single-tx plan.

```ts
import { planMultiHopBuy } from "wired/lib/multi-hop";

const plan = await planMultiHopBuy(
  connection,
  {
    user: signer.publicKey,
    inputMint: USDC_MINT,
    inAmount: 1_000_000n,         // 1 USDC
    slippageBps: 100,             // 1%
    target: {
      mint: new PublicKey(target.mint),
      pool: new PublicKey(target.pool),
      vaultA: new PublicKey(target.vaultA),
      vaultB: new PublicKey(target.vaultB),
      reserveTokenQuarks: BigInt(target.reserveTokenQuarks),
      reserveUsdfQuarks: BigInt(target.reserveUsdfQuarks),
    },
  },
  "JFY",
);

// plan: MultiHopBuyPlan {
//   provider: "curve" | "jupiter-direct"
//   route: HopRoute                      // existing curve sub-classification
//   routeSteps: RouteStep[]              // for UI display
//   atomic: boolean                      // always true today
//   txs: SignableStep[]                  // length 1
//   minTokensOutQuarks: bigint           // worst-case after slippage
//   expectedTokensOut: number            // best-case (display)
//   worstUsdfQuarks: bigint              // 0n for jupiter-direct
//   jupiterQuote: JupiterQuote | null
// }
```

`SignableStep`:

```ts
type SignableStep = { label: string; tx: VersionedTransaction; size: number };
```

The plan's `txs` array always has exactly one entry today — the aggregator
throws if the composed tx exceeds 1232 bytes rather than splitting into
multiple signatures.

### `planMultiHopSell(connection, input, sourceSymbol?)`

Symmetric. Returns `MultiHopSellPlan` with the same shape but
`minOutputQuarks` / `expectedOutput` keyed to the user's chosen output mint.

### Sending the result

```ts
plan.txs[0].tx.sign([signer]);
const sig = await connection.sendRawTransaction(plan.txs[0].tx.serialize());
import { confirmSignaturePolling } from "wired/lib/confirm";
await confirmSignaturePolling(connection, sig, { desiredCommitment: "confirmed" });
```

### `RouteStep`

```ts
type RouteStep = {
  from: string;   // "USDF" | "USDC" | "SOL" | currency symbol | mint short
  to: string;
  via: string;    // "Flipcash curve" | "USDF/USDC bridge · 1:1" | "Jupiter · Meteora DAMM v2"
};
```

---

## `lib/usdf-swap`

### Constants

```ts
import {
  USDF_SWAP_PROGRAM_ID,    // usdfcP2V1bh1Lz7Y87pxR4zJd3wnVtssJ6GeSHFeZeu
  USDF_MINT,               // 5AMAA9JV9H97YYVxx8F6FsCMmTwXSuTTQneiup4RYAUQ
  USDC_MINT,               // EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
  FLIPCASH_USDF_USDC_POOL, // canonical bridge pool
  MAX_SWAP_DOLLARS,        // 2000 — per-tx ceiling enforced on-chain
} from "wired/lib/usdf-swap";
```

### PDAs

```ts
import { findPoolPda, findVaultPda } from "wired/lib/usdf-swap";

const [pool]  = findPoolPda(authority, "usdf-usdc-0", USDF_MINT, USDC_MINT);
const [vault] = findVaultPda(pool, USDC_MINT);
```

### Pool state

```ts
import { fetchPoolState } from "wired/lib/usdf-swap";

const pool = await fetchPoolState(connection, FLIPCASH_USDF_USDC_POOL);
// { authority, name, usdfMint, otherMint, usdfVault, otherVault,
//   usdfDecimals, otherDecimals, ... }
```

### Plan & send a swap

```ts
import { loadAndPlanSwap, FLIPCASH_USDF_USDC_POOL } from "wired/lib/usdf-swap";

const plan = await loadAndPlanSwap(
  connection,
  FLIPCASH_USDF_USDC_POOL,
  signer.publicKey,
  1_000_000n,    // 1 USDF in quarks
  true,          // usdfToOther = true → USDF → USDC
);
// plan.preInstructions, plan.swapIx, plan.expectedOutput, plan.userUsdfAta, plan.userOtherAta

const tx = new Transaction().add(...plan.preInstructions, plan.swapIx);
await sendAndConfirmTransaction(connection, tx, [signer]);
```

### Lower-level builder

```ts
import { buildSwapIx } from "wired/lib/usdf-swap";

const ix = buildSwapIx(
  {
    user: signer.publicKey,
    pool: pool.address,
    usdfVault: pool.usdfVault,
    otherVault: pool.otherVault,
    userUsdfToken: usdfAta,
    userOtherToken: usdcAta,
  },
  1_000_000n,
  true,
);
```

---

## `lib/flipcash`

### Constants

```ts
import {
  FLIPCASH_PROGRAM_ID,     // ccJYP5gjZqcEHaphcxAZvkxCrnTVfYMjyhSYkpQtf8Z
  USDF_BASE_MINT,          // = USDF_MINT
  TOKEN_DECIMALS,          // 10
  QUARKS_PER_TOKEN,        // 10n ** 10n
  MAX_TOKEN_SUPPLY,        // 21_000_000n
  USDF_DECIMALS,           // 6
} from "wired/lib/flipcash";
```

### PDAs

```ts
import { findCurrencyPda, findPoolPda, findVaultPda, findMetadataPda } from "wired/lib/flipcash";

const [currency] = findCurrencyPda(mint);              // ["currency", mint]
const [pool]     = findPoolPda(currency);              // ["pool",     currency]
const [vaultA]   = findVaultPda(pool, mint);           // ["treasury", pool, target_mint]
const [vaultB]   = findVaultPda(pool, USDF_BASE_MINT); // ["treasury", pool, USDF]
const [meta]     = findMetadataPda(mint);              // Metaplex
```

### State decoders

```ts
import { decodeCurrencyConfig, decodeLiquidityPool } from "wired/lib/flipcash";

const c = decodeCurrencyConfig(addr, accountData);
//   ↳ { authority, mint, name, symbol, seed, ... }
const p = decodeLiquidityPool(addr, accountData);
//   ↳ { currency, mintA, mintB, vaultA, vaultB, sellFeeBps, feesAccumulated, ... }
```

### Indexing all currencies

```ts
import { indexCurrencies } from "wired/lib/flipcash/index-currencies";

const items = await indexCurrencies(connection, rpcUrl);
// IndexedCurrency[] — sorted by USDF reserve depth (largest first).
```

This is what `/api/currencies` runs server-side. Browser code should hit
that route instead of importing this directly (the route caches for 60s).

### Quoting

```ts
import { quoteBuy, quoteSell, tokensToMinOutQuarks, usdfToMinOutQuarks } from "wired/lib/flipcash";

const buy = quoteBuy(reserveTokenQuarks, reserveUsdfQuarks, inUsdfQuarks);
// { soldTokens, reserveUsdf, spotPriceUsdf, marketCapUsdf,
//   expectedTokensOut, effectivePriceUsdf, priceImpact }

const sell = quoteSell(reserveTokenQuarks, reserveUsdfQuarks, inTokenQuarks, sellFeeBps);
// { ..., expectedUsdfOut, grossUsdfOut, feeUsdfPaid, ... }

const minTokens = tokensToMinOutQuarks(buy.expectedTokensOut, /* slippageBps */ 100);
const minUsdf   = usdfToMinOutQuarks(sell.expectedUsdfOut, 100);
```

### Curve math (expert)

```ts
import { spotPrice, tokensToValue, valueToTokens, marketCapUsdf, MAX_SUPPLY_TOKENS } from "wired/lib/flipcash";

spotPrice(0);              // 0.01
spotPrice(21_000_000);     // ~1_000_000
tokensToValue(0, 1_000);   // USDF cost to buy first 1k tokens
valueToTokens(0, 100);     // tokens for $100 starting at supply 0
```

These operate on **whole tokens** (display units, not quarks), in `number`.
Floating-point error is below 1 part in 10⁹ for any input within the curve's
domain. For exact on-chain semantics, use `simulateTransaction` against a
funded account.

### Lower-level builders

```ts
import { buildBuyTokensIx, buildSellTokensIx } from "wired/lib/flipcash";
```

Both take an accounts struct and `(inAmount, minAmountOut)` as `bigint`.

### `planBuy` / `planSell`

Single-route helpers used internally by `planCurveBuy`/`planCurveSell`. Most
callers should use `planMultiHopBuy/Sell` from `lib/multi-hop` for the
aggregator behavior.

```ts
import { planBuy, planSell } from "wired/lib/flipcash";

const plan = await planBuy(connection, { buyer, pool, targetMint, vaultA, vaultB, inAmountUsdfQuarks, minAmountOutQuarks });
// { preInstructions, buyIx, buyerTargetAta, buyerBaseAta }
```

---

## `lib/jupiter`

Thin client over our `/api/jupiter/*` proxy routes. The proxy holds
`JUPITER_API_KEY` server-side; this module never sees it.

### Quote

```ts
import { getJupiterQuote } from "wired/lib/jupiter";

const quote = await getJupiterQuote({
  inputMint: USDC_MINT.toBase58(),
  outputMint: targetMint.toBase58(),
  amount: 1_000_000n,
  slippageBps: 100,
  restrictIntermediateTokens: true,
  platformFeeBps: 100,
  maxAccounts: 48,
});

// JupiterQuote {
//   inAmount, outAmount, otherAmountThreshold, slippageBps,
//   priceImpactPct, routePlan: JupiterRoutePlan[], ...
// }
```

`maxAccounts` matters — we cap it at 28 for routes embedded in the curve
path (Jupiter is one leg of three) and 48 for direct routes (Jupiter is the
only program). Lower values force shorter routes and smaller txs.

### Swap instructions

```ts
import { getJupiterSwapInstructions, deserializeInstruction, fetchAddressLookupTables } from "wired/lib/jupiter";

const swap = await getJupiterSwapInstructions({
  quoteResponse: quote,
  userPublicKey: signer.publicKey.toBase58(),
  wrapAndUnwrapSol: true,
  useSharedAccounts: false,    // some "Simple AMMs" reject this
  feeAccount: feeAta.toBase58(),
});
// { computeBudgetInstructions, setupInstructions, swapInstruction, cleanupInstruction?, addressLookupTableAddresses, ... }

const swapIx = deserializeInstruction(swap.swapInstruction);
const alts   = await fetchAddressLookupTables(connection, swap.addressLookupTableAddresses);
```

### Route label

```ts
import { jupiterDexLabel } from "wired/lib/jupiter";

jupiterDexLabel(quote);   // "Meteora DAMM v2" or "Raydium AMM v4 + Orca Whirlpool"
```

### Fee config

```ts
import { WIRE_FEE_OWNER, WIRE_FEE_BPS, feeEnabled } from "wired/lib/jupiter/fee";
```

Reads `NEXT_PUBLIC_WIRE_FEE_OWNER` / `NEXT_PUBLIC_WIRE_FEE_BPS`. Returns
`null` / `0` when unset. The multi-hop builder uses this to decide whether
to pass `platformFeeBps` to Jupiter and which fee ATA to wire up.

---

## `lib/confirm`

```ts
import { confirmSignaturePolling } from "wired/lib/confirm";

await confirmSignaturePolling(connection, signature, {
  desiredCommitment: "confirmed",   // default
  timeoutMs: 60_000,
  pollIntervalMs: 1_000,
});
```

Throws on tx-level errors (`status.err != null`) and on timeout. Used in
place of `connection.confirmTransaction` on serverless hosts where
WebSocket subscriptions don't work.

---

## Error handling

All SDK functions throw on RPC failure; the UI catches at the boundary
(`Swap.tsx` / `Bridge.tsx` via `enrichTxError`). A few common cases:

- **`Pool ... not found`** — wrong network or wrong pool address.
- **Custom program errors** — surfaced via the standard `SendTransactionError`
  from `@solana/web3.js`. Look at `tx.meta.logMessages` in a `getTransaction`
  to see the program's `msg!` output. `enrichTxError` extracts the first
  `Program log:` line and prepends the step label.
- **Liquidity exhausted** — `Bridge` and `Swap` validate the destination
  vault's balance before letting the user submit, surfacing
  *"Bridge out of USDC — try selling to USDF"* etc.
- **Jupiter `Simple AMMs are not supported with shared accounts`** — set
  `useSharedAccounts: false` in `getJupiterSwapInstructions` (the multi-hop
  builder already does this for direct routes).
