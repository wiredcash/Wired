#!/usr/bin/env tsx
/**
 * Compose a multi-hop buy tx end-to-end and report tx size + simulation
 * outcome. Doesn't sign or send. Useful for confirming a given (input,
 * amount, target) combination fits in a single Solana tx.
 *
 *   npx tsx scripts/simulate-multihop.ts <symbol> <input-token> <amount>
 *
 *   <symbol>       Flipcash currency symbol (e.g. JFY, MNY)
 *   <input-token>  USDF | USDC | SOL
 *   <amount>       Display units of the input (e.g. 0.05 SOL, 1 USDC, 0.5 USDF)
 */
import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  USDC_MINT,
  USDF_MINT,
} from "../lib/usdf-swap";
import { SOL_MINT } from "../lib/jupiter";
import { planMultiHopBuy } from "../lib/multi-hop";
import { TOKEN_DECIMALS, USDF_DECIMALS } from "../lib/flipcash";

const RPC =
  process.env.SOLANA_RPC_URL ??
  "https://api.mainnet-beta.solana.com";

const INPUT_MINTS: Record<string, { mint: PublicKey; decimals: number }> = {
  USDF: { mint: USDF_MINT, decimals: USDF_DECIMALS },
  USDC: { mint: USDC_MINT, decimals: USDF_DECIMALS },
  SOL: { mint: SOL_MINT, decimals: 9 },
};

function toQuarks(amount: string, decimals: number): bigint {
  const [whole = "0", frac = ""] = amount.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

async function main() {
  const [symbol, inputKey, amountStr] = process.argv.slice(2);
  if (!symbol || !inputKey || !amountStr) {
    console.error("usage: simulate-multihop <symbol> <USDF|USDC|SOL> <amount>");
    process.exit(2);
  }
  const inputInfo = INPUT_MINTS[inputKey.toUpperCase()];
  if (!inputInfo) throw new Error(`unknown input ${inputKey}`);

  const conn = new Connection(RPC, "confirmed");

  // Pull the indexer to find the target currency by symbol.
  const idxRes = await fetch(
    "http://localhost:3127/api/currencies",
  ).then((r) => r.json());
  const c = (idxRes.items as Array<{
    symbol: string;
    mint: string;
    pool: string | null;
    vaultA: string | null;
    vaultB: string | null;
    reserveTokenQuarks: string | null;
    reserveUsdfQuarks: string | null;
  }>).find(
    (x) => x.symbol.toUpperCase() === symbol.toUpperCase() && x.pool,
  );
  if (!c) throw new Error(`currency ${symbol} not found or has no pool`);

  const keypairPath = resolve(process.cwd(), "keypair.json");
  const secret = JSON.parse(readFileSync(keypairPath, "utf8"));
  const signer = Keypair.fromSecretKey(Uint8Array.from(secret));

  const inAmount = toQuarks(amountStr, inputInfo.decimals);

  console.log(
    JSON.stringify(
      {
        signer: signer.publicKey.toBase58(),
        target: { symbol: c.symbol, mint: c.mint, pool: c.pool },
        input: `${amountStr} ${inputKey} (${inAmount} smallest units)`,
      },
      null,
      2,
    ),
  );

  const plan = await planMultiHopBuy(conn, {
    user: signer.publicKey,
    inputMint: inputInfo.mint,
    inAmount,
    slippageBps: 100,
    target: {
      mint: new PublicKey(c.mint),
      pool: new PublicKey(c.pool!),
      vaultA: new PublicKey(c.vaultA!),
      vaultB: new PublicKey(c.vaultB!),
      reserveTokenQuarks: BigInt(c.reserveTokenQuarks ?? "0"),
      reserveUsdfQuarks: BigInt(c.reserveUsdfQuarks ?? "0"),
    },
  });

  console.log(
    JSON.stringify(
      {
        provider: plan.provider,
        route: plan.route,
        routeSteps: plan.routeSteps,
        atomic: plan.atomic,
        txCount: plan.txs.length,
        txSizes: plan.txs.map((t) => ({ label: t.label, size: t.size })),
        bundle: plan.txs.length > 1 ? "Jito bundle (one signAllTransactions prompt)" : "single tx",
        worstUsdfQuarks: plan.worstUsdfQuarks.toString(),
        minTokensOutQuarks: plan.minTokensOutQuarks.toString(),
        expectedTokensOut: plan.expectedTokensOut,
        jupiterImpact: plan.jupiterQuote?.priceImpactPct ?? null,
      },
      null,
      2,
    ),
  );

  // Sign + simulate the first tx (others depend on its state landing).
  const first = plan.txs[0];
  first.tx.sign([signer]);
  const sim = await conn.simulateTransaction(first.tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });
  console.log("--- simulation (first tx) ---");
  console.log("err:", sim.value.err);
  console.log("logs (last 12):");
  for (const l of (sim.value.logs ?? []).slice(-12)) console.log("  " + l);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
