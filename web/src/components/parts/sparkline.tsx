"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export type SparkPoint = {
  timestamp: number;
  value: number;
};

type Props = {
  points: SparkPoint[];
  /** Optional secondary series rendered as a lighter line (e.g. reward APY). */
  secondary?: SparkPoint[];
  width?: number;
  height?: number;
  /** Stroke color of the primary line. Defaults to lime. */
  color?: string;
  /** Optional dotted baseline value (e.g. 30-day average). */
  baseline?: number;
  /** Render as filled bars instead of a line (used for TVL). */
  variant?: "line" | "bars";
  /** Format the hover tooltip value. */
  format?: (v: number) => string;
};

const PAD = 4;

function pathFromPoints(
  pts: SparkPoint[],
  min: number,
  max: number,
  w: number,
  h: number,
): string {
  if (pts.length === 0) return "";
  const span = Math.max(1e-9, max - min);
  const xStep = pts.length > 1 ? (w - PAD * 2) / (pts.length - 1) : 0;
  return pts
    .map((p, i) => {
      const x = PAD + i * xStep;
      const y = h - PAD - ((p.value - min) / span) * (h - PAD * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Tiny dependency-free SVG sparkline. Cash App look: 2px stroke, no
 * axes, optional dotted baseline. Hover reveals a focus dot + small
 * tooltip with the value + date.
 */
export function Sparkline({
  points,
  secondary,
  width = 280,
  height = 64,
  color = "var(--color-cash-lime, #00d54f)",
  baseline,
  variant = "line",
  format,
}: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const { min, max, primaryPath, secondaryPath } = useMemo(() => {
    const all = [
      ...points.map((p) => p.value),
      ...(secondary?.map((p) => p.value) ?? []),
      ...(baseline !== undefined ? [baseline] : []),
    ];
    const lo = all.length > 0 ? Math.min(...all) : 0;
    const hi = all.length > 0 ? Math.max(...all) : 1;
    // Padding so the line isn't flush with the bounds
    const pad = (hi - lo) * 0.1 || hi * 0.1 || 1;
    return {
      min: lo - pad,
      max: hi + pad,
      primaryPath: pathFromPoints(points, lo - pad, hi + pad, width, height),
      secondaryPath: secondary
        ? pathFromPoints(secondary, lo - pad, hi + pad, width, height)
        : "",
    };
  }, [points, secondary, baseline, width, height]);

  if (points.length === 0) {
    return (
      <div
        className="w-full bg-canvas-white"
        style={{ height, borderRadius: 10 }}
      />
    );
  }

  const span = Math.max(1e-9, max - min);
  const baselineY =
    baseline !== undefined
      ? height - PAD - ((baseline - min) / span) * (height - PAD * 2)
      : null;

  // Focus dot position
  const hoverPoint =
    hoverIdx !== null && points[hoverIdx] ? points[hoverIdx] : null;
  const hoverX =
    hoverIdx !== null && points.length > 1
      ? PAD + hoverIdx * ((width - PAD * 2) / (points.length - 1))
      : null;
  const hoverY =
    hoverPoint !== null
      ? height - PAD - ((hoverPoint.value - min) / span) * (height - PAD * 2)
      : null;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    // Map pixel x → fractional position → nearest data index. Works
    // regardless of how wide the SVG was scaled to fit the container.
    const frac = Math.max(
      0,
      Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)),
    );
    const idx = Math.round(frac * (points.length - 1));
    setHoverIdx(Math.min(points.length - 1, Math.max(0, idx)));
  }

  // Tooltip horizontal position as a percentage of the rendered width so
  // it stays anchored to the focus point regardless of element size.
  const hoverPct =
    hoverIdx !== null && points.length > 1
      ? (hoverIdx / (points.length - 1)) * 100
      : null;

  return (
    <div className="relative w-full" style={{ height }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        width="100%"
        height={height}
        className="block"
        onMouseMove={onMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {baselineY !== null && (
          <line
            x1={PAD}
            x2={width - PAD}
            y1={baselineY}
            y2={baselineY}
            stroke="currentColor"
            className="text-hinting-gray"
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.6}
          />
        )}

        {variant === "line" ? (
          <>
            {secondaryPath && (
              <path
                d={secondaryPath}
                fill="none"
                stroke={color}
                strokeOpacity={0.35}
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            <path
              d={primaryPath}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ) : (
          // Bars variant
          (() => {
            const xStep =
              points.length > 1 ? (width - PAD * 2) / points.length : 0;
            const barW = Math.max(2, xStep * 0.7);
            return points.map((p, i) => {
              const x = PAD + i * xStep + (xStep - barW) / 2;
              const y = height - PAD - ((p.value - min) / span) * (height - PAD * 2);
              const h = height - PAD - y;
              return (
                <rect
                  key={i}
                  x={x}
                  y={y}
                  width={barW}
                  height={Math.max(0, h)}
                  rx={Math.min(2, barW / 2)}
                  fill={color}
                  opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.5}
                />
              );
            });
          })()
        )}

        {hoverX !== null && hoverY !== null && (
          <>
            <line
              x1={hoverX}
              x2={hoverX}
              y1={PAD}
              y2={height - PAD}
              stroke="currentColor"
              className="text-hinting-gray"
              strokeWidth={1}
              opacity={0.4}
            />
            <circle cx={hoverX} cy={hoverY} r={3.5} fill={color} />
            <circle
              cx={hoverX}
              cy={hoverY}
              r={6}
              fill={color}
              opacity={0.25}
            />
          </>
        )}
      </svg>

      {hoverPoint && hoverPct !== null && (
        <div
          className={cn(
            "pointer-events-none absolute top-0 z-10 -translate-x-1/2 -translate-y-full bg-midnight-black px-2 py-1 text-[10px] font-medium text-canvas-white",
          )}
          style={{
            left: `${hoverPct}%`,
            borderRadius: 6,
            whiteSpace: "nowrap",
          }}
        >
          <span className="tabular-nums">
            {format ? format(hoverPoint.value) : hoverPoint.value.toFixed(2)}
          </span>
          <span className="ml-1.5 text-hinting-gray">
            {fmtDate(hoverPoint.timestamp)}
          </span>
        </div>
      )}
    </div>
  );
}
