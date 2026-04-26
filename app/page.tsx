import Image from "next/image";
import Link from "next/link";
import { ChainStrip } from "@/components/ChainStrip";
import { InteractiveCard } from "@/components/InteractiveCard";

export default function Page() {
  return (
    <main className="relative min-h-screen flex flex-col">
      <Nav />

      <section className="relative px-4 pt-16 sm:pt-24 pb-10 flex flex-col items-center text-center">
        <div className="relative w-[110px] h-[110px] sm:w-[128px] sm:h-[128px] rounded-2xl overflow-hidden bg-black ring-1 ring-white/[0.08]">
          <Image
            src="/logo.png"
            alt="Wire"
            fill
            priority
            sizes="128px"
            className="object-cover"
          />
        </div>

        <h1 className="mt-7 text-[44px] sm:text-[64px] font-semibold tracking-[-0.04em] leading-[1.02]">
          The Flipcash
          <span className="block text-white/35">terminal.</span>
        </h1>
        <p className="mt-5 max-w-[440px] text-balance text-white/55 text-[15px] sm:text-[16px] leading-relaxed">
          Bridge USDF ↔ USDC. Swap into any of ~100 Flipcash currencies.
          Non-custodial, audited, open source.
        </p>

        <ChainStrip />
      </section>

      <section className="px-4 pb-10">
        <div className="w-full max-w-[440px] mx-auto">
          <InteractiveCard />
        </div>
      </section>

      <About />

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
          <IconLink
            href="https://github.com/wiredcash/Wired"
            label="GitHub"
            icon={<GithubIcon />}
          />
          <IconLink
            href="https://x.com/wired_cash"
            label="X"
            icon={<XIcon />}
          />
          <a
            className="hidden sm:inline-block px-3 py-1.5 rounded-full hover:bg-white/[0.05] hover:text-white transition-colors"
            href="https://wired.cash"
            target="_blank"
            rel="noreferrer"
          >
            wired.cash
          </a>
        </nav>
      </div>
    </header>
  );
}

function IconLink({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      title={label}
      className="w-9 h-9 rounded-full flex items-center justify-center text-white/55 hover:text-white hover:bg-white/[0.05] transition-colors"
    >
      {icon}
    </a>
  );
}

function About() {
  return (
    <section className="px-4 pb-16 sm:pb-20">
      <div className="w-full max-w-2xl mx-auto">
        <div className="flex items-center gap-2 mb-4 text-[11px] uppercase tracking-[0.2em] text-white/35">
          <span className="inline-block h-px w-6 bg-white/15" />
          About
        </div>
        <p className="text-[14.5px] sm:text-[15px] leading-relaxed text-white/65">
          Wire is an open-source, non-custodial interface for Flipcash. It
          talks directly to two audited Solana programs:{" "}
          <span className="text-white/85">usdf-swap</span> for 1:1 USDF↔USDC
          bridging, and <span className="text-white/85">flipcash</span> for
          bonding-curve trading of currencies denominated in USDF. Your
          wallet signs every transaction — no custody, no relayer, no spread
          on top of the on-chain pool.
        </p>
        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[12.5px] text-white/45">
          <a
            className="hover:text-white transition-colors"
            href="https://github.com/code-payments/usdf-swap-program"
            target="_blank"
            rel="noreferrer"
          >
            usdf-swap program ↗
          </a>
          <a
            className="hover:text-white transition-colors"
            href="https://github.com/code-payments/flipcash-program"
            target="_blank"
            rel="noreferrer"
          >
            flipcash program ↗
          </a>
          <a
            className="hover:text-white transition-colors"
            href="https://github.com/wiredcash/Wired"
            target="_blank"
            rel="noreferrer"
          >
            source ↗
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="mt-auto border-t border-white/[0.06] py-6 px-4">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-[12px] text-white/40">
        <p>
          Open source · MIT · v0.1 · 1:1 swaps capped at $2,000 per
          transaction.
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

function GithubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z"
      />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2H21l-6.51 7.44L22.5 22h-7.027l-5.5-7.21L3.6 22H.84l6.965-7.96L1.5 2h7.18l4.97 6.59L18.244 2Zm-2.466 18.27h1.53L7.27 3.624H5.63L15.778 20.27Z" />
    </svg>
  );
}
