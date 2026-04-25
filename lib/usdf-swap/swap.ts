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
import { buildSwapIx } from "./instructions";
import { fetchPoolState, type PoolState } from "./pool";

export type SwapPlan = {
  pool: PoolState;
  usdfToOther: boolean;
  /** Source-mint smallest units (what the user spends). */
  inputAmount: bigint;
  /** Destination-mint smallest units the user expects to receive. */
  expectedOutput: bigint;
  /** Pre-instructions for ATA creation, if needed. */
  preInstructions: TransactionInstruction[];
  /** The swap instruction itself. */
  swapIx: TransactionInstruction;
  /** ATAs touched by the swap. */
  userUsdfAta: PublicKey;
  userOtherAta: PublicKey;
};

/**
 * Convert an amount across decimal precisions, truncating in the same
 * direction as the on-chain program (favors the pool: user gets less).
 */
export function convertAmount(
  amount: bigint,
  fromDecimals: number,
  toDecimals: number,
): bigint {
  if (fromDecimals === toDecimals) return amount;
  if (toDecimals > fromDecimals) {
    return amount * 10n ** BigInt(toDecimals - fromDecimals);
  }
  return amount / 10n ** BigInt(fromDecimals - toDecimals);
}

/**
 * Build everything needed to send a swap: ensure ATAs, build the swap ix,
 * and return the expected output (after the program's truncation rule).
 */
export async function planSwap(
  connection: Connection,
  pool: PoolState,
  user: PublicKey,
  inputAmount: bigint,
  usdfToOther: boolean,
): Promise<SwapPlan> {
  if (inputAmount <= 0n) throw new Error("input amount must be > 0");

  const sourceDecimals = usdfToOther ? pool.usdfDecimals : pool.otherDecimals;
  const destDecimals = usdfToOther ? pool.otherDecimals : pool.usdfDecimals;
  const expectedOutput = convertAmount(inputAmount, sourceDecimals, destDecimals);

  const userUsdfAta = getAssociatedTokenAddressSync(pool.usdfMint, user);
  const userOtherAta = getAssociatedTokenAddressSync(pool.otherMint, user);

  const preInstructions: TransactionInstruction[] = [];
  const ataInfos = await connection.getMultipleAccountsInfo([
    userUsdfAta,
    userOtherAta,
  ]);
  for (const [i, ata, mint] of [
    [0, userUsdfAta, pool.usdfMint],
    [1, userOtherAta, pool.otherMint],
  ] as const) {
    if (!ataInfos[i]) {
      preInstructions.push(
        createAssociatedTokenAccountInstruction(
          user, // payer
          ata,
          user, // owner
          mint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      );
    }
  }

  const swapIx = buildSwapIx(
    {
      user,
      pool: pool.address,
      usdfVault: pool.usdfVault,
      otherVault: pool.otherVault,
      userUsdfToken: userUsdfAta,
      userOtherToken: userOtherAta,
    },
    inputAmount,
    usdfToOther,
  );

  return {
    pool,
    usdfToOther,
    inputAmount,
    expectedOutput,
    preInstructions,
    swapIx,
    userUsdfAta,
    userOtherAta,
  };
}

/** Convenience: load pool state then plan the swap. */
export async function loadAndPlanSwap(
  connection: Connection,
  poolAddress: PublicKey,
  user: PublicKey,
  inputAmount: bigint,
  usdfToOther: boolean,
): Promise<SwapPlan> {
  const pool = await fetchPoolState(connection, poolAddress);
  return planSwap(connection, pool, user, inputAmount, usdfToOther);
}
