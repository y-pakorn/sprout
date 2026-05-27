"use client";

import { motion } from "motion/react";
import { ExternalLink } from "lucide-react";
import { AssetIcon } from "@/components/asset-icon";
import { fmtUsdShort, fmtCompact } from "@/lib/format";
import type { CoinMetadata } from "@/lib/blockberry-coins";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-caption uppercase tracking-wider text-muted-ash">
        {label}
      </span>
      <span className="text-body-sm tabular-nums text-midnight-ink">{value}</span>
    </div>
  );
}

const SOCIAL_LABELS: { key: keyof CoinMetadata["socials"]; label: string }[] = [
  { key: "website", label: "Website" },
  { key: "twitter", label: "X" },
  { key: "discord", label: "Discord" },
  { key: "github", label: "GitHub" },
  { key: "telegram", label: "Telegram" },
];

export function CoinMetadataCard({ meta }: { meta: CoinMetadata }) {
  const socials = SOCIAL_LABELS.filter((s) => meta.socials[s.key]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", visualDuration: 0.3, bounce: 0.2 }}
      className="surface-card max-w-[640px] rounded-card p-3"
    >
      {/* Header */}
      <div className="flex items-center gap-3 pb-3">
        <AssetIcon src={meta.imgUrl} label={meta.symbol} size={40} />
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-body font-medium text-midnight-ink">
            {meta.name}
          </span>
          <span className="text-caption uppercase tracking-wider text-muted-ash">
            {meta.symbol}
          </span>
        </div>
      </div>

      {meta.description && (
        <p className="mb-3 line-clamp-3 text-caption text-muted-ash">
          {meta.description}
        </p>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        {typeof meta.marketCap === "number" && meta.marketCap > 0 && (
          <Stat label="Market cap" value={fmtUsdShort(meta.marketCap)} />
        )}
        {typeof meta.volume === "number" && meta.volume > 0 && (
          <Stat label="24h volume" value={fmtUsdShort(meta.volume)} />
        )}
        {typeof meta.circulatingSupply === "number" && (
          <Stat
            label="Circulating"
            value={`${fmtCompact(meta.circulatingSupply)} ${meta.symbol}`}
          />
        )}
        {typeof meta.totalSupply === "number" && (
          <Stat
            label="Total supply"
            value={`${fmtCompact(meta.totalSupply)} ${meta.symbol}`}
          />
        )}
        <Stat label="Decimals" value={String(meta.decimals)} />
      </div>

      {/* Socials */}
      {socials.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-hairline pt-3">
          {socials.map((s) => (
            <a
              key={s.key}
              href={meta.socials[s.key]}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 bg-whisper-gray px-2.5 py-1 text-caption font-medium text-midnight-ink transition-colors hover:bg-light-taupe rounded-button"
            >
              {s.label}
              <ExternalLink className="size-3 text-muted-ash" strokeWidth={2.2} />
            </a>
          ))}
        </div>
      )}
    </motion.div>
  );
}
