import { PublicKey } from "@solana/web3.js";
import {
  FLIPCASH_PROGRAM_ID,
  MPL_METADATA_PROGRAM_ID,
  SEED_CURRENCY,
  SEED_METADATA,
  SEED_POOL,
  SEED_TREASURY,
} from "./constants";

export function findCurrencyPda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED_CURRENCY, mint.toBuffer()],
    FLIPCASH_PROGRAM_ID,
  );
}

export function findPoolPda(currency: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED_POOL, currency.toBuffer()],
    FLIPCASH_PROGRAM_ID,
  );
}

export function findVaultPda(
  pool: PublicKey,
  mint: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED_TREASURY, pool.toBuffer(), mint.toBuffer()],
    FLIPCASH_PROGRAM_ID,
  );
}

export function findMetadataPda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED_METADATA, MPL_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    MPL_METADATA_PROGRAM_ID,
  );
}
