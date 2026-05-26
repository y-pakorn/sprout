"use client";

import { Dialog } from "@base-ui/react";
import { X, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AssetIcon } from "@/components/asset-icon";
import { Sparkline } from "@/components/parts/sparkline";
import { useVaultHistory } from "@/lib/client-vaults";
import type { SuiVault } from "@/lib/vaults";
import { Tag } from "@/components/ui/tag";
import { getGlossary, type GlossaryKey } from "@/lib/ai/vault-glossary";
import { fmtUsdShort, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = {
  vault: SuiVault | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContinue?: () => void;
  iconLookup?: (coinType: string) => string | undefined;
};

// Local alias — this file uses the K/M abbreviated USD format (TVL,
// capacity), not the full-precision currency format.
const fmtUsd = fmtUsdShort;

function deltaPct(a: number, b: number): number {
  if (b === 0) return 0;
  return ((a - b) / b) * 100;
}

/** Category → glossary key for the strategy explainer. */
function strategyKeyFor(category: string): GlossaryKey | undefined {
  const c = category.toLowerCase();
  if (c.includes("concentrated") || c.includes("liquidity")) {
    return "concentrated-liquidity";
  }
  return undefined;
}

export function VaultInfoDialog({
  vault,
  open,
  onOpenChange,
  onContinue,
  iconLookup,
}: Props) {
  const enabled = open && !!vault;
  const apy = useVaultHistory(vault?.id, "apy", { enabled, limit: 30 });
  const sharePrice = useVaultHistory(vault?.id, "share-price", {
    enabled,
    limit: 90,
  });
  const tvl = useVaultHistory(vault?.id, "tvl", { enabled, limit: 90 });

  if (!vault) return null;

  const strategyKey = strategyKeyFor(vault.category);
  const strategyExplainer = strategyKey ? getGlossary(strategyKey) : undefined;
  const iconUrl =
    vault.logoUrl ?? iconLookup?.(vault.depositCoinType) ?? undefined;

  // Compute share-price deltas
  const spPoints =
    sharePrice.status === "ok" ? sharePrice.data.points : [];
  const spNow = spPoints[spPoints.length - 1]?.value;
  const sp7 = spPoints[Math.max(0, spPoints.length - 8)]?.value;
  const sp30 = spPoints[Math.max(0, spPoints.length - 31)]?.value;
  const sp90 = spPoints[0]?.value;

  const apyAvg30 =
    apy.status === "ok" ? apy.data.averages?.["30d"] ?? null : null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal keepMounted>
            <Dialog.Backdrop
              render={
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="fixed inset-0 z-40 bg-midnight-ink/30 backdrop-blur-sm"
                />
              }
            />
            <Dialog.Popup
              render={
                <motion.div
                  initial={{ opacity: 0, y: 12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.98 }}
                  transition={{
                    type: "spring",
                    visualDuration: 0.25,
                    bounce: 0.15,
                  }}
                  className="fixed left-1/2 top-1/2 z-50 flex w-[92vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden bg-canvas-white rounded-card max-h-[90vh]"
                />
              }
            >
              {/* Inner scrollable container — keeps the popup's rounded
                  corners from clipping during scroll on Safari/Chrome. */}
              <div className="flex-1 overflow-y-auto p-5">
              <div className="flex items-start gap-3">
                <AssetIcon
                  src={iconUrl}
                  label={vault.depositSymbol}
                  size={40}
                />
                <div className="min-w-0 flex-1">
                  <Dialog.Title className="text-body-lg font-medium leading-tight text-midnight-ink">
                    {vault.name}
                  </Dialog.Title>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-caption text-muted-ash">
                    <span
                      className="bg-whisper-gray px-2 py-0.5 font-medium rounded-card"
                    >
                      {vault.category}
                    </span>
                    <span>·</span>
                    <span>Deposits {vault.depositSymbol}</span>
                    {vault.withdrawalPeriodDays !== undefined && (
                      <>
                        <span>·</span>
                        <span>
                          {vault.withdrawalPeriodDays}-day withdrawal
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <Dialog.Close
                  render={
                    <button
                      type="button"
                      aria-label="Close"
                      className="inline-flex size-7 items-center justify-center text-muted-ash transition-colors hover:bg-whisper-gray hover:text-midnight-ink rounded-full"
                    >
                      <X className="size-4" strokeWidth={2.4} />
                    </button>
                  }
                />
              </div>

              {/* Numbers strip */}
              <div className="mt-4 grid grid-cols-3 gap-2">
                <NumberTile
                  label="Total Deposits"
                  value={fmtUsd(vault.tvlUsd)}
                />
                <NumberTile
                  label="Current APY"
                  value={fmtPct(vault.apyPct)}
                  tone="lime"
                />
                <NumberTile
                  label="30D Avg APY"
                  value={apyAvg30 != null ? fmtPct(apyAvg30) : "—"}
                />
              </div>

              {/* APY composition */}
              <Section title="APY composition">
                <ApyComposition vault={vault} />
              </Section>

              {/* APY history chart */}
              <Section
                title="APY history"
                right={
                  apyAvg30 != null && (
                    <span className="text-caption text-muted-ash">
                      30d avg{" "}
                      <span className="font-medium text-midnight-ink tabular-nums">
                        {fmtPct(apyAvg30)}
                      </span>
                    </span>
                  )
                }
              >
                <ChartFrame>
                  {apy.status === "loading" && <Skeleton />}
                  {apy.status === "error" && (
                    <Empty msg="Couldn't load APY history" />
                  )}
                  {apy.status === "ok" && apy.data.points.length === 0 && (
                    <Empty msg="No APY history yet" />
                  )}
                  {apy.status === "ok" && apy.data.points.length > 0 && (
                    <Sparkline
                      points={apy.data.points}
                      width={544}
                      height={120}
                      baseline={apyAvg30 ?? undefined}
                      format={(v) => `${v.toFixed(2)}%`}
                    />
                  )}
                </ChartFrame>
              </Section>

              {/* Share price + growth */}
              <Section title="Share price">
                <ChartFrame>
                  {sharePrice.status === "loading" && <Skeleton />}
                  {sharePrice.status === "error" && (
                    <Empty msg="Couldn't load share-price history" />
                  )}
                  {sharePrice.status === "ok" && spPoints.length === 0 && (
                    <Empty msg="No share-price history yet" />
                  )}
                  {sharePrice.status === "ok" && spPoints.length > 0 && (
                    <>
                      <Sparkline
                        points={spPoints}
                        width={544}
                        height={120}
                        format={(v) => v.toFixed(6)}
                      />
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {spNow != null && sp7 != null && (
                          <GrowthChip
                            label="7d"
                            pct={deltaPct(spNow, sp7)}
                          />
                        )}
                        {spNow != null && sp30 != null && (
                          <GrowthChip
                            label="30d"
                            pct={deltaPct(spNow, sp30)}
                          />
                        )}
                        {spNow != null && sp90 != null && spPoints.length >= 50 && (
                          <GrowthChip
                            label="90d"
                            pct={deltaPct(spNow, sp90)}
                          />
                        )}
                      </div>
                    </>
                  )}
                </ChartFrame>
              </Section>

              {/* TVL bars */}
              <Section title="TVL">
                <ChartFrame>
                  {tvl.status === "loading" && <Skeleton />}
                  {tvl.status === "error" && (
                    <Empty msg="Couldn't load TVL history" />
                  )}
                  {tvl.status === "ok" && tvl.data.points.length === 0 && (
                    <Empty msg="No TVL history yet" />
                  )}
                  {tvl.status === "ok" && tvl.data.points.length > 0 && (
                    <Sparkline
                      points={tvl.data.points}
                      width={544}
                      height={80}
                      variant="bars"
                      format={(v) => fmtUsd(v)}
                    />
                  )}
                </ChartFrame>
              </Section>

              {/* Strategy + transparency */}
              {(vault.strategy ||
                vault.description ||
                vault.riskProfile ||
                strategyExplainer) && (
                <Section title="Strategy">
                  {(vault.strategy || vault.riskProfile) && (
                    <p className="m-0 mb-1.5 text-body-sm font-medium text-midnight-ink">
                      {vault.strategy}
                      {vault.strategy && vault.riskProfile ? " · " : ""}
                      {vault.riskProfile?.name}
                    </p>
                  )}
                  {vault.riskProfile?.description && (
                    <p className="m-0 mb-1.5 text-body-sm text-muted-ash">
                      {vault.riskProfile.description}
                    </p>
                  )}
                  {vault.description && (
                    <p className="m-0 mb-1.5 text-body-sm text-muted-ash">
                      {vault.description}
                    </p>
                  )}
                  {strategyExplainer && (
                    <div className="prose-sprout text-body-sm text-muted-ash">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ children }) => (
                            <p className="m-0 mb-1.5">{children}</p>
                          ),
                          strong: ({ children }) => (
                            <strong className="font-medium text-midnight-ink">
                              {children}
                            </strong>
                          ),
                        }}
                      >
                        {strategyExplainer}
                      </ReactMarkdown>
                    </div>
                  )}
                </Section>
              )}

              {/* Withdrawal terms */}
              {vault.withdrawalPeriodDays !== undefined && (
                <Section title="Withdrawal terms">
                  <div className="prose-sprout text-body-sm text-muted-ash">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        p: ({ children }) => <p className="m-0">{children}</p>,
                        strong: ({ children }) => (
                          <strong className="font-medium text-midnight-ink">
                            {children}
                          </strong>
                        ),
                      }}
                    >
                      {getGlossary("withdrawal-lockup")}
                    </ReactMarkdown>
                  </div>
                </Section>
              )}

              {/* Transparency */}
              <Section title="Custody">
                <div className="prose-sprout text-body-sm text-muted-ash">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      p: ({ children }) => <p className="m-0">{children}</p>,
                      strong: ({ children }) => (
                        <strong className="font-medium text-midnight-ink">
                          {children}
                        </strong>
                      ),
                    }}
                  >
                    {getGlossary("mpc-custody")}
                  </ReactMarkdown>
                </div>
                {vault.strategyAccounts && vault.strategyAccounts.length > 0 && (
                  <div className="mt-2.5 space-y-1.5">
                    <div className="text-caption font-medium uppercase tracking-wider text-muted-ash">
                      Strategy accounts — where funds deploy
                    </div>
                    {vault.strategyAccounts.map((a) => (
                      <div
                        key={`${a.chain ?? ""}-${a.address}`}
                        className="flex items-center justify-between gap-2 surface-panel px-2.5 py-1.5 rounded-card"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-body-sm font-medium text-midnight-ink">
                              {a.name}
                            </span>
                            {a.chain && <Tag tone="neutral">{a.chain}</Tag>}
                            {!a.isActive && <Tag tone="gold">Inactive</Tag>}
                          </div>
                          <div className="truncate font-mono text-caption text-muted-ash">
                            {a.address.slice(0, 8)}…{a.address.slice(-6)}
                          </div>
                        </div>
                        {a.explorerUrl && (
                          <a
                            href={a.explorerUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex shrink-0 items-center gap-1 bg-whisper-gray px-2.5 py-1 text-caption font-medium text-midnight-ink rounded-card"
                          >
                            View
                            <ExternalLink className="size-3" strokeWidth={2.2} />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* Footer */}
              <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3">
                <div className="flex flex-wrap gap-1.5 text-caption">
                  <a
                    href="https://ember.so/security"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 bg-whisper-gray px-2.5 py-1 font-medium text-midnight-ink rounded-card"
                  >
                    Risk disclosure
                    <ExternalLink className="size-3" strokeWidth={2.2} />
                  </a>
                  <a
                    href="https://learn.ember.so/"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 bg-whisper-gray px-2.5 py-1 font-medium text-midnight-ink rounded-card"
                  >
                    Documentation
                    <ExternalLink className="size-3" strokeWidth={2.2} />
                  </a>
                </div>
                <div className="flex gap-1.5">
                  <Dialog.Close
                    render={
                      <button
                        type="button"
                        className="bg-whisper-gray px-3.5 py-1.5 text-body-sm font-medium text-midnight-ink rounded-card"
                      >
                        Close
                      </button>
                    }
                  />
                  {onContinue && (
                    <button
                      type="button"
                      onClick={() => {
                        onContinue();
                        onOpenChange(false);
                      }}
                      className="bg-midnight-ink px-4 py-1.5 text-body-sm font-medium text-canvas-white rounded-card"
                    >
                      Continue to deposit
                    </button>
                  )}
                </div>
              </div>
              </div>
            </Dialog.Popup>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

function NumberTile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "lime";
}) {
  return (
    <div
      className="bg-whisper-gray px-3 py-2 rounded-card"
    >
      <div className="text-caption font-medium uppercase tracking-wider text-muted-ash">
        {label}
      </div>
      <div
        className={cn(
          "text-body font-medium tabular-nums",
          tone === "lime" && "text-midnight-ink",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <h3 className="text-caption font-medium uppercase tracking-wider text-muted-ash">
          {title}
        </h3>
        {right}
      </div>
      {children}
    </div>
  );
}

function ChartFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="bg-whisper-gray p-3 rounded-card min-h-[96px]"
    >
      {children}
    </div>
  );
}

function Skeleton() {
  return (
    <div
      className="flex h-24 w-full items-center justify-center text-caption text-muted-ash rounded-[10px]"
    >
      Loading…
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="flex h-24 w-full items-center justify-center text-caption text-muted-ash">
      {msg}
    </div>
  );
}

function GrowthChip({ label, pct }: { label: string; pct: number }) {
  const positive = pct >= 0;
  return (
    <span
      className={cn("rounded-card", 
        "inline-flex items-center gap-1 px-2 py-0.5 text-caption font-medium tabular-nums",
        positive ? "bg-deliver-green/20" : "bg-destructive/15",
      )}
    >
      <span className="text-muted-ash">{label}</span>
      <span className="text-midnight-ink">
        {positive ? "+" : ""}
        {pct.toFixed(2)}%
      </span>
    </span>
  );
}

function ApyComposition({ vault }: { vault: SuiVault }) {
  const lendPct = vault.apyBreakdown.lendingApyPct;
  const rewardPct = vault.apyBreakdown.rewardApyPct;
  const strategyPct = vault.apyBreakdown.strategyApyPct;
  const total = lendPct + rewardPct + strategyPct;
  // Width of each bar segment as a fraction of total (visual only)
  const wLend = total > 0 ? (lendPct / total) * 100 : 0;
  const wReward = total > 0 ? (rewardPct / total) * 100 : 0;
  const wStrategy = total > 0 ? (strategyPct / total) * 100 : 0;

  return (
    <div className="space-y-2">
      <div
        className="flex h-2 w-full overflow-hidden bg-whisper-gray rounded-full"
      >
        {wLend > 0 && (
          <div
            className="h-full bg-deliver-green"
            style={{ width: `${Math.min(100, wLend)}%` }}
          />
        )}
        {wStrategy > 0 && (
          <div
            className="h-full bg-midnight-ink"
            style={{ width: `${Math.min(100, wStrategy)}%` }}
          />
        )}
        {wReward > 0 && (
          <div
            className="h-full bg-warning"
            style={{ width: `${Math.min(100, wReward)}%` }}
          />
        )}
        {total === 0 && (
          <div
            className="h-full w-full bg-light-taupe/40"
          />
        )}
      </div>
      <ul className="space-y-1 text-body-sm">
        {lendPct > 0 && (
          <CompRow
            dot="bg-deliver-green"
            label="Lending APY"
            pct={lendPct}
            hint="Interest the strategy earns on lent assets."
          />
        )}
        {strategyPct > 0 && (
          <CompRow
            dot="bg-midnight-ink"
            label="Strategy yield"
            pct={strategyPct}
            hint="LP fees, funding, basis — the operator's alpha."
          />
        )}
        {rewardPct > 0 && (
          <CompRow
            dot="bg-warning"
            label="Reward emissions"
            pct={rewardPct}
            hint="Token emissions — can dry up; reward token can lose value."
          />
        )}
        {total === 0 && (
          <li className="text-caption text-muted-ash">
            No yield breakdown reported by the vault yet.
          </li>
        )}
        {vault.performanceFeeBps > 0 && (
          <CompRow
            dot="bg-light-taupe"
            label="Performance fee"
            pct={-(vault.performanceFeeBps / 100)}
            hint="Applied to deposit yield only."
          />
        )}
      </ul>
    </div>
  );
}

function CompRow({
  dot,
  label,
  pct,
  hint,
}: {
  dot: string;
  label: string;
  pct: number;
  hint: string;
}) {
  return (
    <li className="flex items-baseline gap-2">
      <span
        className={cn("rounded-full", "inline-block size-1.5 shrink-0", dot)}
      />
      <span className="text-body-sm font-medium text-midnight-ink">{label}</span>
      <span className="text-body-sm font-medium tabular-nums text-midnight-ink">
        {pct >= 0 ? "+" : ""}
        {pct.toFixed(2)}%
      </span>
      <span className="truncate text-caption text-muted-ash">{hint}</span>
    </li>
  );
}
