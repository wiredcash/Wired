import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { WalletProviders } from "@/components/WalletProviders";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://wired.cash"),
  title: "Wired — USDF ↔ USDC Bridge",
  description:
    "Open-source UI for the Flipcash USDF/USDC swap pool. 1:1 swaps, no spread.",
  openGraph: {
    title: "Wired — USDF ↔ USDC Bridge",
    description:
      "Open-source UI for the Flipcash USDF/USDC swap pool. 1:1 swaps, no spread.",
    url: "https://wired.cash",
    siteName: "Wired",
    images: ["/logo.png"],
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Wired — USDF ↔ USDC Bridge",
    description:
      "Open-source UI for the Flipcash USDF/USDC swap pool. 1:1 swaps, no spread.",
    site: "@wired_cash",
    creator: "@wired_cash",
    images: ["/logo.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-stage bg-grid min-h-screen antialiased">
        <WalletProviders>{children}</WalletProviders>
      </body>
    </html>
  );
}
