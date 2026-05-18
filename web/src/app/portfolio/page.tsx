"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { SiteHeader } from "@/components/site-header";
import { LegRow } from "@/components/leg-row";
import { AssetIcon } from "@/components/asset-icon";
import { CountUp } from "@/components/count-up";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import {
  MOCK_PORTFOLIO,
  MOCK_BALANCES,
  getPortfolioSummary,
  getHoldingsTotal,
  splitPortfolio,
} from "@/lib/mock-portfolio";
import { fadeUp, scaleIn, stagger, SPRING } from "@/lib/motion";

export default function PortfolioPage() {
  const summary = getPortfolioSummary(MOCK_PORTFOLIO);
  const holdingsUsd = getHoldingsTotal(MOCK_BALANCES);
  const { vaults, pools } = splitPortfolio(MOCK_PORTFOLIO);
  const totalNetWorth = holdingsUsd + summary.totalUsd;
  const vaultsTotal = vaults.reduce((s, p) => s + p.amountUsd, 0);
  const poolsTotal = pools.reduce((s, p) => s + p.amountUsd, 0);

  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-6 py-8 pb-24">
        <motion.div
          variants={fadeUp}
          initial="initial"
          animate="animate"
          className="space-y-3"
        >
          <h1
            className="display-tight font-semibold leading-none"
            style={{ fontSize: "var(--text-hero)" }}
          >
            Your portfolio.
          </h1>
        </motion.div>

        <motion.div
          variants={scaleIn}
          initial="initial"
          animate="animate"
          transition={{ ...SPRING, delay: 0.1 }}
          className="grid gap-4 bg-cash-lime p-6 sm:grid-cols-3"
          style={{ borderRadius: 24 }}
        >
          <div className="space-y-0.5">
            <div className="text-caption font-medium uppercase tracking-wider text-midnight-black/70">
              Net worth
            </div>
            <div
              className="display-tight font-semibold tabular-nums leading-none"
              style={{ fontSize: "var(--text-title)" }}
            >
              <CountUp value={totalNetWorth} decimals={0} prefix="$" />
            </div>
          </div>
          <div className="space-y-0.5">
            <div className="text-caption font-medium uppercase tracking-wider text-midnight-black/70">
              Earning APY
            </div>
            <div
              className="display-tight font-semibold tabular-nums leading-none"
              style={{ fontSize: "var(--text-title)" }}
            >
              <CountUp value={summary.blendedApy} decimals={2} suffix="%" />
            </div>
          </div>
          <div className="space-y-0.5">
            <div className="text-caption font-medium uppercase tracking-wider text-midnight-black/70">
              Earned so far
            </div>
            <div className="flex items-baseline gap-1">
              <div
                className="display-tight font-semibold tabular-nums leading-none"
                style={{ fontSize: "var(--text-title)" }}
              >
                <CountUp value={summary.totalPnl} decimals={2} prefix="+$" />
              </div>
              <ArrowUpRight className="size-4 text-midnight-black" />
            </div>
          </div>
        </motion.div>

        <motion.div
          variants={stagger(0.2, 0.1)}
          initial="initial"
          animate="animate"
          className="space-y-5"
        >
          <Section
            title="Holdings"
            subtitle="In your wallet · ready to swap or deploy"
            totalUsd={holdingsUsd}
          >
            <motion.div
              variants={stagger(0.1, 0.04)}
              initial="initial"
              animate="animate"
              className="divide-y divide-ghost-border"
            >
              {MOCK_BALANCES.map((b) => (
                <motion.div
                  key={b.symbol}
                  variants={fadeUp}
                  whileHover={{ x: 2 }}
                  transition={SPRING}
                  className="flex items-center justify-between py-3 first:pt-1 last:pb-1"
                >
                  <div className="flex items-center gap-3">
                    <AssetIcon label={b.symbol} size={36} />
                    <div>
                      <div className="text-body font-semibold leading-tight">
                        {b.symbol}
                      </div>
                      <div className="text-body-sm text-subtle-gray tabular-nums">
                        {b.amount.toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })}{" "}
                        {b.symbol}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-body font-semibold tabular-nums">
                      $
                      {b.usdValue.toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}
                    </div>
                    <div className="text-body-sm text-subtle-gray tabular-nums">
                      ${b.pricePerUnit.toFixed(b.pricePerUnit < 1 ? 3 : 2)} ea
                    </div>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </Section>

          <Section
            title="Pools"
            subtitle="Liquidity provision · earning fees + IL exposure"
            totalUsd={poolsTotal}
          >
            {pools.length === 0 ? (
              <Empty hint="No LP positions yet. Plant one →" />
            ) : (
              <motion.div
                variants={stagger(0.1, 0.04)}
                initial="initial"
                animate="animate"
                className="divide-y divide-ghost-border"
              >
                {pools.map((p) => (
                  <motion.div key={p.id} variants={fadeUp}>
                    <LegRow leg={p} />
                  </motion.div>
                ))}
              </motion.div>
            )}
          </Section>

          <Section
            title="Vaults"
            subtitle="Yield positions · passive interest accruing"
            totalUsd={vaultsTotal}
          >
            {vaults.length === 0 ? (
              <Empty hint="No yield positions yet. Plant one →" />
            ) : (
              <motion.div
                variants={stagger(0.1, 0.04)}
                initial="initial"
                animate="animate"
                className="divide-y divide-ghost-border"
              >
                {vaults.map((p) => (
                  <motion.div key={p.id} variants={fadeUp}>
                    <LegRow leg={p} />
                  </motion.div>
                ))}
              </motion.div>
            )}
          </Section>
        </motion.div>

        <motion.div
          variants={fadeUp}
          initial="initial"
          animate="animate"
          transition={{ ...SPRING, delay: 0.6 }}
          className="flex justify-end gap-2 pt-2"
        >
          <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 bg-cash-lime px-5 py-2.5 text-body-sm font-semibold text-midnight-black"
              style={{ borderRadius: 9999 }}
            >
              Plant another
              <ArrowRight className="size-4" />
            </Link>
          </motion.div>
        </motion.div>
      </main>
    </div>
  );
}

function Section({
  title,
  subtitle,
  totalUsd,
  children,
}: {
  title: string;
  subtitle: string;
  totalUsd: number;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      variants={scaleIn}
      className="space-y-4 bg-cloud-gray p-6"
      style={{ borderRadius: 24 }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="space-y-0">
          <div className="text-body font-semibold leading-tight">{title}</div>
          <div className="text-body-sm text-subtle-gray">{subtitle}</div>
        </div>
        <div className="text-body font-semibold tabular-nums">
          <CountUp value={totalUsd} decimals={0} prefix="$" />
        </div>
      </div>
      {children}
    </motion.div>
  );
}

function Empty({ hint }: { hint: string }) {
  return (
    <div className="py-6 text-center text-body-sm text-subtle-gray">{hint}</div>
  );
}
