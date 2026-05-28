"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  useCurrentAccount,
  useWallets,
  useDAppKit,
} from "@mysten/dapp-kit-react";

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
import { Dialog } from "@base-ui/react";
import { cn } from "@/lib/utils";
import { PillButton } from "@/components/ui/pill-button";
import { shortAddr } from "@/lib/avatar";
import { Identicon } from "@/components/ui/identicon";

export function WalletButton({
  tone = "default",
}: { tone?: "default" | "glass" } = {}) {
  const account = useCurrentAccount();
  // SuiNS reverse-resolution isn't wired on the new gRPC client yet — fall
  // back to the short address (display already handles the no-name case).
  const suins: string | null = null;
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
        <PillButton
          variant={glass ? "secondary" : "primary"}
          onClick={() => setConnectOpen(true)}
          className={
            glass
              ? "gap-1.5 bg-canvas-white shadow-button hover:bg-whisper-gray"
              : "gap-2 px-5 py-2.5"
          }
        >
          <WalletIcon
            className={glass ? "size-3.5" : "size-4"}
            strokeWidth={2.4}
          />
          {glass ? "Connect" : "Connect wallet"}
        </PillButton>
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
        className="inline-flex items-center gap-2 h-9 bg-canvas-white pl-1.5 pr-3 py-1 text-body-sm font-medium text-midnight-ink ring-1 ring-hairline shadow-button rounded-button"
      >
        <Identicon address={account.address} size={24} />
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
  const dAppKit = useDAppKit();
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
      className="absolute right-0 top-[calc(100%+8px)] z-50 w-60 origin-top-right rounded-card bg-canvas-white p-1.5 ring-1 ring-hairline shadow-header"
    >
      <div className="flex items-center gap-2.5 bg-whisper-gray px-2.5 py-2.5 rounded-card">
        <Identicon address={address} size={32} className="shrink-0" />
        <div className="min-w-0 flex-1 space-y-0.5">
          {suins ? (
            <>
              <div className="truncate text-body-sm font-medium leading-tight">
                {suins}
              </div>
              <div className="truncate font-mono text-caption text-muted-ash">
                {shortAddr(address)}
              </div>
            </>
          ) : (
            <>
              <div className="text-caption font-medium uppercase tracking-wider text-muted-ash">
                Connected
              </div>
              <div className="break-all font-mono text-caption leading-tight">
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
        <div className="my-1 h-px bg-hairline" />
        <MenuItem
          Icon={LogOut}
          label="Disconnect"
          onClick={() => {
            void dAppKit.disconnectWallet();
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
  const cls = cn(
    "flex w-full items-center gap-2 rounded-button px-2.5 py-1.5 text-left text-body-sm font-medium transition-colors",
    danger
      ? "text-destructive hover:bg-destructive/10"
      : "text-midnight-ink hover:bg-whisper-gray"
  );
  const inner = (
    <>
      <Icon className="size-3.5" strokeWidth={2.2} />
      {label}
    </>
  );
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {inner}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
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
  const dAppKit = useDAppKit();
  const wallets = useWallets({
    dAppKit,
  });

  function handleConnect(wallet: DetectedWallet) {
    dAppKit
      .connectWallet({ wallet })
      .then(onClose)
      .catch(() => {});
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-midnight-ink/30 backdrop-blur-sm transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden bg-canvas-white shadow-[0_24px_80px_-20px_rgba(0,0,0,0.5)] transition-[opacity,transform] duration-200 rounded-card data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
          {/* Header */}
          <div className="flex items-start gap-3 px-5 pb-3 pt-5">
            <div className="min-w-0 flex-1">
              <div className="text-caption font-medium uppercase tracking-wider text-muted-ash">
                Sui
              </div>
              <Dialog.Title className="mt-1 font-alt text-title font-medium leading-tight tracking-tight text-midnight-ink">
                Connect a wallet
              </Dialog.Title>
              <p className="mt-1.5 text-body-sm text-muted-ash">
                Pick how you want to sign in.
              </p>
            </div>
            <Dialog.Close
              aria-label="Close"
              className="-mr-1 -mt-1 inline-flex size-7 items-center justify-center text-muted-ash transition-colors hover:bg-whisper-gray hover:text-midnight-ink rounded-full"
            >
              <X className="size-4" strokeWidth={2.4} />
            </Dialog.Close>
          </div>

          {/* Wallet list */}
          <div className="space-y-1.5 px-5 pb-5">
            {wallets.length === 0 ? (
              <div className="space-y-2 bg-whisper-gray p-6 text-center rounded-card">
                <div className="text-body font-medium">No wallet detected</div>
                <div className="text-body-sm text-muted-ash">
                  Install{" "}
                  <a
                    href="https://slush.app"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-midnight-ink underline"
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
                  whileTap={{ scale: 0.99 }}
                  transition={{
                    type: "spring",
                    visualDuration: 0.2,
                    bounce: 0.3,
                  }}
                  onClick={() => handleConnect(wallet)}
                  className="flex w-full items-center gap-3 bg-whisper-gray p-3.5 transition-colors hover:bg-light-taupe rounded-card"
                >
                  {wallet.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={wallet.icon}
                      alt=""
                      width={36}
                      height={36}
                      className="rounded-card"
                    />
                  ) : (
                    <span className="inline-flex size-9 items-center justify-center bg-canvas-white text-midnight-ink rounded-card">
                      <WalletIcon className="size-4" strokeWidth={2.4} />
                    </span>
                  )}
                  <span className="flex-1 text-left text-body font-medium text-midnight-ink">
                    {wallet.name}
                  </span>
                  <ChevronDown
                    className="size-4 -rotate-90 text-muted-ash"
                    strokeWidth={2.2}
                  />
                </motion.button>
              ))
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
