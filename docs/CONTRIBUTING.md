# Contributing

Wired is open-source and PRs are welcome. The aim is a small, sharp,
auditable codebase — additions should fit that standard.

## Setup

```bash
git clone https://github.com/wiredcash/Wired.git wired
cd wired
npm install
cp .env.example .env.local        # fill in JUPITER_API_KEY + SOLANA_RPC_URL
npm run dev
```

You'll need:

- Node ≥ 20.
- A Jupiter API key (free tier at [portal.jup.ag](https://portal.jup.ag/)).
  Required for any SOL/USDC route — without it, only USDF↔target paths
  work.
- A Solana RPC URL. The public mainnet endpoint works for browsing; for
  sending real transactions a paid tier (Helius / Triton / QuickNode /
  Alchemy) is strongly recommended.
- A wallet with USDF and a little SOL on mainnet for live testing.

For one-off CLI scripts, drop a `keypair.json` (Solana CLI format — a JSON
array of 64 numbers) in the repo root. It's gitignored.

## Conventions

- **TypeScript strict mode.** No `any`. Surface types from the SDK rather
  than recomputing them in components.
- **Prefer hand-encoded instructions** over Anchor bindings for the
  `usdf-swap-program` and `flipcash-program` (their `repr(C)` layouts are
  stable; the SDKs already cover every supported ix).
- **The `wired-router` Anchor program** is the exception — it's our own
  code, not someone else's stable ABI, so Anchor's accounts struct +
  IDL-based DX is appropriate there.
- **No analytics, no telemetry.** Wired is a tool, not a product surface.
- **Server-side proxies for credentials.** Anything secret goes behind
  `app/api/*`. Anything `NEXT_PUBLIC_` is a deliberate decision that the
  value is on-chain anyway (e.g. fee owner pubkey).
- **Polling, not WebSockets.** Confirmation goes through
  `lib/confirm.ts`'s `confirmSignaturePolling` so Vercel and other
  serverless hosts work cleanly. Don't reach for `connection.onLogs` or
  `connection.confirmTransaction` without a good reason.
- **One signature per swap, always.** If a feature would force a second
  signature, design around it (see `programs/wired-router/` for the
  on-chain dispatcher pattern).
- **Visual style.** Pure black canvas, white-on-black for primary actions,
  yellow `#FFE94B` reserved for warnings (price impact). Status indicators
  are quiet (white-30 dots, no pulsing). Match the look of `Swap.tsx` /
  `Bridge.tsx`.

## Project layout

See [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) for a deeper tour and
[`README.md`](../README.md) for the file tree.

## Running the on-chain program (`wired-router`)

The Anchor program at `programs/wired-router/` is built but not deployed.
To work on it:

```bash
# Build only (skips IDL generation; fixes a known anchor-syn 0.30.1 quirk)
anchor build --no-idl

# After updating declare_id! and Anchor.toml with a real program ID:
anchor deploy --provider.cluster devnet
```

You'll need the Solana CLI + Anchor CLI installed. See the program's
[README](../programs/wired-router/README.md) for the full build/deploy
flow and account-budget notes.

## Roadmap items looking for contributors

- **USDC/USDF split routing** — when the `wired-router` program is deployed,
  the off-chain client can compose a partial Jupiter swap + bridge +
  flipcash buy in one program ix. The math (sample 5 split fractions, pick
  the best) lives in `lib/multi-hop.ts` once we add it.
- **SOL split routing** — needs the dispatcher program deployed; even then,
  fitting two Jupiter CPIs in one tx is tight. Probably stays
  winner-takes-all for the foreseeable.
- **Migrate the off-chain client to call `wired-router`** — replaces the
  current manual `(jupiter, bridge, flipcash)` ix sequence with a single
  `route_buy`/`route_sell` call. Mostly mechanical once the program is
  deployed and the IDL is published.
- **Currency creation flow** using `flipcash-program`'s `InitializeCurrency`
  / `InitializePool` / `InitializeMetadata` instructions.
- **Per-currency detail pages** with a curve plot, recent activity feed, and
  links to the on-chain pool.
- **Tighter rate limiting on `/api/rpc`** — the proxy is open today.
  Vercel's built-in IP rate limiting (Pro+) or a thin per-IP limiter on top
  of `app/api/rpc/route.ts` would lock it down before it shows up in real
  traffic.

## Testing

There's no unit-test scaffolding yet — the SDKs are exercised end-to-end via
`scripts/` against mainnet, and the UI is exercised by hand. Specifically:

```bash
npx tsx scripts/simulate-multihop.ts JFY USDC 1
npx tsx scripts/simulate-multihop.ts JFY SOL 0.001
npx tsx scripts/simulate-sell.ts JFY SOL 0.1
npx tsx scripts/pool-info.ts
npx tsx scripts/list-currencies.ts
```

If you add non-trivial logic (curve math, ix encoding, aggregator
splitting), a Vitest suite in `lib/**/__tests__/*.test.ts` is the right
home.

## Filing issues

Reproduction matters. Include:

- Wired commit / version (`git rev-parse HEAD`).
- RPC URL host (mask the API key — just the domain is useful).
- Browser + wallet, or `node --version` for CLI.
- The full transaction signature if applicable, so we can pull on-chain
  logs.
- A screenshot of the red error card when the failure is in `Swap` /
  `Bridge` — the `enrichTxError` output usually pinpoints the program
  that rejected.
