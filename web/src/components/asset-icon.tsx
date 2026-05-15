"use client";

import { useState } from "react";
import { fallbackBg, initials } from "@/lib/protocol-icons";

type Props = {
  src?: string;
  label: string;
  size?: number;
};

/**
 * Logo-mark primitive per DESIGN.md.
 *
 * 14px border-radius (rounded-mark), no border, no shadow.
 * Falls back to an initials block on the same lime/dark palette.
 */
export function AssetIcon({ src, label, size = 40 }: Props) {
  const [errored, setErrored] = useState(false);

  if (!src || errored) {
    return (
      <div
        aria-hidden
        className="inline-flex shrink-0 items-center justify-center text-canvas-white"
        style={{
          width: size,
          height: size,
          borderRadius: 14,
          background: fallbackBg(label),
          fontSize: Math.max(11, size * 0.36),
          fontWeight: 600,
          letterSpacing: "-0.015em",
        }}
      >
        {initials(label)}
      </div>
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setErrored(true)}
      className="shrink-0 object-cover"
      style={{ borderRadius: 14 }}
    />
  );
}
