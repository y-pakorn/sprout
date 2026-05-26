"use client";

import { ArrowRight } from "lucide-react";
import { AssetIcon } from "@/components/asset-icon";
import { fmtAmount } from "@/lib/format";
import type { TxCoin } from "@/lib/tx-history";

/** One coin chip — icon + (optionally signed) amount + symbol. */
function Coin({ coin, signed = false }: { coin: TxCoin; signed?: boolean }) {
  const sign = signed ? (coin.amount < 0 ? "−" : "+") : "";
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap align-middle">
      <AssetIcon src={coin.iconUrl} label={coin.symbol} size={14} />
      <span className="tabular-nums">
        {sign}
        {fmtAmount(Math.abs(coin.amount), 2)} {coin.symbol}
      </span>
    </span>
  );
}

/**
 * Renders coin movements: "out → in" when a tx both spends and receives (a
 * swap), otherwise signed chips (+received / −sent). Used by the account
 * activity + transactions cards. Renders nothing when there are no coins.
 */
export function CoinFlow({ coins }: { coins?: TxCoin[] }) {
  const list = coins ?? [];
  const outs = list.filter((c) => c.amount < 0);
  const ins = list.filter((c) => c.amount > 0);

  if (outs.length > 0 && ins.length > 0) {
    return (
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        {outs.map((c, i) => (
          <Coin key={`o${i}`} coin={c} />
        ))}
        <ArrowRight className="size-3 shrink-0 text-muted-ash" strokeWidth={2.2} />
        {ins.map((c, i) => (
          <Coin key={`i${i}`} coin={c} />
        ))}
      </span>
    );
  }
  if (list.length > 0) {
    return (
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        {list.map((c, i) => (
          <Coin key={i} coin={c} signed />
        ))}
      </span>
    );
  }
  return null;
}
