import { Connection, PublicKey } from "@solana/web3.js";
import {
  CURRENCY_ACCOUNT_SIZE,
  FLIPCASH_PROGRAM_ID,
  POOL_ACCOUNT_SIZE,
  decodeCurrencyConfig,
  decodeLiquidityPool,
  type CurrencyConfig,
  type LiquidityPool,
} from ".";

export type IndexedCurrency = {
  mint: string;
  symbol: string;
  name: string;
  metadataName: string | null;
  image: string | null;
  description: string | null;
  currency: string;
  pool: string | null;
  vaultA: string | null; // target vault (currency tokens)
  vaultB: string | null; // base vault (USDF)
  sellFeeBps: number | null;
  /** Tokens still in the pool (raw quarks, 10 decimals). Sold = MAX*10^10 - this. */
  reserveTokenQuarks: string | null;
  /** USDF currently in pool (6 decimals). */
  reserveUsdfQuarks: string | null;
};

type AssetMetadata = {
  symbol?: string;
  name?: string;
  image?: string;
  description?: string;
};

async function fetchAssetMetadata(
  rpcUrl: string,
  mints: string[],
): Promise<Map<string, AssetMetadata>> {
  const out = new Map<string, AssetMetadata>();
  // Helius DAS supports up to 1000 ids per getAssetBatch; we'll batch at 100
  // for safety against payload size.
  for (let i = 0; i < mints.length; i += 100) {
    const ids = mints.slice(i, i + 100);
    const resp = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "ix",
        method: "getAssetBatch",
        params: { ids },
      }),
    });
    if (!resp.ok) continue;
    const json = (await resp.json()) as {
      result?: Array<{
        id: string;
        content?: {
          metadata?: { name?: string; symbol?: string; description?: string };
          links?: { image?: string };
          files?: Array<{ uri?: string; cdn_uri?: string }>;
        };
      } | null>;
    };
    for (const a of json.result ?? []) {
      if (!a) continue;
      const md = a.content?.metadata ?? {};
      const link = a.content?.links?.image ?? a.content?.files?.[0]?.cdn_uri;
      out.set(a.id, {
        name: md.name,
        symbol: md.symbol,
        description: md.description,
        image: link,
      });
    }
  }
  return out;
}

async function fetchVaultBalances(
  connection: Connection,
  vaults: PublicKey[],
): Promise<Map<string, bigint>> {
  const out = new Map<string, bigint>();
  // getMultipleAccountsInfo — 100 max per call
  for (let i = 0; i < vaults.length; i += 100) {
    const slice = vaults.slice(i, i + 100);
    const infos = await connection.getMultipleAccountsInfo(slice);
    for (let j = 0; j < slice.length; j++) {
      const info = infos[j];
      if (!info) continue;
      // SPL token account: amount is u64 LE at offset 64
      try {
        const amount = info.data.readBigUInt64LE(64);
        out.set(slice[j].toBase58(), amount);
      } catch {}
    }
  }
  return out;
}

export async function indexCurrencies(
  connection: Connection,
  rpcUrl: string,
): Promise<IndexedCurrency[]> {
  const [currencyAccs, poolAccs] = await Promise.all([
    connection.getProgramAccounts(FLIPCASH_PROGRAM_ID, {
      filters: [{ dataSize: CURRENCY_ACCOUNT_SIZE }],
      encoding: "base64",
    }),
    connection.getProgramAccounts(FLIPCASH_PROGRAM_ID, {
      filters: [{ dataSize: POOL_ACCOUNT_SIZE }],
      encoding: "base64",
    }),
  ]);

  const currencies: CurrencyConfig[] = currencyAccs.map((a) =>
    decodeCurrencyConfig(a.pubkey, a.account.data as Buffer),
  );
  const pools: LiquidityPool[] = poolAccs.map((a) =>
    decodeLiquidityPool(a.pubkey, a.account.data as Buffer),
  );

  const poolByCurrency = new Map(
    pools.map((p) => [p.currency.toBase58(), p]),
  );

  const mints = currencies.map((c) => c.mint.toBase58());
  const vaultPubkeys: PublicKey[] = [];
  for (const c of currencies) {
    const p = poolByCurrency.get(c.address.toBase58());
    if (p) {
      vaultPubkeys.push(p.vaultA, p.vaultB);
    }
  }

  const [metadata, vaultBalances] = await Promise.all([
    fetchAssetMetadata(rpcUrl, mints),
    fetchVaultBalances(connection, vaultPubkeys),
  ]);

  const out: IndexedCurrency[] = currencies.map((c) => {
    const pool = poolByCurrency.get(c.address.toBase58()) ?? null;
    const md = metadata.get(c.mint.toBase58());
    const vaultABal = pool
      ? (vaultBalances.get(pool.vaultA.toBase58()) ?? null)
      : null;
    const vaultBBal = pool
      ? (vaultBalances.get(pool.vaultB.toBase58()) ?? null)
      : null;
    return {
      mint: c.mint.toBase58(),
      symbol: c.symbol,
      name: c.name,
      metadataName: md?.name ?? null,
      image: md?.image ?? null,
      description: md?.description ?? null,
      currency: c.address.toBase58(),
      pool: pool?.address.toBase58() ?? null,
      vaultA: pool?.vaultA.toBase58() ?? null,
      vaultB: pool?.vaultB.toBase58() ?? null,
      sellFeeBps: pool?.sellFeeBps ?? null,
      reserveTokenQuarks: vaultABal === null ? null : vaultABal.toString(),
      reserveUsdfQuarks: vaultBBal === null ? null : vaultBBal.toString(),
    };
  });

  // Sort by USDF reserve descending — most-traded currencies on top.
  out.sort((a, b) => {
    const ar = a.reserveUsdfQuarks ? BigInt(a.reserveUsdfQuarks) : 0n;
    const br = b.reserveUsdfQuarks ? BigInt(b.reserveUsdfQuarks) : 0n;
    if (ar === br) return a.symbol.localeCompare(b.symbol);
    return ar > br ? -1 : 1;
  });

  return out;
}
