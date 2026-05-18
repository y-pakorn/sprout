"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sprout } from "lucide-react";
import { WalletButton } from "@/components/wallet-button";
import { cn } from "@/lib/utils";

type Variant = "solid" | "glass";

function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center bg-cash-lime text-midnight-black"
      style={{ width: size, height: size, borderRadius: 12 }}
    >
      <Sprout className="size-[62%]" strokeWidth={2.4} />
    </span>
  );
}

function NavLink({
  href,
  label,
  variant,
}: {
  href: string;
  label: string;
  variant: Variant;
}) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      className={cn(
        "transition-colors",
        variant === "solid" &&
          "px-3 py-1.5 text-body-sm font-medium hover:opacity-70",
        variant === "solid" && active && "bg-cloud-gray text-midnight-black",
        variant === "solid" && !active && "bg-transparent text-subtle-gray",
        variant === "glass" &&
          "px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]",
        variant === "glass" && active && "bg-white/15 text-canvas-white",
        variant === "glass" &&
          !active &&
          "bg-transparent text-white/75 hover:text-canvas-white",
      )}
      style={{ borderRadius: 9999 }}
    >
      {label}
    </Link>
  );
}

export function SiteHeader({ variant = "solid" }: { variant?: Variant } = {}) {
  if (variant === "glass") {
    return (
      <header className="fixed inset-x-0 top-0 z-50 w-full">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-8">
          {/* Wordmark only — no lime square (it stamps too hard on the grass). */}
          <Link
            href="/"
            className="flex items-center gap-1.5 text-canvas-white"
          >
            <Sprout
              className="size-4 text-cash-lime"
              strokeWidth={2.6}
              aria-hidden
            />
            <span className="text-body-sm font-semibold tracking-tight">
              Sprout
              <sup className="ml-0.5 text-[8px] font-medium opacity-70">
                TM
              </sup>
            </span>
          </Link>
          <nav
            className="liquid-glass flex items-center gap-0.5 px-1 py-1"
            style={{ borderRadius: 9999 }}
          >
            <NavLink href="/" label="Plant" variant="glass" />
            <NavLink href="/portfolio" label="Portfolio" variant="glass" />
          </nav>
          <WalletButton tone="glass" />
        </div>
      </header>
    );
  }

  return (
    <header className="w-full bg-canvas-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2">
            <BrandMark />
            <span className="text-body font-semibold">Sprout</span>
          </Link>
          <nav className="flex items-center gap-1">
            <NavLink href="/" label="Plant" variant="solid" />
            <NavLink href="/portfolio" label="Portfolio" variant="solid" />
          </nav>
        </div>
        <WalletButton />
      </div>
    </header>
  );
}
