import { displacementMap } from "@/lib/glass-displacement-map";

/**
 * Mounts a hidden SVG that defines the `#liquid-glass-filter` filter once per page.
 *
 * Adapted from @nkzw-tech/liquid-glass (MIT). The visual tell of real iOS
 * liquid glass is chromatic aberration at the edges — light splits into
 * R/G/B as it passes through the curved rim. We get that by running
 * THREE feDisplacementMap operations on the same input, one per RGB
 * channel, with slightly offset scales so each channel lands a hair
 * differently. Recombined via `feBlend mode="screen"`, the result is a
 * rainbow fringe on high-contrast edges of the backdrop — the look that
 * separates "glass" from "frosted blur."
 *
 * Also notable:
 *  - Filter region extended to -20% / 140% so the displaced pixels at
 *    the rim aren't clipped by the element's tight bbox.
 *  - `yChannelSelector="B"` (not "G") matches the nkzw map encoding.
 *  - Negative scale because the displacement map encodes inward-pointing
 *    vectors; flipping the sign gives the iOS-style inward refraction.
 *  - `preserveAspectRatio="xMidYMid slice"` covers without stretching.
 *
 * Outside Chromium, `backdrop-filter: url(#...)` is unsupported and the
 * CSS in globals.css falls back to plain blur + saturate.
 */
export function GlassFilter() {
  return (
    <svg
      aria-hidden
      width="0"
      height="0"
      style={{ position: "absolute", pointerEvents: "none" }}
    >
      <defs>
        <filter
          id="liquid-glass-filter"
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
          colorInterpolationFilters="sRGB"
        >
          <feImage
            href={displacementMap}
            result="MAP"
            preserveAspectRatio="xMidYMid slice"
            x="0"
            y="0"
            width="100%"
            height="100%"
          />

          {/* Red channel — strongest inward displacement */}
          <feDisplacementMap
            in="SourceGraphic"
            in2="MAP"
            scale="-80"
            xChannelSelector="R"
            yChannelSelector="B"
            result="RED_D"
          />
          <feColorMatrix
            in="RED_D"
            type="matrix"
            values="1 0 0 0 0
                    0 0 0 0 0
                    0 0 0 0 0
                    0 0 0 1 0"
            result="RED"
          />

          {/* Green channel — slightly less */}
          <feDisplacementMap
            in="SourceGraphic"
            in2="MAP"
            scale="-72"
            xChannelSelector="R"
            yChannelSelector="B"
            result="GREEN_D"
          />
          <feColorMatrix
            in="GREEN_D"
            type="matrix"
            values="0 0 0 0 0
                    0 1 0 0 0
                    0 0 0 0 0
                    0 0 0 1 0"
            result="GREEN"
          />

          {/* Blue channel — least, so the rainbow splits */}
          <feDisplacementMap
            in="SourceGraphic"
            in2="MAP"
            scale="-64"
            xChannelSelector="R"
            yChannelSelector="B"
            result="BLUE_D"
          />
          <feColorMatrix
            in="BLUE_D"
            type="matrix"
            values="0 0 0 0 0
                    0 0 0 0 0
                    0 0 1 0 0
                    0 0 0 1 0"
            result="BLUE"
          />

          {/* Recombine — screen blend mixes the offset channels into a
              single image with chromatic aberration at the edges. */}
          <feBlend
            in="GREEN"
            in2="BLUE"
            mode="screen"
            result="GB"
          />
          <feBlend in="RED" in2="GB" mode="screen" />
        </filter>
      </defs>
    </svg>
  );
}
