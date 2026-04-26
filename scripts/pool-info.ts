#!/usr/bin/env tsx
/** Print the current state of the canonical Flipcash USDF↔USDC pool. */
import { Connection } from "@solana/web3.js";
import { FLIPCASH_USDF_USDC_POOL, fetchPoolState } from "../lib/usdf-swap";

async function main() {
  const rpc =
    process.env.SOLANA_RPC_URL ??
    "https://api.mainnet-beta.solana.com";
  const conn = new Connection(rpc, "confirmed");

  const pool = await fetchPoolState(conn, FLIPCASH_USDF_USDC_POOL);
  const [usdfBal, otherBal] = await Promise.all([
    conn.getTokenAccountBalance(pool.usdfVault),
    conn.getTokenAccountBalance(pool.otherVault),
  ]);
  console.log(
    JSON.stringify(
      {
        pool: pool.address.toBase58(),
        name: pool.name,
        authority: pool.authority.toBase58(),
        mints: {
          usdf: pool.usdfMint.toBase58(),
          other: pool.otherMint.toBase58(),
        },
        vaults: {
          usdf: {
            address: pool.usdfVault.toBase58(),
            balance: usdfBal.value.uiAmountString,
            decimals: pool.usdfDecimals,
          },
          other: {
            address: pool.otherVault.toBase58(),
            balance: otherBal.value.uiAmountString,
            decimals: pool.otherDecimals,
          },
        },
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
