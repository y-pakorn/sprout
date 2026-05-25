"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sprout } from "lucide-react";
import { WalletButton } from "@/components/wallet-button";
import { cn } from "@/lib/utils";

type Variant = "solid" | "glass";

function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center bg-midnight-ink text-canvas-white rounded-button"
      style={{ width: size, height: size }}
    >
      <Sprout className="size-[62%]" strokeWidth={2.4} />
    </span>
  );
}

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      className={cn(
        "rounded-button px-3 py-1.5 text-body-sm font-medium transition-colors",
        active
          ? "bg-whisper-gray text-midnight-ink"
          : "text-muted-ash hover:text-midnight-ink",
      )}
    >
      {label}
    </Link>
  );
}

export function SiteHeader({ variant = "glass" }: { variant?: Variant } = {}) {
  // Both variants are light now. "glass" is the floating header used across
  // the app: translucent canvas-white with a hairline + subtle elevation.
  if (variant === "glass") {
    return (
      <header className="fixed inset-x-0 top-0 z-50 w-full border-b border-hairline bg-canvas-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-8">
          <Link href="/" className="flex items-center gap-2 text-midnight-ink">
            <BrandMark size={24} />
            <span className="text-body-sm font-medium">
              Sprout
              <sup className="ml-0.5 text-[8px] font-medium text-muted-ash">
                TM
              </sup>
            </span>
          </Link>
          <nav className="flex items-center gap-0.5">
            <NavLink href="/" label="Plant" />
            <NavLink href="/portfolio" label="Portfolio" />
          </nav>
          <WalletButton tone="glass" />
        </div>
      </header>
    );
  }

  return (
    <header className="w-full border-b border-hairline bg-canvas-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2">
            <BrandMark />
            <span className="text-body font-medium">Sprout</span>
          </Link>
          <nav className="flex items-center gap-1">
            <NavLink href="/" label="Plant" />
            <NavLink href="/portfolio" label="Portfolio" />
          </nav>
        </div>
        <WalletButton />
      </div>
    </header>
  );
}
