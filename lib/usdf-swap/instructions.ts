import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { USDF_SWAP_PROGRAM_ID } from "./constants";

const IX_INITIALIZE = 1;
const IX_SWAP = 2;
const IX_TRANSFER = 3;

function encodeU64LE(value: bigint | number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(typeof value === "bigint" ? value : BigInt(value));
  return buf;
}

export type SwapAccounts = {
  user: PublicKey;
  pool: PublicKey;
  usdfVault: PublicKey;
  otherVault: PublicKey;
  userUsdfToken: PublicKey;
  userOtherToken: PublicKey;
};

/**
 * Build the `swap` instruction.
 *
 * Layout: [u8 discriminator=2][u64 amount LE][u8 usdf_to_other]
 *
 * `amount` is in the *source* mint's smallest units. With `usdfToOther=true`,
 * it's USDF quarks; otherwise it's the other-mint's smallest units. The
 * program checks `amount <= MAX_SWAP_DOLLARS * 10^source_decimals`.
 */
export function buildSwapIx(
  accounts: SwapAccounts,
  amount: bigint,
  usdfToOther: boolean,
): TransactionInstruction {
  const data = Buffer.concat([
    Buffer.from([IX_SWAP]),
    encodeU64LE(amount),
    Buffer.from([usdfToOther ? 1 : 0]),
  ]);
  return new TransactionInstruction({
    programId: USDF_SWAP_PROGRAM_ID,
    keys: [
      { pubkey: accounts.user, isSigner: true, isWritable: true },
      { pubkey: accounts.pool, isSigner: false, isWritable: false },
      { pubkey: accounts.usdfVault, isSigner: false, isWritable: true },
      { pubkey: accounts.otherVault, isSigner: false, isWritable: true },
      { pubkey: accounts.userUsdfToken, isSigner: false, isWritable: true },
      { pubkey: accounts.userOtherToken, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export type InitializeAccounts = {
  authority: PublicKey;
  usdfMint: PublicKey;
  otherMint: PublicKey;
  pool: PublicKey;
  usdfVault: PublicKey;
  otherVault: PublicKey;
};

/** Build the `initialize` instruction (pool authority only). */
export function buildInitializeIx(
  accounts: InitializeAccounts,
  name: Uint8Array,
  bump: number,
  usdfVaultBump: number,
  otherVaultBump: number,
): TransactionInstruction {
  if (name.length !== 32) throw new Error("name must be exactly 32 bytes");
  const data = Buffer.concat([
    Buffer.from([IX_INITIALIZE]),
    Buffer.from(name),
    Buffer.from([bump, usdfVaultBump, otherVaultBump]),
  ]);
  return new TransactionInstruction({
    programId: USDF_SWAP_PROGRAM_ID,
    keys: [
      { pubkey: accounts.authority, isSigner: true, isWritable: true },
      { pubkey: accounts.usdfMint, isSigner: false, isWritable: false },
      { pubkey: accounts.otherMint, isSigner: false, isWritable: false },
      { pubkey: accounts.pool, isSigner: false, isWritable: true },
      { pubkey: accounts.usdfVault, isSigner: false, isWritable: true },
      { pubkey: accounts.otherVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export type TransferAccounts = {
  authority: PublicKey;
  pool: PublicKey;
  vault: PublicKey;
  destination: PublicKey;
};

/** Build the `transfer` instruction (pool authority only). */
export function buildTransferIx(
  accounts: TransferAccounts,
  amount: bigint,
  isUsdf: boolean,
): TransactionInstruction {
  const data = Buffer.concat([
    Buffer.from([IX_TRANSFER]),
    encodeU64LE(amount),
    Buffer.from([isUsdf ? 1 : 0]),
  ]);
  return new TransactionInstruction({
    programId: USDF_SWAP_PROGRAM_ID,
    keys: [
      { pubkey: accounts.authority, isSigner: true, isWritable: true },
      { pubkey: accounts.pool, isSigner: false, isWritable: false },
      { pubkey: accounts.vault, isSigner: false, isWritable: true },
      { pubkey: accounts.destination, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}
