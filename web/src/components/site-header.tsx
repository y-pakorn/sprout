"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sprout } from "lucide-react";
import { WalletButton } from "@/components/wallet-button";

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

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 text-body-sm font-medium transition-opacity hover:opacity-70 ${
        active
          ? "bg-cloud-gray text-midnight-black"
          : "bg-transparent text-subtle-gray"
      }`}
      style={{ borderRadius: 9999 }}
    >
      {label}
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="w-full bg-canvas-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2">
            <BrandMark />
            <span className="text-body font-semibold">Sprout</span>
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
