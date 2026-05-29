import { ImageResponse } from "next/og";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fmtAmount } from "@/lib/format";

// Shared renderer for the Open Graph / Twitter cards. Mirrors the site: the
// WebGL metaball glow (parts/gradient-field.tsx) — blue + green + gold blobs
// confined to the bottom-right over clean #f6f5f3, plus film grain — with the
// navbar logo lockup (seedling + "sprout") sized up and centered.
//
// The brand font ships as a variable woff2 Satori can't parse, so a static
// instance is committed: Sprout-wordmark.ttf = wght 600 + STBL 0 + ss02 frozen
// (Satori can't apply OpenType features at render time), i.e. the navbar's
// `font-alt` rendering.

export const size = { width: 1200, height: 630 };
export const contentType = "image/jpeg";
export const alt = "Sprout — your money's agent on Sui";

const INK = "#111111";

// Film grain — resvg renders feTurbulence; black speckles with noise-driven
// alpha so it reads as grain on a normal composite (matches the shader's
// darkening grain).
const GRAIN =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='630'>` +
      `<filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/>` +
      `<feColorMatrix type='matrix' values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.7 0 0 0 0'/></filter>` +
      `<rect width='100%' height='100%' filter='url(#g)'/></svg>`,
  );

/** The filled-seedling brand mark (same paths as the navbar SproutLogo). */
function Seedling({ size: s, color }: { size: number; color: string }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <path
        d="M12 22C11.3 18 11.4 14 12.4 10.5"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11.4 12.8C11.8 7.8 8.6 3.9 3.1 4 2.2 9 5.4 12.9 11.4 12.8Z"
        fill={color}
        stroke={color}
        strokeWidth={2.4}
        strokeLinejoin="round"
      />
      <path
        d="M12.6 11C12 6.2 14.9 2.4 20.4 2.6 21.6 7.3 18.7 11.2 12.6 11Z"
        fill={color}
        stroke={color}
        strokeWidth={2.4}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export async function renderSproutOg() {
  const wordmark = await readFile(
    join(process.cwd(), "src/app/Sprout-wordmark.ttf"),
  );

  const png = new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // Lift the lockup above true center — the bottom-right glow weights the
          // lower half, so dead-center reads low.
          paddingBottom: 48,
          backgroundColor: "#f6f5f3",
          // Metaball glow confined to the bottom-right (blue + green + gold),
          // fading to clean base toward the top-left — the site's hero wash.
          backgroundImage: [
            "radial-gradient(54% 66% at 102% 62%, rgba(251,199,104,0.75), rgba(251,199,104,0) 62%)",
            "radial-gradient(70% 80% at 62% 106%, rgba(50,142,250,0.62), rgba(50,142,250,0) 62%)",
            "radial-gradient(86% 96% at 96% 99%, rgba(71,208,150,0.92), rgba(71,208,150,0) 60%)",
          ].join(","),
          fontFamily: "SproutWord",
        }}
      >
        {/* Film grain overlay */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={GRAIN}
          width={1200}
          height={630}
          alt=""
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 1200,
            height: 630,
            opacity: 0.14,
          }}
        />

        {/* Logo lockup — seedling + wordmark, sized up */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 22,
          }}
        >
          <Seedling size={150} color={INK} />
          <div
            style={{
              fontSize: 196,
              fontWeight: 600,
              color: INK,
              letterSpacing: "-0.05em",
              lineHeight: 1,
            }}
          >
            sprout
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "SproutWord", data: wordmark, weight: 600, style: "normal" },
      ],
    },
  );

  // ImageResponse only emits a full-quality PNG, and the film grain is
  // high-frequency noise that balloons PNG to ~1MB. Re-encode to JPEG (no alpha
  // needed — the canvas is opaque) for a ~50KB, universally-supported card.
  const jpeg = await sharp(Buffer.from(await png.arrayBuffer()))
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();

  return new Response(new Uint8Array(jpeg), {
    headers: {
      "Content-Type": "image/jpeg",
      // Static content; the metadata URL is content-hashed, so cache hard.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

/**
 * Sprout Pay link card — the SAME wash/grain/brand chrome as the site card, but
 * overlaid with the payment request (amount · recipient · title) so a /pay link
 * unfurls richly in chat apps. Rendered per-blob (dynamic), not at build time.
 */
export async function renderPaymentLinkOg(d: {
  amount?: number;
  symbol: string;
  recipient: string;
  title?: string;
}) {
  const wordmark = await readFile(
    join(process.cwd(), "src/app/Sprout-wordmark.ttf"),
  );

  const recip =
    d.recipient.startsWith("0x") && d.recipient.length > 14
      ? `${d.recipient.slice(0, 8)}…${d.recipient.slice(-4)}`
      : d.recipient;
  const amountLabel =
    d.amount != null ? `${fmtAmount(d.amount)} ${d.symbol}` : "Any amount";

  const png = new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          backgroundColor: "#f6f5f3",
          backgroundImage: [
            "radial-gradient(54% 66% at 102% 62%, rgba(251,199,104,0.75), rgba(251,199,104,0) 62%)",
            "radial-gradient(70% 80% at 62% 106%, rgba(50,142,250,0.62), rgba(50,142,250,0) 62%)",
            "radial-gradient(86% 96% at 96% 99%, rgba(71,208,150,0.92), rgba(71,208,150,0) 60%)",
          ].join(","),
          fontFamily: "SproutWord",
        }}
      >
        {/* Film grain overlay */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={GRAIN}
          width={1200}
          height={630}
          alt=""
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 1200,
            height: 630,
            opacity: 0.14,
          }}
        />

        {/* Brand lockup, top-left */}
        <div
          style={{
            position: "absolute",
            top: 56,
            left: 64,
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <Seedling size={46} color={INK} />
          <div
            style={{
              fontSize: 54,
              fontWeight: 600,
              color: INK,
              letterSpacing: "-0.05em",
              lineHeight: 1,
            }}
          >
            sprout
          </div>
        </div>

        {/* Payment request */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            paddingLeft: 64,
            paddingRight: 64,
            gap: 10,
          }}
        >
          <div style={{ display: "flex", fontSize: 32, color: "#6d6c6b" }}>
            Payment request
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 128,
              fontWeight: 600,
              color: INK,
              letterSpacing: "-0.045em",
              lineHeight: 1,
            }}
          >
            {amountLabel}
          </div>
          {d.amount == null ? (
            <div
              style={{
                display: "flex",
                fontSize: 46,
                color: INK,
                letterSpacing: "-0.02em",
              }}
            >
              in {d.symbol}
            </div>
          ) : null}
          {d.title ? (
            <div
              style={{
                display: "flex",
                fontSize: 46,
                color: INK,
                letterSpacing: "-0.02em",
              }}
            >
              {d.title}
            </div>
          ) : null}
          <div style={{ display: "flex", fontSize: 38, color: "#6d6c6b" }}>
            to {recip}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            position: "absolute",
            bottom: 56,
            left: 64,
            display: "flex",
            fontSize: 30,
            color: "#6d6c6b",
          }}
        >
          Pay on Sui — gasless, with any token
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "SproutWord", data: wordmark, weight: 600, style: "normal" },
      ],
    },
  );

  const jpeg = await sharp(Buffer.from(await png.arrayBuffer()))
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();

  return new Response(new Uint8Array(jpeg), {
    headers: {
      "Content-Type": "image/jpeg",
      // Per-blob, not content-hashed — cache modestly.
      "Cache-Control": "public, max-age=300",
    },
  });
}
