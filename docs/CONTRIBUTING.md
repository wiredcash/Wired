# Contributing

Wire is open-source and PRs are welcome. The aim is a small, sharp,
auditable codebase — additions should fit that standard.

## Setup

```bash
git clone https://github.com/wiredcash/Wired.git wire
cd wire
npm install
npm run dev
```

You'll need:
- Node ≥ 20
- A Solana RPC URL (a public endpoint works for browsing; for sending tx
  use Helius / Triton / your own)
- A wallet with USDF and a little SOL on mainnet for live testing

For one-off scripts, drop a `keypair.json` (Solana CLI format — a JSON array
of 64 numbers) in the repo root. It's gitignored.

## Conventions

- **TypeScript strict mode**. No `any`. Surface types from the SDK rather
  than recomputing them in components.
- **Prefer hand-encoded instructions** over Anchor bindings. The on-chain
  programs are `repr(C)` with stable layouts; the SDKs in `lib/` already
  encode every supported instruction.
- **No analytics, no telemetry.** Wire is a tool, not a product surface.
- **No backend except the indexer.** If you find yourself adding a database
  to ship a feature, propose it in an issue first — there's usually a way to
  do it client-side or via a pure on-chain read.
- **Visual style**: pure black canvas, white on accent for primary actions,
  yellow `#FFE94B` spark accent. Ambient effects are subtle. Match the look
  of `Bridge.tsx` / `Swap.tsx`.

## Project layout

See [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) for a deeper tour and
[`README.md`](../README.md) for the file tree.

## Roadmap items looking for contributors

- **Sell flow**: `buildSellTokensIx` is already in the SDK. The UI just needs
  a "Sell" mode that mirrors `Swap.tsx`.
- **Multi-hop USDC → USDF → currency** in a single tx (one bridge ix + one
  buy ix; bump the compute budget).
- **Currency creation flow** using `flipcash-program`'s `InitializeCurrency`
  / `InitializePool` / `InitializeMetadata` instructions.
- **Per-currency detail pages** with a curve plot and recent-tx feed.
- **RPC proxy** so we can ship the public site without leaking the Helius
  key.

## Testing

There's no unit-test scaffolding yet — the SDKs are exercised end-to-end via
`scripts/` against mainnet, and the UI is exercised by hand. If you add
non-trivial logic (curve math, ix encoding), a Vitest suite in
`lib/**/__tests__/*.test.ts` is the right home.

## Filing issues

Reproduction matters. Include:
- Wire commit / version
- RPC URL host (mask the key)
- Browser + wallet (or `node --version` for CLI)
- The full transaction signature if applicable, so we can pull logs.
