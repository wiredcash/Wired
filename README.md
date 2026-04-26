<div align="center">
  <img src="https://raw.githubusercontent.com/wiredcash/Wired/main/public/logo.png" width="140" alt="Wired" />

  # Wired

  **An open-source terminal for [Flipcash](https://flipcash.com).**

  Bridge USDF ↔ USDC at 1:1 · Buy or sell ~100 Flipcash currencies with USDF, USDC, or SOL.

  [wired.cash](https://wired.cash) · [@wired_cash](https://x.com/wired_cash) · [usdf-swap-program](https://github.com/code-payments/usdf-swap-program) · [flipcash-program](https://github.com/code-payments/flipcash-program)

</div>

---

Wired is a non-custodial web app and TypeScript SDK that talks directly to
Flipcash's two on-chain Solana programs:

- **`usdf-swap-program`** — 1:1 USDF↔USDC bridging.
- **`flipcash-program`** — bonding-curve buys and sells of ~100 currencies,
  denominated in USDF.

Plus a built-in **aggregator**: every swap also gets quoted against Jupiter,
and the path that delivers more output wins. The win/loss varies by pair and
size — Flipcash currency pools on Jupiter (e.g. Meteora DAMM v2) tend to be
shallow, so Jupiter typically beats the curve on small swaps and the curve
takes over once price impact climbs. Quotes are live, so the panel shows the
chosen route as the user types.

Every transaction is signed in the user's own wallet. The server holds API
keys behind proxy routes — the browser bundle stays clean.

## Features

- **Bridge** — Swap USDF ↔ USDC at 1:1, capped at $2,000 per tx by the on-chain program.
- **Swap (buy)** — Pay with USDF, USDC, or SOL → receive any Flipcash
  currency. Live debounced quotes, price impact, configurable slippage
  (0.5% / 1% / 3%).
- **Swap (sell)** — Sell any Flipcash currency → receive USDF, USDC, or SOL.
- **Aggregator** — Compares the curve route against a direct Jupiter route on
  every swap and picks the better one. **Single signature** regardless of
  which path wins, including SOL multi-hop routes.
- **Route panel** — Shows the chosen hops with DEX labels (e.g.
  *"Jupiter · Meteora DAMM v2"* or *"USDF/USDC bridge · 1:1 → Flipcash curve"*).
- **Token picker** — Search 100+ currencies by ticker, name, or mint. Sorted
  by USDF reserve depth.
- **Server-side proxies** — `/api/rpc` and `/api/jupiter/*` keep paid-tier
  API keys (Helius, Jupiter Pro) out of the public bundle.
- **Headless TS SDKs** — `lib/usdf-swap`, `lib/flipcash`, `lib/jupiter`, and
  `lib/multi-hop` are usable from any Node, Bun, or browser env.
- **CLI runners** — Inspect pools, list currencies, simulate any route, and
  send swaps from the terminal.
- **On-chain splitter** (built, not deployed) — `programs/wired-router/` is an
  Anchor program that wraps multi-leg swaps into one program ix and takes a
  flat 1% integrator fee on every swap. See
  [`programs/wired-router/README.md`](./programs/wired-router/README.md).

## Quick start

```bash
git clone https://github.com/wiredcash/Wired.git wired
cd wired
npm install
cp .env.example .env.local   # fill in JUPITER_API_KEY + SOLANA_RPC_URL
npm run dev                  # http://localhost:3000
```

The app needs a Jupiter API key for the multi-hop SOL/USDC routes. Get one at
[portal.jup.ag](https://portal.jup.ag/) — free tier works.

## Configuration

All env vars are server-side except where prefixed `NEXT_PUBLIC_` (which
means the value is intentionally embedded in the browser bundle).

| Variable | Where | Required | Notes |
| --- | --- | --- | --- |
| `JUPITER_API_KEY` | server | Yes for SOL/USDC routes | Server-only. Browser hits `/api/jupiter/*` proxy. |
| `SOLANA_RPC_URL` | server | No | Falls back to public mainnet. Browser hits `/api/rpc` proxy. Swap providers (Helius / Triton / Alchemy) without rebuilding. |
| `NEXT_PUBLIC_WIRE_FEE_OWNER` | client + server | No | Pubkey that receives the 1% Jupiter integrator fee. Pubkey is on-chain anyway, hence `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_WIRE_FEE_BPS` | client + server | No | Fee in basis points (100 = 1%). Both fee vars must be set together to enable the fee path. |

See [`.env.example`](./.env.example) for the full template.

## Architecture (one paragraph)

Browser-only frontend hits two server-side proxy routes — `/api/rpc` (Solana
RPC) and `/api/jupiter/*` (Jupiter quote + swap-instructions). The frontend
SDKs run live aggregator quotes (curve math + Jupiter direct + Jupiter via
USDC for the bridge leg), pick the best path, and compose a single v0
transaction with address-lookup tables. The user's wallet signs once,
confirmation is HTTP polling (no WebSockets — Vercel-friendly). Every swap is
exactly one signature, including the multi-hop SOL → currency path.

For the long version: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Project layout

```
wired/
├── app/                              Next.js App Router
│   ├── api/
│   │   ├── currencies/route.ts       Server-side currency indexer
│   │   ├── jupiter/quote/route.ts    Jupiter Pro proxy (holds API key)
│   │   ├── jupiter/swap-instructions/route.ts
│   │   └── rpc/route.ts              Solana RPC proxy (holds RPC URL)
│   ├── error.tsx                     Page-level error boundary
│   ├── global-error.tsx              Last-resort fatal error page
│   ├── layout.tsx                    Root layout, fonts, metadata
│   └── page.tsx                      Hero + Swap/Bridge card + About
│
├── components/                       React UI
│   ├── Swap.tsx                      Multi-hop buy + sell card with live quotes
│   ├── Bridge.tsx                    USDF↔USDC bridge card
│   ├── ModeSwitcher.tsx              Bridge / Swap pill toggle
│   ├── RouteSummary.tsx              Live "chosen route" panel
│   ├── TokenPicker.tsx               Searchable currency picker modal
│   ├── InputTokenChip.tsx            USDF / USDC / SOL dropdown chip
│   ├── SwapSuccessModal.tsx          Modern success modal with flow summary
│   ├── ErrorBoundary.tsx             Catches Bridge/Swap render errors
│   ├── PoolStrip.tsx                 Live USDF/USDC liquidity readout
│   ├── WalletProviders.tsx           Solana wallet adapter wrapper
│   ├── format*.ts                    Number / address formatters
│   └── use*.ts                       Pool, balance, currency, Jupiter, SOL hooks
│
├── lib/
│   ├── usdf-swap/                    SDK for the USDF Swap Program
│   ├── flipcash/                     SDK for the Flipcash Currency Program (incl. curve math)
│   ├── jupiter/                      Jupiter quote + swap-instructions client + fee config
│   ├── multi-hop.ts                  Aggregator: races curve vs Jupiter, builds single-tx plans
│   └── confirm.ts                    Polling-based tx confirmation (no WebSocket)
│
├── scripts/                          CLI runners
│   ├── swap.ts                       Send a USDF↔USDC bridge swap
│   ├── pool-info.ts                  Print bridge pool state
│   ├── list-currencies.ts            Decode all Flipcash currencies + pools
│   ├── simulate-multihop.ts          Compose + simulate a multi-hop buy
│   └── simulate-sell.ts              Compose + simulate a multi-hop sell
│
├── programs/
│   └── wired-router/                 Anchor program: on-chain splitter + 1% fee
│       ├── src/                      lib.rs, instructions/, cpi.rs, constants.rs
│       └── README.md                 Design notes, build, deploy
│
├── docs/                             Architecture, SDK reference, contributing
└── public/                           Static assets (logo, token icons)
```

## CLI

Run from the repo root with a real keypair at `./keypair.json` (gitignored).

```bash
# Bridge: inspect the pool
npx tsx scripts/pool-info.ts

# Bridge: dry-run a swap (no signing)
npx tsx scripts/swap.ts 1 usdc-to-usdf --dry-run

# Bridge: send for real
npx tsx scripts/swap.ts 0.5 usdf-to-usdc --keypair ./keypair.json

# Flipcash: list every currency + pool
npx tsx scripts/list-currencies.ts

# Aggregator: simulate a multi-hop buy (no send)
npx tsx scripts/simulate-multihop.ts JFY SOL 0.001
npx tsx scripts/simulate-multihop.ts JFY USDC 1
npx tsx scripts/simulate-multihop.ts JFY USDF 1

# Aggregator: simulate a multi-hop sell
npx tsx scripts/simulate-sell.ts JFY SOL 0.1
```

Each `simulate-*` script prints the chosen route, tx size, expected output,
and runs an on-chain `simulateTransaction` against the first leg.
**`keypair.json` is gitignored** — never commit it.

## Using the SDKs

### Bridge USDF ↔ USDC

```ts
import { Connection, Keypair, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { FLIPCASH_USDF_USDC_POOL, loadAndPlanSwap } from "wired/lib/usdf-swap";

const connection = new Connection(process.env.SOLANA_RPC_URL!);
const signer = Keypair.fromSecretKey(/* ... */);

const plan = await loadAndPlanSwap(
  connection,
  FLIPCASH_USDF_USDC_POOL,
  signer.publicKey,
  1_000_000n,        // 1 USDF in quarks (6 decimals)
  true,              // usdfToOther = true → USDF → USDC
);

const tx = new Transaction().add(...plan.preInstructions, plan.swapIx);
await sendAndConfirmTransaction(connection, tx, [signer]);
```

### Aggregated buy (curve vs Jupiter, picks best)

```ts
import { VersionedTransaction } from "@solana/web3.js";
import { planMultiHopBuy } from "wired/lib/multi-hop";

const items = await fetch("/api/currencies").then((r) => r.json());
const target = items.items.find((x) => x.symbol === "JFY");

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
  target.symbol,                  // for nice route labels
);

console.log("provider:", plan.provider);    // "curve" or "jupiter-direct"
console.log("expected:", plan.expectedTokensOut, target.symbol);
console.log("route:", plan.routeSteps);     // [{ from, to, via }, ...]

// One signature regardless of which path won:
plan.txs[0].tx.sign([signer]);
await connection.sendRawTransaction(plan.txs[0].tx.serialize());
```

For sells, use `planMultiHopSell` with the same shape.

See [`docs/SDK.md`](./docs/SDK.md) for the full reference and
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for design notes.

## Aggregator behavior

For each swap, the planner races two paths in parallel and submits whichever
delivers more output. Which path wins depends on the pair and the size:
Flipcash currency pools on Jupiter (e.g. Meteora DAMM v2) tend to be shallow,
so the bonding curve frequently wins above small notional sizes once
Jupiter's price impact climbs. The aggregator picks live, every keystroke.

| Input | Curve path | Direct Jupiter | Notes |
| --- | --- | --- | --- |
| USDF → currency | flipcash buy | (often no Jupiter route from USDF) | curve almost always wins |
| USDC → currency | bridge → flipcash | Jupiter (e.g. Meteora DAMM v2) | Jupiter often wins on small notionals; curve takes over above pool depth |
| SOL → currency | Jupiter (SOL→USDC) → bridge → flipcash | Jupiter direct (SOL→target) | depends on the target's Jupiter pool depth |
| currency → USDF | flipcash sell | (rare) | curve almost always wins |
| currency → USDC | flipcash sell → bridge | Jupiter direct | depends on pool |
| currency → SOL | flipcash sell → bridge → Jupiter (USDC→SOL) | Jupiter direct | depends on pool |

**Splitting** (e.g., partial Jupiter + partial curve) is intentionally not implemented
in the off-chain client — for SOL it would need two Jupiter swaps in one tx
(>1500 bytes, busts the 1232-byte tx size limit). The on-chain
`programs/wired-router/` program would enable USDC/USDF splitting in one
signature when deployed.

## Security

- The on-chain programs are audited:
  [USDF Swap audit (Sec3)](https://github.com/code-payments/usdf-swap-program/blob/main/docs/audit_final.pdf) ·
  [Flipcash audit (Sec3)](https://github.com/code-payments/flipcash-program/blob/main/docs/audit_final.pdf).
- Wired is **non-custodial**. All signing happens client-side via the user's
  wallet. The server only proxies HTTP RPC and Jupiter calls.
- API keys (Helius, Jupiter Pro) live in `SOLANA_RPC_URL` /
  `JUPITER_API_KEY` server env. The browser bundle never carries them — see
  `app/api/rpc/route.ts` and `app/api/jupiter/*`.
- Bundle scan (`grep -r "helius-rpc\|jup_" .next/static/`) is part of the
  smoke check — keys must never appear there.
- The off-chain SDKs encode instructions by hand from the program's `repr(C)`
  layouts — no Anchor runtime, no IDL drift, smaller bundle, easier to audit.
- Pre-flight liquidity checks block swaps the bridge can't fill (e.g.
  USDF→USDC when the pool's USDC vault is empty), surfacing a clear "Bridge
  out of USDC" message instead of a wallet-level revert.
- Confirmation uses `getSignatureStatuses` polling rather than WebSocket
  subscription — avoids `wss://…` errors on Vercel and other serverless hosts.

## License

MIT — see [LICENSE](./LICENSE). Pull requests welcome; see
[`docs/CONTRIBUTING.md`](./docs/CONTRIBUTING.md).
