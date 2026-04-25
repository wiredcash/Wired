import { Connection, PublicKey } from "@solana/web3.js";

export type PoolState = {
  address: PublicKey;
  authority: PublicKey;
  name: string;
  usdfMint: PublicKey;
  otherMint: PublicKey;
  usdfVault: PublicKey;
  otherVault: PublicKey;
  bump: number;
  usdfVaultBump: number;
  otherVaultBump: number;
  usdfDecimals: number;
  otherDecimals: number;
};

// Pool layout (bytes) — fixed-size, repr(C):
//   8   discriminator
//   32  authority
//   32  name
//   32  usdf_mint
//   32  other_mint
//   32  usdf_vault
//   32  other_vault
//   1   bump
//   1   usdf_vault_bump
//   1   other_vault_bump
//   1   usdf_decimals
//   1   other_decimals
//   3   _padding
const POOL_DATA_LEN = 208;

export function decodePoolAccount(
  address: PublicKey,
  data: Buffer,
): PoolState {
  if (data.length !== POOL_DATA_LEN) {
    throw new Error(
      `Unexpected pool data length: ${data.length} (want ${POOL_DATA_LEN})`,
    );
  }
  const off = 8;
  return {
    address,
    authority: new PublicKey(data.subarray(off, off + 32)),
    name: data
      .subarray(off + 32, off + 64)
      .toString("utf8")
      .replace(/\0+$/, ""),
    usdfMint: new PublicKey(data.subarray(off + 64, off + 96)),
    otherMint: new PublicKey(data.subarray(off + 96, off + 128)),
    usdfVault: new PublicKey(data.subarray(off + 128, off + 160)),
    otherVault: new PublicKey(data.subarray(off + 160, off + 192)),
    bump: data[off + 192],
    usdfVaultBump: data[off + 193],
    otherVaultBump: data[off + 194],
    usdfDecimals: data[off + 195],
    otherDecimals: data[off + 196],
  };
}

export async function fetchPoolState(
  connection: Connection,
  pool: PublicKey,
): Promise<PoolState> {
  const info = await connection.getAccountInfo(pool);
  if (!info) throw new Error(`Pool ${pool.toBase58()} not found`);
  return decodePoolAccount(pool, info.data);
}
