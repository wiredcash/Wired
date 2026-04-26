# Architecture

Wired is a thin client over Solana programs, plus a small server-side proxy
layer for credentials. The browser reads chain state, runs aggregator math
locally, and asks the user's wallet to sign a single transaction. The server
holds API keys (Solana RPC, Jupiter Pro) and exposes them through narrow
proxy routes; the public bundle never sees them.

## On-chain programs we talk to

| Program | ID | Purpose |
| --- | --- | --- |
| `usdf-swap-program` | `usdfcP2V1bh1Lz7Y87pxR4zJd3wnVtssJ6GeSHFeZeu` | 1:1 USDF↔USDC swaps |
| `flipcash-program`  | `ccJYP5gjZqcEHaphcxAZvkxCrnTVfYMjyhSYkpQtf8Z` | Bonding-curve buys/sells of ~100 currencies, denominated in USDF |
| Jupiter aggregator  | `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` | Whatever DEX route gives the best price between two arbitrary mints |
| `wired-router`      | *(unset)* | **Built but not deployed** — see [`programs/wired-router/`](../programs/wired-router/README.md). When deployed, wraps multi-leg swaps + 1% fee into one program ix. |

USDF is the base of the Flipcash universe. The bridge moves dollars in/out as
USDC; the Flipcash program trades that USDF against ~100 distinct currencies
along their own bonding curves; Jupiter (when liquidity exists) is often a
better path between any two mints than the curve.

```
        ┌──────────────────────── browser ────────────────────────┐
        │                                                          │
   user ─┼─▶ Swap.tsx ─▶ planMultiHopBuy ─┐                        │
        │                                  │                       │
        │                          races curve vs Jupiter direct,  │
        │                          picks the better expected out   │
        │                                  │                       │
        │                                  ▼                       │
        │                       VersionedTransaction (single sig)  │
        │                                  │                       │
        └──────────────────────────────────┼───────────────────────┘
                                           │
                                           ▼
        ┌─── single tx ───┐  ┌── /api/jupiter ──┐  ┌── /api/rpc ──┐
        │ Jupiter swap    │  │ proxy holds      │  │ proxy holds  │
        │ usdf-swap ix    │──│ JUPITER_API_KEY  │──│ SOLANA_RPC_  │
        │ flipcash ix     │  │                  │  │ URL          │
        └─────────────────┘  └──────────────────┘  └──────────────┘
                                       │                  │
                                       ▼                  ▼
                                  api.jup.ag        Helius / Triton
```

## Repository layout (one-glance)

The full file tree is in the [README](../README.md). The pieces that matter
for understanding the system:

- `app/api/rpc/` and `app/api/jupiter/*` — proxy routes that hold the
  paid-tier API keys server-side. The browser hits these instead of the
  upstream so keys never enter the public bundle.
- `app/api/currencies/` — server-side indexer that does the
  `getProgramAccounts` scan + DAS metadata batching for all Flipcash
  currencies, caches the result for 60s.
- `lib/usdf-swap/`, `lib/flipcash/`, `lib/jupiter/` — runtime-agnostic SDKs
  (Node + browser).
- `lib/multi-hop.ts` — the **aggregator**. Composes single-tx plans for buy
  and sell, picking between the curve route and a direct-Jupiter route.
- `lib/confirm.ts` — `getSignatureStatuses` polling helper that replaces
  `connection.confirmTransaction` (avoids WebSocket subscriptions, which
  Vercel and other serverless hosts don't proxy).
- `components/` — React UI. `Swap`, `Bridge`, the `RouteSummary` panel, the
  `SwapSuccessModal`, the wallet provider, all live hooks.
- `scripts/` — CLI runners that exercise the SDKs against mainnet. Useful as
  integration tests.
- `programs/wired-router/` — Anchor program we built but haven't shipped.

## Instruction encoding (off-chain SDKs)

Both `usdf-swap-program` and `flipcash-program` are written with
[Steel](https://github.com/regolith-labs/steel): C-style fixed-size instruction
layouts with single-byte enum discriminators — *not* Anchor's 8-byte sighash.
Our SDKs encode the bytes by hand:

```
usdf-swap   swap        → [u8 disc=2][u64 amount LE][u8 usdf_to_other]
flipcash    buy_tokens  → [u8 disc=4][u64 in_amount LE][u64 min_amount_out LE]
flipcash    sell_tokens → [u8 disc=5][u64 in_amount LE][u64 min_amount_out LE]
```

Account state is also `repr(C)` with a fixed 8-byte discriminator prefix and
known offsets per field. Decoders in `lib/*/state.ts` (or `pool.ts`) read
fields directly. Faster, smaller, and easier to audit than wiring Anchor —
and the program won't change shape underneath you, since the layout is part
of the on-chain ABI.

For Jupiter we don't encode the swap ix ourselves — Jupiter's instruction
data depends on the chosen route and is computed by their off-chain
`/swap-instructions` endpoint. We pass through the bytes plus the matching
account list as `remaining_accounts` to a CPI'd `invoke()` (when via the
`wired-router` program) or directly into the user's tx (today).

## The aggregator (`lib/multi-hop.ts`)

For each swap, the planner races two paths in parallel and submits whichever
delivers more output. Both paths produce a single `VersionedTransaction`
(v0 + Jupiter's address-lookup tables) so the user signs exactly once.

### Buy paths

- **`planCurveBuy`** — input → (Jupiter→USDC if input is SOL) → bridge USDC→USDF
  if input is USDC/SOL → flipcash `buy`. The Jupiter→USDC leg uses
  `maxAccounts=28` so the combined tx fits in 1232 bytes.

- **`planJupiterDirectBuy`** — single Jupiter swap input → target. Returns
  `null` if Jupiter has no route or the resulting tx overflows 1232 bytes.
  Uses `maxAccounts=48` (more headroom because there's no bridge/flipcash
  overhead).

### Sell paths

Symmetric: `planCurveSell` does flipcash `sell` → optional bridge → optional
Jupiter; `planJupiterDirectSell` is a single Jupiter swap currency→output.

### Picking the winner

```ts
const [curve, jupiter] = await Promise.all([planCurveBuy(...), planJupiterDirectBuy(...)]);
return jupiter && jupiter.expectedTokensOut > curve.expectedTokensOut
  ? jupiter
  : curve;
```

The plan return includes `provider: "curve" | "jupiter-direct"` and a
`routeSteps: RouteStep[]` array describing the hops in human terms. The UI
renders them in the `RouteSummary` panel.

### Live UI quotes

The `Swap` component fires up to two debounced Jupiter quotes per direction:

- **Buy** — `input → USDC` (used by the curve path's first leg, only when
  input is SOL) and `input → target` (the direct path).
- **Sell** — `USDC → output` (curve path's last leg, only when output is
  SOL) and `currency → output` (direct path).

Each is a 400ms debounce, cancelled on input change. The aggregator's choice
re-renders live as the quotes come in; the `RouteSummary` panel shows
*"Best · Jupiter"* or *"Best · Flipcash curve"* with the chosen hops.

## Splitting (intentionally not implemented yet)

Real split routing — *e.g. some via Jupiter, the rest via the curve* — would need
either:

1. **Two Jupiter swaps in one tx** for any input that requires Jupiter on
   *both* paths (SOL inputs do — the curve leg needs `SOL→USDC` via Jupiter,
   plus the direct leg is `SOL→target` via Jupiter). Two Jupiter swaps blow
   past Solana's 1232-byte tx limit.
2. **A custom dispatcher program** that does the splits via CPIs from a
   single program instruction. That's `programs/wired-router/` — built but
   not shipped.

Without (2), splits are physically possible only when one path doesn't need
Jupiter (USDF or USDC inputs/outputs). The current client falls back to
**winner-takes-all** for all directions, which captures most of the price
improvement and keeps the strict one-signature contract.

## Indexing currencies

```
GET /api/currencies
─────▶ getProgramAccounts(flipcash, dataSize=152)   // ~106 currencies
─────▶ getProgramAccounts(flipcash, dataSize=216)   // ~105 pools
─────▶ Helius DAS getAssetBatch (×2)                // logos / names / desc
─────▶ getMultipleAccountsInfo (×2)                 // ~210 vault balances
─────▶ Sort by USDF reserve, return as JSON
```

In-process cache, 60s TTL, single-flight locking so a stampede only hits the
chain once. Stale cache is returned (with a `stale: true` flag) on upstream
errors. With ~106 currencies the pipeline is ~1.5–2s cold, < 50ms warm.

If the universe ever grows past a few thousand currencies, the
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
pool, so quotes can be slightly optimistic. The default 1% slippage in the
UI covers this comfortably for any reasonable size.

For Jupiter, we don't estimate — every quote is a live API call.

## Why polling instead of `confirmTransaction`?

`Connection.confirmTransaction` opens a WebSocket subscription against the
RPC. Vercel Functions don't proxy WebSockets, so the subscription would
fail and spew `wss://…/api/rpc` errors in the browser console (confirmation
itself still works via web3.js's polling fallback, but the noise is real).

`lib/confirm.ts` exposes `confirmSignaturePolling` that just hits
`getSignatureStatuses` over plain HTTP through `/api/rpc` until the sig
reaches the desired commitment. Used by `Swap.sendStep` and `Bridge`
submission. Default 60s timeout, 1s poll interval.

## 1% integrator fee (off-chain, today)

The deployed off-chain client uses Jupiter's built-in `platformFeeBps` /
`feeAccount` parameters. The fee is taken in the *output* mint of each
Jupiter leg and routed to an ATA owned by `NEXT_PUBLIC_WIRE_FEE_OWNER`:

| Path | Fee mint |
| --- | --- |
| Buy via SOL/USDC + Jupiter | USDC |
| Buy via direct Jupiter | target currency |
| Sell to SOL via Jupiter | wSOL |
| Bridge or pure flipcash | **no fee today** |

The fee owner's ATA must exist before the swap or Jupiter rejects the tx.
The multi-hop builder adds a `createAssociatedTokenAccountInstruction` to
the setup section if the ATA is missing — first user of each new mint pays
~$0.002 rent, every subsequent user reuses it.

For "fee on every swap" coverage (including pure curve paths), the
`programs/wired-router/` Anchor program takes a flat 1% in the *input* mint
inside its `route_buy` / `route_sell` instructions. Not yet deployed.

## Liquidity reality

Each pool's destination vault is a *real* token-account balance. A USDF→USDC
swap can only fill if the bridge's USDC vault has the USDC to give back —
Code Inc refills these as cash flows in/out of the system. The `Swap`
component reads bridge state via `usePoolState` and pre-flight rejects swaps
that would underflow with *"Bridge out of USDC — try selling to USDF"*
instead of letting the wallet adapter throw a generic
`WalletSendTransactionError`.

## Security model

- **Non-custodial.** All transactions are signed in the user's wallet.
- **Audited programs.** Both `usdf-swap-program` and `flipcash-program` were
  audited by Sec3.
- **Hand-coded ix layouts** for the audited programs. No Anchor runtime, no
  IDL fetched at runtime.
- **Server-side credentials.** `JUPITER_API_KEY` and `SOLANA_RPC_URL` are
  read by the proxy routes only; bundle scans (`grep -r "helius-rpc\|jup_"
  .next/static/`) are part of the smoke check.
- **Pre-flight liquidity guards** for both directions.
- **WalletSendTransactionError unwrapping** (`Swap.enrichTxError`) extracts
  the underlying program logs so failure modes are debuggable from a phone
  screenshot rather than a generic stack frame.
- **Error boundaries** at three layers (`global-error.tsx`, `app/error.tsx`,
  `components/ErrorBoundary.tsx`) surface render-time crashes inline with
  the actual exception name + message instead of Next's generic wall.
