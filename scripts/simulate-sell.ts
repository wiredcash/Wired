#!/usr/bin/env tsx
/**
 * Simulate a multi-hop sell: currency → USDF → (bridge) USDC → (Jupiter) any.
 *
 *   npx tsx scripts/simulate-sell.ts <symbol> <output-token> <amount>
 *
 *   <symbol>        Currency to sell (e.g. JFY)
 *   <output-token>  USDF | USDC | SOL
 *   <amount>        Currency-token amount in display units (e.g. 1.5 JFY)
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { USDC_MINT, USDF_MINT } from "../lib/usdf-swap";
import { SOL_MINT } from "../lib/jupiter";
import { planMultiHopSell } from "../lib/multi-hop";
import { TOKEN_DECIMALS } from "../lib/flipcash";

const RPC =
  process.env.SOLANA_RPC_URL ??
  "https://mainnet.helius-rpc.com/?api-key=027318d4-f3d4-4ff3-a490-c945bdb3a0af";

const OUTPUT_MINTS: Record<string, PublicKey> = {
  USDF: USDF_MINT,
  USDC: USDC_MINT,
  SOL: SOL_MINT,
};

function toQuarks(amount: string, decimals: number): bigint {
  const [whole = "0", frac = ""] = amount.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

async function main() {
  const [symbol, outputKey, amountStr] = process.argv.slice(2);
  if (!symbol || !outputKey || !amountStr) {
    console.error("usage: simulate-sell <symbol> <USDF|USDC|SOL> <amount>");
    process.exit(2);
  }
  const outputMint = OUTPUT_MINTS[outputKey.toUpperCase()];
  if (!outputMint) throw new Error(`unknown output ${outputKey}`);

  const conn = new Connection(RPC, "confirmed");
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
    sellFeeBps: number | null;
  }>).find(
    (x) => x.symbol.toUpperCase() === symbol.toUpperCase() && x.pool,
  );
  if (!c) throw new Error(`currency ${symbol} not found or has no pool`);

  const keypairPath = resolve(process.cwd(), "keypair.json");
  const secret = JSON.parse(readFileSync(keypairPath, "utf8"));
  const signer = Keypair.fromSecretKey(Uint8Array.from(secret));

  const inAmount = toQuarks(amountStr, TOKEN_DECIMALS);

  const plan = await planMultiHopSell(conn, {
    user: signer.publicKey,
    sourceMint: new PublicKey(c.mint),
    inAmount,
    outputMint,
    slippageBps: 100,
    source: {
      pool: new PublicKey(c.pool!),
      vaultA: new PublicKey(c.vaultA!),
      vaultB: new PublicKey(c.vaultB!),
      reserveTokenQuarks: BigInt(c.reserveTokenQuarks ?? "0"),
      reserveUsdfQuarks: BigInt(c.reserveUsdfQuarks ?? "0"),
      sellFeeBps: c.sellFeeBps ?? 100,
    },
  });

  console.log(
    JSON.stringify(
      {
        route: plan.route,
        atomic: plan.atomic,
        txCount: plan.txs.length,
        txSizes: plan.txs.map((t) => ({ label: t.label, size: t.size })),
        worstUsdfQuarks: plan.worstUsdfQuarks.toString(),
        minOutputQuarks: plan.minOutputQuarks.toString(),
        expectedOutput: plan.expectedOutput,
        jupiterImpact: plan.jupiterQuote?.priceImpactPct ?? null,
      },
      null,
      2,
    ),
  );

  const first = plan.txs[0];
  first.tx.sign([signer]);
  const sim = await conn.simulateTransaction(first.tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });
  console.log("--- sim (first tx) ---");
  console.log("err:", sim.value.err);
  for (const l of (sim.value.logs ?? []).slice(-10)) console.log("  " + l);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
