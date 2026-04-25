import Image from "next/image";
import Link from "next/link";
import { ChainStrip } from "@/components/ChainStrip";
import { InteractiveCard } from "@/components/InteractiveCard";

export default function Page() {
  return (
    <main className="relative min-h-screen flex flex-col">
      <Nav />

      <section className="relative px-4 pt-16 sm:pt-24 pb-10 flex flex-col items-center text-center">
        <div className="relative">
          {/* soft halo behind the logo */}
          <div
            aria-hidden
            className="absolute inset-0 -z-10 blur-3xl rounded-full"
            style={{
              background:
                "radial-gradient(closest-side, rgba(255,233,75,0.18), rgba(255,233,75,0) 70%)",
            }}
          />
          <div className="relative w-[120px] h-[120px] sm:w-[150px] sm:h-[150px] rounded-2xl overflow-hidden bg-black">
            <Image
              src="/logo.png"
              alt="Wire"
              fill
              priority
              sizes="150px"
              className="object-cover"
            />
          </div>
        </div>

        <h1 className="mt-8 text-5xl sm:text-7xl font-semibold tracking-[-0.04em] leading-none">
          The Flipcash
          <span className="block text-white/35">terminal.</span>
        </h1>
        <p className="mt-5 max-w-md text-balance text-white/55 text-base sm:text-[17px] leading-relaxed">
          Bridge USDF ↔ USDC at 1:1, or buy any Flipcash currency directly with
          USDF. Audited programs, your wallet, no spread.
        </p>

        <ChainStrip />
      </section>

      <section className="px-4 pb-16">
        <div className="w-full max-w-[440px] mx-auto">
          <InteractiveCard />
        </div>
      </section>

      <Footer />
    </main>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-30 backdrop-blur-md bg-black/40 border-b border-white/[0.06]">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-7 h-7 rounded-md overflow-hidden bg-black ring-1 ring-white/10">
            <Image src="/logo.png" alt="Wire" width={28} height={28} />
          </div>
          <span className="font-semibold tracking-tight">Wire</span>
        </Link>
        <nav className="flex items-center gap-1 text-[13px] text-white/55">
          <a
            className="px-3 py-1.5 rounded-full hover:bg-white/[0.05] hover:text-white transition-colors"
            href="https://wired.cash"
            target="_blank"
            rel="noreferrer"
          >
            wired.cash
          </a>
          <a
            className="px-3 py-1.5 rounded-full hover:bg-white/[0.05] hover:text-white transition-colors"
            href="https://x.com/wired_cash"
            target="_blank"
            rel="noreferrer"
          >
            X
          </a>
          <a
            className="px-3 py-1.5 rounded-full hover:bg-white/[0.05] hover:text-white transition-colors"
            href="https://github.com/code-payments/usdf-swap-program"
            target="_blank"
            rel="noreferrer"
          >
            program
          </a>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-auto border-t border-white/[0.06] py-8 px-4">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-[12px] text-white/40">
        <p>
          Open source · interacts directly with the audited{" "}
          <a
            className="underline-offset-4 hover:text-white hover:underline"
            href="https://github.com/code-payments/usdf-swap-program"
            target="_blank"
            rel="noreferrer"
          >
            usdf-swap-program
          </a>
          . 1:1 swaps · capped at $2,000 per transaction.
        </p>
        <p className="flex items-center gap-3">
          <a className="hover:text-white" href="https://wired.cash">
            wired.cash
          </a>
          <span aria-hidden>·</span>
          <a className="hover:text-white" href="https://x.com/wired_cash">
            @wired_cash
          </a>
        </p>
      </div>
    </footer>
  );
}
