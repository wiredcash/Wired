# Architecture

Wire is a thin client over two Solana programs. There is no backend database
and no off-chain order book — the UI reads program-account state, computes
everything client-side, and asks the user's wallet to sign instructions
generated locally.

## Two on-chain programs

| Program | ID | Purpose |
| --- | --- | --- |
| `usdf-swap-program` | `usdfcP2V1bh1Lz7Y87pxR4zJd3wnVtssJ6GeSHFeZeu` | 1:1 USDF↔USDC swaps |
| `flipcash-program`  | `ccJYP5gjZqcEHaphcxAZvkxCrnTVfYMjyhSYkpQtf8Z` | Bonding-curve buys/sells of Flipcash currencies, denominated in USDF |

USDF is the base currency in both. The bridge lets users move dollars in/out
as USDC; the Flipcash program then sells/buys ~100 distinct currencies
against that USDF base.

```
        ┌───────────┐    USDF↔USDC     ┌───────────────────┐
USDC ──▶│  Bridge   │──────────────────│ usdf-swap-program │
        │  (1:1)    │                  │  pool 8q2Kv6w...  │
        └───────────┘                  └───────────────────┘
                                              │
                                            USDF
                                              │
                                              ▼
        ┌───────────┐    USDF→token    ┌───────────────────┐
   You ─│   Swap    │──────────────────│  flipcash-program │
        │ (curve)   │                  │ ~100 pools, each  │
        └───────────┘                  │ with its own curve│
                                       └───────────────────┘
```

## Repository layout

The full file tree is in the [README](../README.md). The pieces that matter:

- `lib/usdf-swap/` and `lib/flipcash/` — runtime-agnostic SDKs (Node + browser).
- `app/` — Next.js App Router. UI is client-rendered; one server route at
  `/api/currencies` does the indexing (see below).
- `components/` — React UI. The `Bridge` and `Swap` components are siblings
  inside a `ModeSwitcher`; the picker and pool strip are shared infra.
- `scripts/` — CLI runners that import the SDKs directly. Useful for
  one-off operations and as integration tests.

## Instruction encoding

Both programs are written with [Steel](https://github.com/regolith-labs/steel)
and use C-style fixed-size, single-byte-discriminator instruction layouts —
**not** Anchor's 8-byte sighash. The SDKs encode instructions by hand:

```
swap         → [u8 disc=2][u64 amount LE][u8 usdf_to_other]
buy_tokens   → [u8 disc=4][u64 in_amount LE][u8 0×7][u64 min_amount_out LE]
```

Account state is also `repr(C)` with a fixed 8-byte discriminator prefix and
known offsets per field. The decoders in `lib/*/state.ts` (or `pool.ts`) read
fields directly. This is faster, smaller, and easier to audit than wiring
Anchor — and the program won't change shape underneath you, since the layout
is part of the on-chain ABI.

## Indexing currencies

```
GET /api/currencies
─────▶ getProgramAccounts(flipcash, dataSize=152)   // 106 currencies
─────▶ getProgramAccounts(flipcash, dataSize=216)   // 105 pools
─────▶ Helius DAS getAssetBatch (×2)                // logos / names / desc
─────▶ getMultipleAccountsInfo (×2)                 // 210 vault balances
─────▶ Sort by USDF reserve, return as JSON
```

The route caches the response in-process for 60 seconds, with single-flight
locking so a thundering-herd refresh hits the chain only once. Stale cache is
returned (with a `stale: true` flag) if the upstream fails. With ~106
currencies the whole pipeline takes ~1.5–2s cold, < 50ms warm.

If the universe ever grows beyond a few thousand currencies, the
`getProgramAccounts` calls will get expensive — at that point this route
should move to a persistent cache (Redis / Cloudflare KV / Postgres).

## Pricing & quoting

Each Flipcash currency has its own discrete bonding curve with 21M total
supply, starting at $0.01 and ending at $1M per token. The on-chain logic
uses a 210,000-entry pricing table where the price is constant inside each
100-token step. The continuous form is:

```
spot(S) = a · b · e^(c·S)         with constants chosen so spot(0)=$0.01,
                                   spot(21M)=$1M
```

`lib/flipcash/curve.ts` implements the continuous form and `quote.ts` uses it
to compute expected output for a USDF input. The discrete on-chain price is
within < 0.5% of the continuous estimate; the difference always favors the
pool, so quotes can be slightly optimistic. The default 1% slippage in the UI
covers this comfortably for any reasonable size.

## Why not simulate for quotes?

`simulateTransaction` would give a perfectly accurate quote, but it requires
the simulating account to actually own the input USDF — otherwise the buy
instruction reverts and we get no quote. Browsing prices without a connected
wallet is a core UX requirement, so the curve approximation is the right
tradeoff. We could add an optional simulation pass for connected wallets to
tighten the quote, but it has not been needed in practice.

## Liquidity reality

Each pool's destination vault is a *real* token-account balance. A USDF→USDC
swap can only fill if the pool's USDC vault has the USDC to give back —
Flipcash's authority refills these as cash flows in/out of the system. The UI
surfaces these balances prominently (`PoolStrip.tsx`) so users can see the
true cap before they try to swap.

## Security model

- **Non-custodial.** All transactions are signed in the user's wallet. The
  server has no signing keys.
- **No fee inserted.** The UI does not add an extra instruction or modify
  amounts — what the on-chain program charges is what the user pays.
- **Audited programs.** Both `usdf-swap-program` and `flipcash-program` were
  audited by Sec3.
- **Hand-coded ix layouts.** No Anchor runtime, no IDL fetched at runtime.
  The `repr(C)` layouts are part of the on-chain ABI — they don't shift
  between releases.
- **RPC.** When run from a public deployment with the embedded Helius URL,
  the API key is exposed to anyone who views the bundle. Self-hosters should
  set `NEXT_PUBLIC_SOLANA_RPC_URL` or proxy through their own backend.
