<div align="center">
  <img src="https://raw.githubusercontent.com/wiredcash/Wired/main/public/logo.png" width="140" alt="Wire" />

  # Wire

  **An open-source terminal for [Flipcash](https://flipcash.com).**

  Bridge USDF ↔ USDC at 1:1 · Buy any Flipcash currency directly with USDF.

  [wired.cash](https://wired.cash) · [@wired_cash](https://x.com/wired_cash) · [program (USDF↔USDC)](https://github.com/code-payments/usdf-swap-program) · [program (Flipcash)](https://github.com/code-payments/flipcash-program)

</div>

---

Wire is a non-custodial web app that talks directly to Flipcash's two on-chain
programs:

- the **USDF Swap Program** for 1:1 stablecoin bridging (USDF ↔ USDC), and
- the **Flipcash Currency** program for buying any of the ~100 Flipcash
  currencies along their bonding curve, denominated in USDF.

Every transaction is signed by your own wallet. Wire never holds funds, never
asks for a private key, and never inserts a fee on top of the on-chain pool.

## Features

- **Bridge** — Swap USDF ↔ USDC at a fixed 1:1 rate, capped at $2,000 per tx
  by the on-chain program.
- **Swap** — Buy any Flipcash-issued currency with USDF. Live quote, price
  impact, configurable slippage (0.5% / 1% / 3%).
- **Token picker** — Search 100+ currencies by ticker, name, or mint. Sorted
  by USDF reserve depth so the most-traded currencies surface first.
- **Wallet adapter** — Phantom, Solflare, Torus, and any standard Solana wallet.
- **Headless TS SDK** — `lib/usdf-swap` and `lib/flipcash` are fully usable
  outside the UI (Node, Bun, browser).
- **CLI runners** — Inspect pools, list currencies, send swaps from the
  terminal.

## Quick start

```bash
git clone https://github.com/wiredcash/Wired.git wire
cd wire
npm install
npm run dev          # http://localhost:3000
```

For a faster RPC, set:

```bash
export NEXT_PUBLIC_SOLANA_RPC_URL="https://your.rpc.example/"
```

## Project layout

```
wire/
├── app/                       Next.js App Router
│   ├── api/currencies/        Server-side currency indexer
│   ├── layout.tsx             Root layout, fonts, metadata
│   ├── page.tsx               Hero + Bridge/Swap card
│   └── globals.css            Pure-black canvas, ambient effects
│
├── components/                React UI
│   ├── Bridge.tsx             USDF↔USDC bridge card
│   ├── Swap.tsx               USDF→Flipcash currency swap card
│   ├── TokenPicker.tsx        Searchable currency picker modal
│   ├── ModeSwitcher.tsx       Bridge / Swap pill toggle
│   ├── PoolStrip.tsx          Live USDF/USDC liquidity readout
│   ├── WalletProviders.tsx    Solana wallet adapter wrapper
│   ├── format*.ts             Number / address formatters
│   └── use*.ts                Pool, balance, currency-list hooks
│
├── lib/
│   ├── usdf-swap/             SDK for the USDF Swap Program
│   └── flipcash/              SDK for the Flipcash Currency Program
│
├── scripts/                   CLI runners
│   ├── swap.ts                Send a USDF↔USDC swap
│   ├── pool-info.ts           Print bridge pool state
│   └── list-currencies.ts     Decode all Flipcash currencies + pools
│
└── public/                    Static assets (logo, token icons)
```

## CLI

```bash
# Bridge: inspect the pool
npx tsx scripts/pool-info.ts

# Bridge: dry-run a swap (no signing)
npx tsx scripts/swap.ts 1 usdc-to-usdf --dry-run

# Bridge: send for real
npx tsx scripts/swap.ts 0.5 usdf-to-usdc --keypair ./keypair.json

# Flipcash: list every currency + pool
npx tsx scripts/list-currencies.ts
```

The swap CLI defaults to `./keypair.json` for the signer. **`keypair.json` is
gitignored** — never commit it.

## Using the SDKs

### Bridge USDF ↔ USDC

```ts
import { Connection, Keypair, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { FLIPCASH_USDF_USDC_POOL, loadAndPlanSwap } from "wire/lib/usdf-swap";

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

### Buy a Flipcash currency

```ts
import { PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { planBuy, quoteBuy, tokensToMinOutQuarks } from "wire/lib/flipcash";

// Pull live pool state from /api/currencies (or fetch directly via SDK).
const c = await fetch("/api/currencies").then((r) => r.json());
const target = c.items.find((x) => x.symbol === "JFY");

const inUsdfQuarks = 5_000_000n; // 5 USDF
const quote = quoteBuy(
  BigInt(target.reserveTokenQuarks),
  BigInt(target.reserveUsdfQuarks),
  inUsdfQuarks,
);

const minOut = tokensToMinOutQuarks(quote.expectedTokensOut, /*slippageBps*/ 100);

const plan = await planBuy(connection, {
  buyer: signer.publicKey,
  pool: new PublicKey(target.pool),
  targetMint: new PublicKey(target.mint),
  vaultA: new PublicKey(target.vaultA),
  vaultB: new PublicKey(target.vaultB),
  inAmountUsdfQuarks: inUsdfQuarks,
  minAmountOutQuarks: minOut,
});

const tx = new Transaction().add(...plan.preInstructions, plan.buyIx);
await sendAndConfirmTransaction(connection, tx, [signer]);
```

See [`docs/SDK.md`](./docs/SDK.md) for the full SDK reference and
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for design notes.

## Configuration

Environment variables (see [`.env.example`](./.env.example)):

| Variable | Where | Default |
| --- | --- | --- |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Browser | Hardcoded fallback in source |
| `SOLANA_RPC_URL` | CLI scripts + server route | Same fallback |

For production, you should host this app yourself with your own RPC key set
via `NEXT_PUBLIC_SOLANA_RPC_URL`, or proxy RPC requests through a server-side
endpoint that holds the key.

## Security

- The on-chain programs are audited:
  [USDF Swap audit (Sec3)](https://github.com/code-payments/usdf-swap-program/blob/main/docs/audit_final.pdf) ·
  [Flipcash audit (Sec3)](https://github.com/code-payments/flipcash-program/blob/main/docs/audit_final.pdf).
- Wire is non-custodial. All signing happens client-side via the user's
  wallet. The server only reads chain state.
- The SDK encodes instructions by hand from the program's `repr(C)` layouts —
  no Anchor runtime, no IDL drift, smaller bundle, easier to audit.

## License

MIT — see [LICENSE](./LICENSE). Pull requests welcome.
