import { displacementMap } from "@/lib/glass-displacement-map";

/**
 * Mounts the hidden SVG that defines `#liquid-glass-filter`, referenced
 * by every `.liquid-glass` surface via `filter: url(#liquid-glass-filter)`
 * on the `::after` pseudo that captures the backdrop.
 *
 * Recipe: https://codepen.io/daftplug/pen/QwbaYGO (`#btn-glass` filter).
 *
 *  - `primitiveUnits="objectBoundingBox"` — every coordinate and scale
 *    inside the filter is normalized to the element's box [0..1]. That's
 *    why feImage is `width="1" height="1"` and feDisplacementMap is
 *    `scale="1"` — the encoding does the work, not a magic pixel number.
 *  - feImage loads the displacement-map PNG (stored as a data URL in
 *    glass-displacement-map.ts). The PNG's R/G channels encode inward-
 *    pointing displacement vectors that are strongest at the rim and
 *    zero at the center — that's the iOS lens-edge bend.
 *  - feGaussianBlur (stdDeviation=0.02) softens the map a touch so the
 *    displacement transitions don't quantize visibly.
 *  - feDisplacementMap warps SourceGraphic (the captured backdrop) by
 *    the softened map. Output is the liquid-bent backdrop.
 *
 * NOT used: feTurbulence (procedural noise). That gives water-ripple
 * randomness, not the structured lens distortion the PNG encodes.
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
        primitiveUnits="objectBoundingBox"
      >
        <feImage
          href={displacementMap}
          x="0"
          y="0"
          width="1"
          height="1"
          result="map"
          preserveAspectRatio="none"
        />
        <feGaussianBlur in="SourceGraphic" stdDeviation="0.02" result="blur" />
        <feDisplacementMap
          in="blur"
          in2="map"
          scale="1"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </svg>
  );
}
