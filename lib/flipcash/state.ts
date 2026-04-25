import { PublicKey } from "@solana/web3.js";
import {
  CURRENCY_ACCOUNT_SIZE,
  POOL_ACCOUNT_SIZE,
} from "./constants";

// CurrencyConfig (152 bytes total)
//   8   discriminator
//   32  authority
//   32  mint
//   32  name
//   8   symbol
//   32  seed
//   1   bump
//   1   mint_bump
//   6   _padding
export type CurrencyConfig = {
  address: PublicKey;
  authority: PublicKey;
  mint: PublicKey;
  name: string;
  symbol: string;
  seed: Buffer;
  bump: number;
  mintBump: number;
};

export function decodeCurrencyConfig(
  address: PublicKey,
  data: Buffer,
): CurrencyConfig {
  if (data.length !== CURRENCY_ACCOUNT_SIZE) {
    throw new Error(
      `Unexpected currency size ${data.length} (want ${CURRENCY_ACCOUNT_SIZE})`,
    );
  }
  const off = 8;
  return {
    address,
    authority: new PublicKey(data.subarray(off, off + 32)),
    mint: new PublicKey(data.subarray(off + 32, off + 64)),
    name: trimNul(data.subarray(off + 64, off + 96).toString("utf8")),
    symbol: trimNul(data.subarray(off + 96, off + 104).toString("utf8")),
    seed: Buffer.from(data.subarray(off + 104, off + 136)),
    bump: data[off + 136],
    mintBump: data[off + 137],
  };
}

// LiquidityPool (216 bytes total)
//   8   discriminator
//   32  authority
//   32  currency
//   32  mint_a (target)
//   32  mint_b (USDF base)
//   32  vault_a
//   32  vault_b
//   8   fees_accumulated
//   2   sell_fee (bps)
//   1   bump
//   1   vault_a_bump
//   1   vault_b_bump
//   3   _padding
export type LiquidityPool = {
  address: PublicKey;
  authority: PublicKey;
  currency: PublicKey;
  mintA: PublicKey;
  mintB: PublicKey;
  vaultA: PublicKey;
  vaultB: PublicKey;
  feesAccumulated: bigint;
  sellFeeBps: number;
  bump: number;
  vaultABump: number;
  vaultBBump: number;
};

export function decodeLiquidityPool(
  address: PublicKey,
  data: Buffer,
): LiquidityPool {
  if (data.length !== POOL_ACCOUNT_SIZE) {
    throw new Error(
      `Unexpected pool size ${data.length} (want ${POOL_ACCOUNT_SIZE})`,
    );
  }
  const off = 8;
  return {
    address,
    authority: new PublicKey(data.subarray(off, off + 32)),
    currency: new PublicKey(data.subarray(off + 32, off + 64)),
    mintA: new PublicKey(data.subarray(off + 64, off + 96)),
    mintB: new PublicKey(data.subarray(off + 96, off + 128)),
    vaultA: new PublicKey(data.subarray(off + 128, off + 160)),
    vaultB: new PublicKey(data.subarray(off + 160, off + 192)),
    feesAccumulated: data.readBigUInt64LE(off + 192),
    sellFeeBps: data.readUInt16LE(off + 200),
    bump: data[off + 202],
    vaultABump: data[off + 203],
    vaultBBump: data[off + 204],
  };
}

function trimNul(s: string): string {
  return s.replace(/\0+$/, "");
}
