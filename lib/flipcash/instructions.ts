import {
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  FLIPCASH_PROGRAM_ID,
  IX_BUY_TOKENS,
  IX_SELL_TOKENS,
} from "./constants";

function encodeU64LE(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  return buf;
}

export type BuyAccounts = {
  buyer: PublicKey;
  pool: PublicKey;
  targetMint: PublicKey;
  baseMint: PublicKey;
  vaultA: PublicKey;
  vaultB: PublicKey;
  buyerTarget: PublicKey;
  buyerBase: PublicKey;
};

/**
 * Build the `BuyTokens` instruction.
 *
 * Layout: [u8 discriminator=4][u64 in_amount LE][u64 min_amount_out LE]
 *
 * `inAmount` is in USDF base-mint quarks (6 decimals).
 * `minAmountOut` is in target-mint quarks (10 decimals for Flipcash currencies).
 */
export function buildBuyTokensIx(
  accounts: BuyAccounts,
  inAmount: bigint,
  minAmountOut: bigint,
): TransactionInstruction {
  const data = Buffer.concat([
    Buffer.from([IX_BUY_TOKENS]),
    encodeU64LE(inAmount),
    encodeU64LE(minAmountOut),
  ]);
  return new TransactionInstruction({
    programId: FLIPCASH_PROGRAM_ID,
    keys: [
      { pubkey: accounts.buyer, isSigner: true, isWritable: true },
      { pubkey: accounts.pool, isSigner: false, isWritable: false },
      { pubkey: accounts.targetMint, isSigner: false, isWritable: false },
      { pubkey: accounts.baseMint, isSigner: false, isWritable: false },
      { pubkey: accounts.vaultA, isSigner: false, isWritable: true },
      { pubkey: accounts.vaultB, isSigner: false, isWritable: true },
      { pubkey: accounts.buyerTarget, isSigner: false, isWritable: true },
      { pubkey: accounts.buyerBase, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export type SellAccounts = {
  seller: PublicKey;
  pool: PublicKey;
  targetMint: PublicKey;
  baseMint: PublicKey;
  vaultA: PublicKey;
  vaultB: PublicKey;
  sellerTarget: PublicKey;
  sellerBase: PublicKey;
};

export function buildSellTokensIx(
  accounts: SellAccounts,
  inAmount: bigint,
  minAmountOut: bigint,
): TransactionInstruction {
  const data = Buffer.concat([
    Buffer.from([IX_SELL_TOKENS]),
    encodeU64LE(inAmount),
    encodeU64LE(minAmountOut),
  ]);
  return new TransactionInstruction({
    programId: FLIPCASH_PROGRAM_ID,
    keys: [
      { pubkey: accounts.seller, isSigner: true, isWritable: true },
      { pubkey: accounts.pool, isSigner: false, isWritable: true },
      { pubkey: accounts.targetMint, isSigner: false, isWritable: false },
      { pubkey: accounts.baseMint, isSigner: false, isWritable: false },
      { pubkey: accounts.vaultA, isSigner: false, isWritable: true },
      { pubkey: accounts.vaultB, isSigner: false, isWritable: true },
      { pubkey: accounts.sellerTarget, isSigner: false, isWritable: true },
      { pubkey: accounts.sellerBase, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}
