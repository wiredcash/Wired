#!/usr/bin/env tsx
/**
 * CLI test driver for the USDF↔USDC bridge. Loads a local keypair and
 * submits a swap against the canonical Flipcash pool on mainnet.
 *
 * Usage:
 *   npm run swap -- <amount> <direction> [--keypair PATH] [--rpc URL] [--dry-run]
 *
 *   amount      Source-token amount in display units, e.g. "0.5".
 *               Floor-truncated to mint decimals.
 *   direction   "usdf-to-usdc" | "usdc-to-usdf"
 *
 * Examples:
 *   npm run swap -- 0.000192 usdf-to-usdc
 *   npm run swap -- 1 usdc-to-usdf --dry-run
 */
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FLIPCASH_USDF_USDC_POOL,
  fetchPoolState,
  loadAndPlanSwap,
} from "../lib/usdf-swap";

type Args = {
  amount: string;
  direction: "usdf-to-usdc" | "usdc-to-usdf";
  keypair: string;
  rpc: string;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  let keypair = resolve(process.cwd(), "keypair.json");
  let rpc =
    process.env.SOLANA_RPC_URL ??
    "https://mainnet.helius-rpc.com/?api-key=027318d4-f3d4-4ff3-a490-c945bdb3a0af";
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--keypair") keypair = resolve(argv[++i]);
    else if (a === "--rpc") rpc = argv[++i];
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--help" || a === "-h") {
      console.log(__filename + " <amount> <direction> [--keypair P] [--rpc URL] [--dry-run]");
      process.exit(0);
    } else positional.push(a);
  }

  const [amount, direction] = positional;
  if (!amount || !direction) {
    throw new Error('usage: swap <amount> <"usdf-to-usdc"|"usdc-to-usdf">');
  }
  if (direction !== "usdf-to-usdc" && direction !== "usdc-to-usdf") {
    throw new Error(`unknown direction "${direction}"`);
  }
  return { amount, direction, keypair, rpc, dryRun };
}

function loadKeypair(path: string): Keypair {
  const secret = JSON.parse(readFileSync(path, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function toQuarks(amount: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(amount)) {
    throw new Error(`invalid amount "${amount}"`);
  }
  const [whole, frac = ""] = amount.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

function fmtQuarks(quarks: bigint, decimals: number): string {
  const s = quarks.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals) || "0";
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

async function getTokenBalance(
  conn: Connection,
  ata: PublicKey,
): Promise<bigint> {
  const info = await conn.getAccountInfo(ata);
  if (!info) return 0n;
  const bal = await conn.getTokenAccountBalance(ata);
  return BigInt(bal.value.amount);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const connection = new Connection(args.rpc, "confirmed");
  const signer = loadKeypair(args.keypair);
  const usdfToOther = args.direction === "usdf-to-usdc";

  const pool = await fetchPoolState(connection, FLIPCASH_USDF_USDC_POOL);
  const sourceDecimals = usdfToOther ? pool.usdfDecimals : pool.otherDecimals;
  const destDecimals = usdfToOther ? pool.otherDecimals : pool.usdfDecimals;
  const inputQuarks = toQuarks(args.amount, sourceDecimals);

  const plan = await loadAndPlanSwap(
    connection,
    pool.address,
    signer.publicKey,
    inputQuarks,
    usdfToOther,
  );

  // Liquidity check on the destination vault.
  const destVault = usdfToOther ? pool.otherVault : pool.usdfVault;
  const destVaultBal = await getTokenBalance(connection, destVault);

  console.log(
    JSON.stringify(
      {
        wallet: signer.publicKey.toBase58(),
        pool: pool.address.toBase58(),
        direction: args.direction,
        input: `${args.amount} ${usdfToOther ? "USDF" : "USDC"} (${inputQuarks} quarks)`,
        expectedOutput: `${fmtQuarks(plan.expectedOutput, destDecimals)} ${
          usdfToOther ? "USDC" : "USDF"
        } (${plan.expectedOutput} quarks)`,
        destinationVaultBalance: `${fmtQuarks(destVaultBal, destDecimals)} (${destVaultBal} quarks)`,
        ataPreInstructions: plan.preInstructions.length,
        userUsdfAta: plan.userUsdfAta.toBase58(),
        userOtherAta: plan.userOtherAta.toBase58(),
      },
      null,
      2,
    ),
  );

  if (plan.expectedOutput > destVaultBal) {
    console.warn(
      `\n⚠️  Destination vault has only ${destVaultBal} quarks; swap of ${plan.expectedOutput} quarks will fail.`,
    );
    if (!args.dryRun) {
      console.warn("    Re-run with --dry-run, or wait for the pool authority to refill the vault.");
      process.exit(2);
    }
  }

  if (args.dryRun) {
    console.log("\n(dry-run, not sending)");
    return;
  }

  const tx = new Transaction();
  tx.add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 80_000 }),
    ...plan.preInstructions,
    plan.swapIx,
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [signer], {
    commitment: "confirmed",
  });
  console.log(`\n✅ swap landed: ${sig}`);
  console.log(`   https://solscan.io/tx/${sig}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
