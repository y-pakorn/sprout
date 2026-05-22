/**
 * Mounts the hidden SVG that defines `#liquid-glass-filter`, referenced
 * by every `.liquid-glass` surface via `filter: url(#liquid-glass-filter)`
 * on the `::after` pseudo that captures the backdrop.
 *
 * Recipe: https://codepen.io/daftplug/pen/QwbaYGO — specifically the
 * `#container-glass` filter (NOT `#btn-glass`). The CodePen ships two:
 *
 *   - `#container-glass` (this one) uses feTurbulence at a low
 *     baseFrequency for big panels — 300×200px and up. The procedural
 *     noise field stretches across the whole surface, so the
 *     displacement varies organically.
 *   - `#btn-glass` uses feImage with a tiny PNG and primitiveUnits=
 *     objectBoundingBox, tuned for small (~70px) buttons where the PNG
 *     can encode the lens shape directly.
 *
 * Our cards are container-sized, so feTurbulence is the right call.
 * Tried feImage earlier and the displacement was invisible because the
 * PNG was designed for buttons, not panels.
 *
 * Filter chain:
 *   feTurbulence(0.008 0.008, octaves=2, seed=92) → noise
 *   feGaussianBlur(stdDeviation=0.02) on noise   → blur
 *   feDisplacementMap(SourceGraphic, blur, scale=77, R, G)
 *
 * SourceGraphic here is the backdrop captured by the ::after pseudo's
 * `backdrop-filter: blur(0)` — the live pixels behind the panel.
 */
export function GlassFilter() {
  return (
    <svg
      aria-hidden
      width="0"
      height="0"
      style={{ position: "absolute", pointerEvents: "none" }}
    >
      <filter
        id="liquid-glass-filter"
        x="0%"
        y="0%"
        width="100%"
        height="100%"
      >
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.008 0.008"
          numOctaves={2}
          seed={92}
          result="noise"
        />
        <feGaussianBlur in="noise" stdDeviation="0.02" result="blur" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="blur"
          scale="77"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </svg>
  );
}
