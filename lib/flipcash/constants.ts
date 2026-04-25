import { PublicKey } from "@solana/web3.js";

export const FLIPCASH_PROGRAM_ID = new PublicKey(
  "ccJYP5gjZqcEHaphcxAZvkxCrnTVfYMjyhSYkpQtf8Z",
);

export const USDF_BASE_MINT = new PublicKey(
  "5AMAA9JV9H97YYVxx8F6FsCMmTwXSuTTQneiup4RYAUQ",
);

export const MPL_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

export const SEED_MINT = Buffer.from("mint");
export const SEED_CURRENCY = Buffer.from("currency");
export const SEED_POOL = Buffer.from("pool");
export const SEED_TREASURY = Buffer.from("treasury");
export const SEED_METADATA = Buffer.from("metadata");

export const TOKEN_DECIMALS = 10;
export const QUARKS_PER_TOKEN = 10n ** 10n;
export const MAX_TOKEN_SUPPLY = 21_000_000n;
export const USDF_DECIMALS = 6;

// Sizes — used as `getProgramAccounts` filters. Confirmed against on-chain data:
// 106 CurrencyConfig accounts at 152 bytes, 105 LiquidityPool accounts at 216 bytes.
export const CURRENCY_ACCOUNT_SIZE = 152;
export const POOL_ACCOUNT_SIZE = 216;

// Instruction discriminators (1 byte) — see InstructionType enum in flipcash-program.
export const IX_BUY_TOKENS = 4;
export const IX_SELL_TOKENS = 5;
