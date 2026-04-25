import { PublicKey } from "@solana/web3.js";
import {
  POOL_NAME_LEN,
  POOL_SEED,
  USDF_SWAP_PROGRAM_ID,
  VAULT_SEED,
} from "./constants";

function nameToBytes(name: string): Buffer {
  const buf = Buffer.alloc(POOL_NAME_LEN);
  buf.write(name, 0, "utf8");
  return buf;
}

export function findPoolPda(
  authority: PublicKey,
  name: string,
  usdfMint: PublicKey,
  otherMint: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      POOL_SEED,
      authority.toBuffer(),
      nameToBytes(name),
      usdfMint.toBuffer(),
      otherMint.toBuffer(),
    ],
    USDF_SWAP_PROGRAM_ID,
  );
}

export function findVaultPda(
  pool: PublicKey,
  mint: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, pool.toBuffer(), mint.toBuffer()],
    USDF_SWAP_PROGRAM_ID,
  );
}
