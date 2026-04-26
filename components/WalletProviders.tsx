"use client";

import { useEffect, useMemo, useState } from "react";
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

/**
 * Browser RPC endpoint. Always /api/rpc on this origin so the upstream
 * URL (which carries our paid-tier API key) stays server-side. The
 * Connection class also derives a WS endpoint from this URL, but Wired
 * never subscribes, so the (broken) ws derivation is never used.
 */
function browserRpcEndpoint(): string {
  if (typeof window === "undefined") {
    // SSR fallback. Connection isn't actually instantiated here, but the
    // value must be a parseable URL for compileToV0Message etc.
    return "https://api.mainnet-beta.solana.com";
  }
  return `${window.location.origin}/api/rpc`;
}

export function WalletProviders({ children }: { children: React.ReactNode }) {
  const [endpoint, setEndpoint] = useState<string>(() =>
    browserRpcEndpoint(),
  );

  useEffect(() => {
    setEndpoint(browserRpcEndpoint());
  }, []);

  // Mobile wallets like Phantom and Solflare are detected automatically via
  // the wallet-standard discovery; we only need to seed legacy adapters.
  // Torus dropped — its OAuth redirect breaks inside in-app browsers.
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );
  return (
    <ConnectionProvider endpoint={endpoint}>
      {/* autoConnect off: it can race on mobile and we'd rather the page
          render before any wallet handshake. */}
      <WalletProvider wallets={wallets} autoConnect={false}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
