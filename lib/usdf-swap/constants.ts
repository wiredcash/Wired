import { PublicKey } from "@solana/web3.js";

export const USDF_SWAP_PROGRAM_ID = new PublicKey(
  "usdfcP2V1bh1Lz7Y87pxR4zJd3wnVtssJ6GeSHFeZeu",
);

export const USDF_MINT = new PublicKey(
  "5AMAA9JV9H97YYVxx8F6FsCMmTwXSuTTQneiup4RYAUQ",
);

export const USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);

// Canonical Flipcash USDF↔USDC pool (authority: cash11n…)
export const FLIPCASH_USDF_USDC_POOL = new PublicKey(
  "8q2Kv6wMKDhkg92itiYGxr6jvSHvUhuCay6zrhUncyvK",
);

export const POOL_SEED = Buffer.from("pool");
export const VAULT_SEED = Buffer.from("vault");

export const POOL_NAME_LEN = 32;

// Per-tx ceiling enforced on-chain (MAX_SWAP_DOLLARS = 2000).
export const MAX_SWAP_DOLLARS = 2000;
