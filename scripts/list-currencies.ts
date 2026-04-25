#!/usr/bin/env tsx
/** Quick check of the flipcash SDK by listing currencies + their pools. */
import { Connection } from "@solana/web3.js";
import {
  CURRENCY_ACCOUNT_SIZE,
  FLIPCASH_PROGRAM_ID,
  POOL_ACCOUNT_SIZE,
  decodeCurrencyConfig,
  decodeLiquidityPool,
  findPoolPda,
} from "../lib/flipcash";

const RPC =
  process.env.SOLANA_RPC_URL ??
  "https://mainnet.helius-rpc.com/?api-key=027318d4-f3d4-4ff3-a490-c945bdb3a0af";

async function main() {
  const conn = new Connection(RPC, "confirmed");

  const currencyAccounts = await conn.getProgramAccounts(FLIPCASH_PROGRAM_ID, {
    filters: [{ dataSize: CURRENCY_ACCOUNT_SIZE }],
    encoding: "base64",
  });
  console.log(`currencies: ${currencyAccounts.length}`);

  const poolAccounts = await conn.getProgramAccounts(FLIPCASH_PROGRAM_ID, {
    filters: [{ dataSize: POOL_ACCOUNT_SIZE }],
    encoding: "base64",
  });
  console.log(`pools: ${poolAccounts.length}`);

  const currencies = currencyAccounts.map((a) =>
    decodeCurrencyConfig(a.pubkey, a.account.data as Buffer),
  );
  const pools = poolAccounts.map((a) =>
    decodeLiquidityPool(a.pubkey, a.account.data as Buffer),
  );
  const poolByCurrency = new Map(pools.map((p) => [p.currency.toBase58(), p]));

  // Print first 5 enriched
  for (const c of currencies.slice(0, 5)) {
    const pool = poolByCurrency.get(c.address.toBase58());
    const [poolPda] = findPoolPda(c.address);
    console.log({
      symbol: c.symbol,
      name: c.name,
      mint: c.mint.toBase58(),
      derived_pool: poolPda.toBase58(),
      indexed_pool: pool?.address.toBase58() ?? "(none)",
      vault_a: pool?.vaultA.toBase58(),
      vault_b: pool?.vaultB.toBase58(),
      sell_fee_bps: pool?.sellFeeBps,
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
