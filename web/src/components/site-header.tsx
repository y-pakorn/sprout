"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { WalletButton } from "@/components/wallet-button";
import { SPRING_BOUNCY } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Bare filled-seedling brand mark — Midnight Ink via currentColor, no container. */
function SproutLogo({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="shrink-0"
    >
      <path
        d="M12 22C11.3 18 11.4 14 12.4 10.5"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11.4 12.8C11.8 7.8 8.6 3.9 3.1 4 2.2 9 5.4 12.9 11.4 12.8Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path
        d="M12.6 11C12 6.2 14.9 2.4 20.4 2.6 21.6 7.3 18.7 11.2 12.6 11Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Brand({ logoSize = 18 }: { logoSize?: number }) {
  return (
    <Link href="/" className="flex items-center gap-0.5 text-canvas-white">
      <SproutLogo size={logoSize} />
      <span className="font-alt text-2xl font-semibold lowercase tracking-tight mb-0.5">
        sprout
      </span>
    </Link>
  );
}

const TABS = [
  { href: "/", label: "Plant" },
  { href: "/feed", label: "Feed" },
  { href: "/portfolio", label: "Portfolio" },
];

function NavTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className="relative rounded-button px-4 py-1.5 font-medium font-alt tracking-tight transition-colors"
          >
            {active && (
              <motion.span
                layoutId="nav-active-pill"
                transition={SPRING_BOUNCY}
                className="absolute inset-0 rounded-button bg-canvas-white ring-1 ring-hairline shadow-button"
              />
            )}
            <span
              className={cn(
                "relative z-10",
                active
                  ? "text-midnight-ink font-semibold"
                  : "text-canvas-white/55 hover:text-canvas-white"
              )}
            >
              {t.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

export function SiteHeader() {
  // A single centered floating bar (Skiff-style): the brand, nav tabs, and
  // wallet CTA grouped inside one charcoal capsule rather than spread edge-to-edge.
  return (
    <header className="fixed inset-x-0 top-3 z-30 flex w-full justify-center px-4">
      <div className="flex items-center gap-1.5 rounded-md bg-surface-charcoal py-1.5 pl-4 pr-1.5 ring-1 ring-canvas-white/15 shadow-header">
        <Brand />
        <span
          className="mx-2 h-5 w-px shrink-0 bg-canvas-white/15"
          aria-hidden
        />
        <NavTabs />
        <span
          className="mx-2 h-5 w-px shrink-0 bg-canvas-white/15"
          aria-hidden
        />
        <WalletButton tone="glass" />
      </div>
    </header>
  );
}
