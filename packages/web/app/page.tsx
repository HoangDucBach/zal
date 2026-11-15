import { ArrowRightIcon } from "@solar-icons/react/linear";
import { Card, Chip } from "@heroui/react";
import { buttonVariants } from "@heroui/styles";
import NextLink from "next/link";
import clsx from "clsx";

import { HeroGlobe } from "@/components/landing/hero-globe";
import { Logo } from "@/components/shell/logo";
import { localDeployConfig } from "@/contracts/deployments";

const KEYWORDS = [
  "Programmable payments",
  "Invoice NFTs",
  "Early cash",
  "Avalanche L1",
] as const;

/** Facts of the testnet build, not market numbers. */
const FACTS = [
  {
    label: "Advance rate",
    value: `${localDeployConfig.advanceRateBps / 100}%`,
  },
  { label: "Settlement", value: "1 tx" },
  { label: "Network", value: "Avalanche L1" },
  { label: "Money", value: "Testnet USDC" },
  { label: "Sandbox", value: "In browser" },
] as const;

export default function Landing() {
  return (
    <div className="relative flex h-screen min-h-160 flex-col overflow-hidden bg-background">
      <HeroGlobe />
      <header className="relative mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <nav className="flex items-center gap-2">
          <NextLink
            className={buttonVariants({ variant: "ghost", size: "sm" })}
            href="/app/docs"
          >
            Docs
          </NextLink>
          <NextLink
            className={buttonVariants({ variant: "secondary", size: "sm" })}
            href="/app/canvas"
          >
            Open app
          </NextLink>
        </nav>
      </header>

      <main className="pointer-events-none relative mx-auto flex w-full max-w-6xl flex-1 flex-col items-center px-6 pt-10 text-center md:pt-16">
        <span className="font-mono text-xs uppercase tracking-widest text-muted">
          On-chain payment canvas
        </span>
        <h1 className="mt-4 text-5xl font-light tracking-tight md:text-7xl">
          Program where money goes
        </h1>
        <p className="mt-5 max-w-xl text-base text-muted">
          Connect canvases, settle invoices through both flows in one
          transaction, and turn approved invoices into cash today.
        </p>
        <ul
          aria-label="What Zal does"
          className="mt-6 flex flex-wrap justify-center gap-2"
        >
          {KEYWORDS.map((keyword) => (
            <li key={keyword}>
              <Chip size="sm" variant="secondary">
                {keyword}
              </Chip>
            </li>
          ))}
        </ul>
        <div className="pointer-events-auto mt-8 flex flex-wrap justify-center gap-2">
          <NextLink
            className={buttonVariants({ variant: "primary" })}
            href="/app/canvas"
          >
            Open app
            <ArrowRightIcon aria-hidden size={16} />
          </NextLink>
          <NextLink
            className={buttonVariants({ variant: "secondary" })}
            href="/app/canvas?sandbox=1"
          >
            Try sandbox
          </NextLink>
        </div>
      </main>

      <footer className="relative mx-auto w-full max-w-6xl px-6 pb-6">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {FACTS.map((fact, index) => (
            <Card
              key={fact.label}
              // Four blocks fill a phone's two columns; the fifth waits for a wider screen.
              className={clsx(
                "gap-1 bg-background/40 px-4 py-3 backdrop-blur-md",
                index === FACTS.length - 1 && "hidden sm:flex",
              )}
              variant="transparent"
            >
              <dt className="font-mono text-xs uppercase tracking-widest text-muted">
                {fact.label}
              </dt>
              <dd className="text-lg font-light sm:text-xl">{fact.value}</dd>
            </Card>
          ))}
        </dl>
        <p className="mt-3 text-center text-xs text-muted">
          Testnet only. MockUSDC is test money and vault yield is simulated.
        </p>
      </footer>
    </div>
  );
}
