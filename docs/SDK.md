# SDK reference

Two zero-dependency-on-Anchor TS SDKs ship with Wire. Both work in Node and
the browser. They take a `Connection` and a public key, return instructions
or decoded state, and don't reach for any global / window state.

```
lib/usdf-swap   →  USDF ↔ USDC bridge (1:1 swaps)
lib/flipcash    →  Buy / sell Flipcash currencies on the bonding curve
```

## `lib/usdf-swap`

### Constants

```ts
import {
  USDF_SWAP_PROGRAM_ID,    // usdfcP2V1bh1Lz7Y87pxR4zJd3wnVtssJ6GeSHFeZeu
  USDF_MINT,               // 5AMAA9JV9H97YYVxx8F6FsCMmTwXSuTTQneiup4RYAUQ
  USDC_MINT,               // EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
  FLIPCASH_USDF_USDC_POOL, // canonical Flipcash bridge pool
  MAX_SWAP_DOLLARS,        // 2000 — per-tx ceiling enforced on-chain
} from "wire/lib/usdf-swap";
```

### PDAs

```ts
import { findPoolPda, findVaultPda } from "wire/lib/usdf-swap";

const [pool, bump]   = findPoolPda(authority, "usdf-usdc-0", USDF_MINT, USDC_MINT);
const [vault, vBump] = findVaultPda(pool, USDC_MINT);
```

### Pool state

```ts
import { fetchPoolState, decodePoolAccount } from "wire/lib/usdf-swap";

const pool = await fetchPoolState(connection, FLIPCASH_USDF_USDC_POOL);
//   ↳  { authority, name, usdfMint, otherMint, usdfVault, otherVault,
//        usdfDecimals, otherDecimals, ... }
```

### Build & send a swap

The high-level `loadAndPlanSwap` returns everything you need: it fetches the
pool, computes ATAs, prepends an `AssociatedTokenAccount` create ix if the
user doesn't have one yet, and returns the swap instruction.

```ts
import { loadAndPlanSwap, FLIPCASH_USDF_USDC_POOL } from "wire/lib/usdf-swap";

const plan = await loadAndPlanSwap(
  connection,
  FLIPCASH_USDF_USDC_POOL,
  signer.publicKey,
  1_000_000n,    // 1 USDF in quarks (6 decimals)
  true,          // usdfToOther = true → USDF → USDC
);

// plan.preInstructions: TransactionInstruction[] — ATA creates if needed
// plan.swapIx:          TransactionInstruction
// plan.expectedOutput:  bigint — destination quarks the user expects
// plan.userUsdfAta:     PublicKey
// plan.userOtherAta:    PublicKey

const tx = new Transaction().add(...plan.preInstructions, plan.swapIx);
await sendAndConfirmTransaction(connection, tx, [signer]);
```

If you want to do this without an active connection (e.g. precompute a tx),
use `planSwap(connection, pool, user, inputAmount, usdfToOther)` directly.

### Lower-level builder

```ts
import { buildSwapIx } from "wire/lib/usdf-swap";

const ix = buildSwapIx(
  {
    user: signer.publicKey,
    pool: pool.address,
    usdfVault: pool.usdfVault,
    otherVault: pool.otherVault,
    userUsdfToken: usdfAta,
    userOtherToken: usdcAta,
  },
  1_000_000n,    // amount in source quarks
  true,          // usdfToOther
);
```

## `lib/flipcash`

### Constants

```ts
import {
  FLIPCASH_PROGRAM_ID,     // ccJYP5gjZqcEHaphcxAZvkxCrnTVfYMjyhSYkpQtf8Z
  USDF_BASE_MINT,          // same USDF as the bridge
  TOKEN_DECIMALS,          // 10 — Flipcash currency decimals
  QUARKS_PER_TOKEN,        // 10n ** 10n
  MAX_TOKEN_SUPPLY,        // 21,000,000n
  USDF_DECIMALS,           // 6
} from "wire/lib/flipcash";
```

### PDAs

```ts
import { findCurrencyPda, findPoolPda, findVaultPda, findMetadataPda } from "wire/lib/flipcash";

const [currency] = findCurrencyPda(mint);              // ["currency", mint]
const [pool]     = findPoolPda(currency);              // ["pool",     currency]
const [vaultA]   = findVaultPda(pool, mint);           // ["treasury", pool, target_mint]
const [vaultB]   = findVaultPda(pool, USDF_BASE_MINT); // ["treasury", pool, USDF]
const [meta]     = findMetadataPda(mint);              // Metaplex metadata PDA
```

### State decoders

```ts
import { decodeCurrencyConfig, decodeLiquidityPool } from "wire/lib/flipcash";

const c = decodeCurrencyConfig(addr, accountData);
//   ↳ { authority, mint, name, symbol, seed, ... }
const p = decodeLiquidityPool(addr, accountData);
//   ↳ { currency, mintA (target), mintB (USDF), vaultA, vaultB,
//       sellFeeBps, feesAccumulated, ... }
```

### Indexing all currencies

```ts
import { indexCurrencies } from "wire/lib/flipcash/index-currencies";

const items = await indexCurrencies(connection, rpcUrl);
//   ↳ Array<IndexedCurrency> with mint, symbol, name, image, pool,
//     vaultA, vaultB, reserveTokenQuarks, reserveUsdfQuarks, ...
//     sorted by USDF reserve depth (largest first)
```

This is the core of the `/api/currencies` route. It fetches all
`CurrencyConfig` and `LiquidityPool` accounts, all 210 vault balances, and
batched Metaplex metadata — in parallel.

### Quoting

The continuous-curve approximation lives in `lib/flipcash/curve.ts`. For most
UI use cases you want `quoteBuy`:

```ts
import { quoteBuy, tokensToMinOutQuarks } from "wire/lib/flipcash";

const quote = quoteBuy(
  BigInt(currency.reserveTokenQuarks),
  BigInt(currency.reserveUsdfQuarks),
  5_000_000n,   // 5 USDF in quarks
);

// quote.expectedTokensOut:    number  — display tokens (10-dec aware)
// quote.spotPriceUsdf:        number  — spot at current supply
// quote.effectivePriceUsdf:   number  — averaged for this purchase
// quote.priceImpact:          number  — (effective / spot) - 1
// quote.marketCapUsdf:        number  — sold supply at spot
// quote.soldTokens:           number  — tokens already in circulation
// quote.reserveUsdf:          number  — USDF in pool

const minOut = tokensToMinOutQuarks(
  quote.expectedTokensOut,
  /*slippageBps*/ 100,   // 1%
);
```

### Buy

```ts
import { planBuy } from "wire/lib/flipcash";

const plan = await planBuy(connection, {
  buyer: signer.publicKey,
  pool:        new PublicKey(currency.pool),
  targetMint:  new PublicKey(currency.mint),
  vaultA:      new PublicKey(currency.vaultA),
  vaultB:      new PublicKey(currency.vaultB),
  inAmountUsdfQuarks: 5_000_000n,
  minAmountOutQuarks: minOut,
});

const tx = new Transaction().add(...plan.preInstructions, plan.buyIx);
await sendAndConfirmTransaction(connection, tx, [signer]);
```

### Lower-level builders

```ts
import { buildBuyTokensIx, buildSellTokensIx } from "wire/lib/flipcash";
```

Both take an `accounts` object and `(inAmount, minAmountOut)` as `bigint`.
`buildSellTokensIx` is included in the SDK but the UI does not yet expose it.

## Curve math (expert)

```ts
import { spotPrice, tokensToValue, valueToTokens, marketCapUsdf, MAX_SUPPLY_TOKENS } from "wire/lib/flipcash";

spotPrice(0);              // 0.01
spotPrice(21_000_000);     // ~1_000_000
tokensToValue(0, 1_000);   // USDF cost to buy first 1k tokens
valueToTokens(0, 100);     // tokens for $100 starting at supply 0
```

These operate on **whole tokens** (display units, not quarks), in `number`.
Floating-point error is below 1 part in 10⁹ for any input within the curve's
domain. For exact on-chain semantics, use `simulateTransaction` against a
funded account.

## Error handling

All SDK functions throw on RPC failure; the UI catches at the boundary
(`Bridge.tsx` / `Swap.tsx`). A few common cases:

- **`Pool ... not found`** — wrong network or wrong pool address.
- **Custom program errors** — surfaced via the standard
  `SendTransactionError` from `@solana/web3.js`. Look at `tx.meta.logMessages`
  in a `getTransaction` to see the program's `msg!` output.
- **Liquidity exhausted** — the bridge UI hard-validates against the
  destination vault's balance before letting the user submit; in scripts you
  should do the same. See `scripts/swap.ts` for the pattern.
