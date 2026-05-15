"use client";

import { ConnectButton } from "@mysten/dapp-kit";
import Link from "next/link";
import { usePathname } from "next/navigation";

function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center bg-cash-lime text-canvas-white"
      style={{ width: size, height: size, borderRadius: 14 }}
    >
      <svg viewBox="0 0 24 24" fill="none" className="size-[60%]">
        <path
          d="M12 4c2 2 3 4.5 3 7a3 3 0 1 1-6 0c0-2.5 1-5 3-7Z"
          fill="currentColor"
        />
        <path
          d="M9 13.5c-1.5 1.5-3.5 2-5.5 2 .5 2.5 2.5 4 5.5 4"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
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
        <ConnectButton />
      </div>
    </header>
  );
}
