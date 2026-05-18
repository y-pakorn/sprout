"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  useCurrentAccount,
  useConnectWallet,
  useDisconnectWallet,
  useResolveSuiNSName,
  useWallets,
} from "@mysten/dapp-kit";

type DetectedWallet = ReturnType<typeof useWallets>[number];
import {
  ChevronDown,
  Copy,
  Check,
  ExternalLink,
  LogOut,
  Wallet as WalletIcon,
  X,
} from "lucide-react";
import { SPRING_BOUNCY } from "@/lib/motion";

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Stable initial for the avatar — uses SuiNS first letter or address byte */
function avatarLetter(name: string | null | undefined, addr: string): string {
  if (name && name.length > 0) return name[0].toUpperCase();
  // 3rd char of address (skip "0x") tends to vary more than the leading chars
  return (addr[2] ?? "?").toUpperCase();
}

/** Stable lime variant for the avatar background */
function avatarTone(addr: string): string {
  // Hash the address into a hue range that stays near lime
  let h = 0;
  for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) | 0;
  const shift = (Math.abs(h) % 40) - 20; // ±20° from base
  return `hsl(${135 + shift} 100% 42%)`;
}

export function WalletButton({
  tone = "default",
}: { tone?: "default" | "glass" } = {}) {
  const account = useCurrentAccount();
  const { data: suins } = useResolveSuiNSName(account?.address ?? null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  if (!account) {
    const glass = tone === "glass";
    return (
      <>
        <motion.button
          onClick={() => setConnectOpen(true)}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: "spring", visualDuration: 0.2, bounce: 0.3 }}
          className={
            glass
              ? "liquid-glass inline-flex items-center gap-1.5 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-canvas-white hover:text-canvas-white"
              : "inline-flex items-center gap-2 bg-cash-lime px-5 py-2.5 text-body-sm font-semibold text-midnight-black"
          }
          style={{ borderRadius: 9999 }}
        >
          <WalletIcon
            className={glass ? "size-3.5" : "size-4"}
            strokeWidth={2.4}
          />
          {glass ? "Connect" : "Connect wallet"}
        </motion.button>
        <ConnectDialog
          open={connectOpen}
          onClose={() => setConnectOpen(false)}
        />
      </>
    );
  }

  const displayName = suins ?? shortAddr(account.address);
  const isNamed = !!suins;

  return (
    <div ref={containerRef} className="relative">
      <motion.button
        onClick={() => setMenuOpen((v) => !v)}
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        transition={{ type: "spring", visualDuration: 0.2, bounce: 0.3 }}
        className={
          tone === "glass"
            ? "liquid-glass inline-flex items-center gap-2 pl-1.5 pr-3 py-1 text-body-sm font-semibold text-canvas-white"
            : "inline-flex items-center gap-2 bg-cloud-gray pl-1.5 pr-3 py-1 text-body-sm font-semibold text-midnight-black"
        }
        style={{ borderRadius: 9999 }}
      >
        <span
          className="inline-flex size-7 items-center justify-center text-canvas-white text-caption font-bold"
          style={{
            borderRadius: 9999,
            background: avatarTone(account.address),
            letterSpacing: 0,
          }}
        >
          {avatarLetter(suins, account.address)}
        </span>
        <span className={isNamed ? "" : "font-mono tabular-nums"}>
          {displayName}
        </span>
        <motion.span
          animate={{ rotate: menuOpen ? 180 : 0 }}
          transition={{ type: "spring", visualDuration: 0.2, bounce: 0.3 }}
          className="inline-flex"
        >
          <ChevronDown className="size-3.5" strokeWidth={2.4} />
        </motion.span>
      </motion.button>

      <AnimatePresence>
        {menuOpen && (
          <WalletMenu
            address={account.address}
            suins={suins ?? null}
            onClose={() => setMenuOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function WalletMenu({
  address,
  suins,
  onClose,
}: {
  address: string;
  suins: string | null;
  onClose: () => void;
}) {
  const { mutate: disconnect } = useDisconnectWallet();
  const [copied, setCopied] = useState(false);

  function copyAddress() {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.97 }}
      transition={{ type: "spring", visualDuration: 0.25, bounce: 0.2 }}
      style={{ borderRadius: 20, zIndex: 50, transformOrigin: "top right" }}
      className="absolute right-0 top-[calc(100%+8px)] w-72 bg-canvas-white p-2 shadow-[0_18px_60px_-20px_rgba(0,0,0,0.25)]"
    >
      <div
        className="flex items-center gap-3 bg-cloud-gray px-3 py-3"
        style={{ borderRadius: 14 }}
      >
        <span
          className="inline-flex size-10 shrink-0 items-center justify-center text-canvas-white text-body font-bold"
          style={{
            borderRadius: 14,
            background: avatarTone(address),
            letterSpacing: 0,
          }}
        >
          {avatarLetter(suins, address)}
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          {suins ? (
            <>
              <div className="truncate text-body font-semibold leading-tight">
                {suins}
              </div>
              <div className="truncate font-mono text-body-sm text-subtle-gray">
                {shortAddr(address)}
              </div>
            </>
          ) : (
            <>
              <div className="text-caption font-medium uppercase tracking-wider text-subtle-gray">
                Connected
              </div>
              <div className="break-all font-mono text-body-sm leading-tight">
                {shortAddr(address)}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="mt-1 space-y-0.5">
        <MenuItem
          Icon={copied ? Check : Copy}
          label={copied ? "Copied!" : "Copy address"}
          onClick={copyAddress}
        />
        <MenuItem
          Icon={ExternalLink}
          label="View on Suiscan"
          href={`https://suiscan.xyz/mainnet/account/${address}`}
        />
        <div className="my-1 h-px bg-ghost-border" />
        <MenuItem
          Icon={LogOut}
          label="Disconnect"
          onClick={() => {
            disconnect();
            onClose();
          }}
          danger
        />
      </div>
    </motion.div>
  );
}

function MenuItem({
  Icon,
  label,
  onClick,
  href,
  danger,
}: {
  Icon: typeof Copy;
  label: string;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
}) {
  const cls = `flex w-full items-center gap-2.5 px-3 py-2 text-left text-body-sm font-medium transition-colors ${
    danger
      ? "text-destructive hover:bg-destructive/10"
      : "text-midnight-black hover:bg-cloud-gray"
  }`;
  const inner = (
    <>
      <Icon className="size-4" strokeWidth={2.2} />
      {label}
    </>
  );
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={cls}
        style={{ borderRadius: 12 }}
      >
        {inner}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cls}
      style={{ borderRadius: 12 }}
    >
      {inner}
    </button>
  );
}

function ConnectDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const wallets = useWallets();
  const { mutate: connect } = useConnectWallet();

  function handleConnect(wallet: DetectedWallet) {
    connect({ wallet }, { onSuccess: onClose });
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-midnight-black/35"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 6 }}
            transition={SPRING_BOUNCY}
            style={{ borderRadius: 24 }}
            className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 bg-canvas-white p-6 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.35)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-caption font-medium uppercase tracking-wider text-subtle-gray">
                  Sui
                </div>
                <div className="text-body-lg font-semibold leading-tight">
                  Connect a wallet
                </div>
                <div className="text-body-sm text-subtle-gray">
                  Pick how you want to sign in.
                </div>
              </div>
              <motion.button
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.92 }}
                onClick={onClose}
                aria-label="Close"
                className="inline-flex size-8 items-center justify-center bg-cloud-gray text-midnight-black"
                style={{ borderRadius: 9999 }}
              >
                <X className="size-4" strokeWidth={2.4} />
              </motion.button>
            </div>

            <div className="mt-5 space-y-2">
              {wallets.length === 0 ? (
                <div
                  className="space-y-2 bg-cloud-gray p-6 text-center"
                  style={{ borderRadius: 18 }}
                >
                  <div className="text-body font-semibold">
                    No wallet detected
                  </div>
                  <div className="text-body-sm text-subtle-gray">
                    Install{" "}
                    <a
                      href="https://slush.app"
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-midnight-black underline"
                    >
                      Slush
                    </a>{" "}
                    or any Sui-compatible wallet to continue.
                  </div>
                </div>
              ) : (
                wallets.map((wallet) => (
                  <motion.button
                    key={wallet.name}
                    type="button"
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    transition={{
                      type: "spring",
                      visualDuration: 0.2,
                      bounce: 0.3,
                    }}
                    onClick={() => handleConnect(wallet)}
                    className="flex w-full items-center gap-3 bg-cloud-gray p-4 transition-colors hover:bg-canvas-white hover:ring-2 hover:ring-cash-lime"
                    style={{ borderRadius: 18 }}
                  >
                    {wallet.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={wallet.icon}
                        alt=""
                        width={36}
                        height={36}
                        style={{ borderRadius: 14 }}
                      />
                    ) : (
                      <span
                        className="inline-flex size-9 items-center justify-center bg-canvas-white text-midnight-black"
                        style={{ borderRadius: 14 }}
                      >
                        <WalletIcon className="size-4" strokeWidth={2.4} />
                      </span>
                    )}
                    <div className="flex-1 text-left">
                      <div className="text-body font-semibold leading-tight">
                        {wallet.name}
                      </div>
                      <div className="text-body-sm text-subtle-gray">
                        Tap to connect
                      </div>
                    </div>
                    <ChevronDown
                      className="size-4 -rotate-90 text-subtle-gray"
                      strokeWidth={2.2}
                    />
                  </motion.button>
                ))
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
