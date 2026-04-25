"use client";

import { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import "@solana/wallet-adapter-react-ui/styles.css";

const DEFAULT_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  "https://mainnet.helius-rpc.com/?api-key=027318d4-f3d4-4ff3-a490-c945bdb3a0af";

export function WalletProviders({ children }: { children: React.ReactNode }) {
  // Mobile wallets like Phantom and Solflare are detected automatically via
  // the wallet-standard discovery; we only need to seed legacy adapters.
  // Torus dropped — its OAuth redirect breaks inside in-app browsers.
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );
  return (
    <ConnectionProvider endpoint={DEFAULT_RPC}>
      {/* autoConnect off: it can race on mobile and we'd rather the page
          render before any wallet handshake. */}
      <WalletProvider wallets={wallets} autoConnect={false}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
