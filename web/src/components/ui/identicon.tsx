// Deterministic gradient avatar for a Sui address. Distinct per address (two
// colors + angle seeded by the address hash), on the Amplemarket accent
// palette. Inline style is allowed here — these are runtime-dynamic hashed
// avatar colors, the explicit carve-out in the design rules.

const PALETTE = [
  "#328efa", // intelligence blue
  "#47d096", // deliver green
  "#fbc768", // engagement gold
  "#e16540", // lead-gen red
  "#10054d", // deep indigo
  "#2e2460", // midnight violet
  "#e8400d", // phoenix orange
  "#272625", // surface charcoal
];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Identicon({
  address,
  size = 40,
  className,
}: {
  address: string;
  size?: number;
  className?: string;
}) {
  const h = hash(address);
  const c1 = PALETTE[h % PALETTE.length];
  const c2 = PALETTE[(((h >> 5) % PALETTE.length) + 3) % PALETTE.length];
  const angle = h % 360;
  return (
    <span
      aria-hidden
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: "9999px",
        backgroundImage: `linear-gradient(${angle}deg, ${c1}, ${c2})`,
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}
