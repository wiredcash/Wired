import {
  Connection,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { USDF_BASE_MINT } from "./constants";
import { buildBuyTokensIx, buildSellTokensIx } from "./instructions";

export type BuyPlan = {
  preInstructions: TransactionInstruction[];
  buyIx: TransactionInstruction;
  buyerTargetAta: PublicKey;
  buyerBaseAta: PublicKey;
};

export type BuyPlanInput = {
  buyer: PublicKey;
  pool: PublicKey;
  targetMint: PublicKey;
  vaultA: PublicKey;
  vaultB: PublicKey;
  inAmountUsdfQuarks: bigint;
  minAmountOutQuarks: bigint;
};

export async function planBuy(
  connection: Connection,
  input: BuyPlanInput,
): Promise<BuyPlan> {
  const buyerTargetAta = getAssociatedTokenAddressSync(
    input.targetMint,
    input.buyer,
  );
  const buyerBaseAta = getAssociatedTokenAddressSync(
    USDF_BASE_MINT,
    input.buyer,
  );

  const preInstructions: TransactionInstruction[] = [];
  const infos = await connection.getMultipleAccountsInfo([
    buyerTargetAta,
    buyerBaseAta,
  ]);
  if (!infos[0]) {
    preInstructions.push(
      createAssociatedTokenAccountInstruction(
        input.buyer,
        buyerTargetAta,
        input.buyer,
        input.targetMint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
  }
  // The base USDF ATA must already exist for the buyer to hold USDF, but
  // create defensively in case (mostly a no-op).
  if (!infos[1]) {
    preInstructions.push(
      createAssociatedTokenAccountInstruction(
        input.buyer,
        buyerBaseAta,
        input.buyer,
        USDF_BASE_MINT,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
  }

  const buyIx = buildBuyTokensIx(
    {
      buyer: input.buyer,
      pool: input.pool,
      targetMint: input.targetMint,
      baseMint: USDF_BASE_MINT,
      vaultA: input.vaultA,
      vaultB: input.vaultB,
      buyerTarget: buyerTargetAta,
      buyerBase: buyerBaseAta,
    },
    input.inAmountUsdfQuarks,
    input.minAmountOutQuarks,
  );

  return { preInstructions, buyIx, buyerTargetAta, buyerBaseAta };
}

export type SellPlan = {
  preInstructions: TransactionInstruction[];
  sellIx: TransactionInstruction;
  sellerTargetAta: PublicKey;
  sellerBaseAta: PublicKey;
};

export type SellPlanInput = {
  seller: PublicKey;
  pool: PublicKey;
  targetMint: PublicKey;
  vaultA: PublicKey;
  vaultB: PublicKey;
  inAmountTokenQuarks: bigint;
  minAmountOutUsdfQuarks: bigint;
};

export async function planSell(
  connection: Connection,
  input: SellPlanInput,
): Promise<SellPlan> {
  const sellerTargetAta = getAssociatedTokenAddressSync(
    input.targetMint,
    input.seller,
  );
  const sellerBaseAta = getAssociatedTokenAddressSync(
    USDF_BASE_MINT,
    input.seller,
  );

  const preInstructions: TransactionInstruction[] = [];
  const infos = await connection.getMultipleAccountsInfo([
    sellerTargetAta,
    sellerBaseAta,
  ]);
  // The target ATA must already exist for the seller to hold the currency,
  // but create defensively if missing so the user gets a clear program-side
  // "no tokens for sale" instead of an ATA error.
  if (!infos[0]) {
    preInstructions.push(
      createAssociatedTokenAccountInstruction(
        input.seller,
        sellerTargetAta,
        input.seller,
        input.targetMint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
  }
  if (!infos[1]) {
    preInstructions.push(
      createAssociatedTokenAccountInstruction(
        input.seller,
        sellerBaseAta,
        input.seller,
        USDF_BASE_MINT,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
  }

  const sellIx = buildSellTokensIx(
    {
      seller: input.seller,
      pool: input.pool,
      targetMint: input.targetMint,
      baseMint: USDF_BASE_MINT,
      vaultA: input.vaultA,
      vaultB: input.vaultB,
      sellerTarget: sellerTargetAta,
      sellerBase: sellerBaseAta,
    },
    input.inAmountTokenQuarks,
    input.minAmountOutUsdfQuarks,
  );

  return { preInstructions, sellIx, sellerTargetAta, sellerBaseAta };
}
