"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { WalletButton } from "@/components/wallet-button";
import { SPRING_BOUNCY } from "@/lib/motion";
import { cn } from "@/lib/utils";

type Variant = "solid" | "glass";

/** Bare filled-seedling brand mark — Midnight Ink via currentColor, no container. */
function SproutLogo({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="shrink-0 text-midnight-ink"
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

function Brand({ logoSize = 22 }: { logoSize?: number }) {
  return (
    <Link href="/" className="flex items-center gap-0.5 text-midnight-ink">
      <SproutLogo size={logoSize} />
      <span className="font-alt text-2xl font-bold lowercase tracking-tight">
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
                  ? "text-midnight-ink"
                  : "text-muted-ash hover:text-midnight-ink"
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

export function SiteHeader({ variant = "glass" }: { variant?: Variant } = {}) {
  // Both variants are light now. "glass" is the floating header used across
  // the app: translucent canvas-white with a hairline + subtle elevation.
  if (variant === "glass") {
    return (
      <header className="fixed inset-x-0 top-0 z-30 w-full">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-8">
          <Brand logoSize={22} />
          <NavTabs />
          <WalletButton tone="glass" />
        </div>
      </header>
    );
  }

  return (
    <header className="w-full border-b border-hairline bg-canvas-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <Brand logoSize={24} />
          <NavTabs />
        </div>
        <WalletButton />
      </div>
    </header>
  );
}
