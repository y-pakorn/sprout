import { displacementMap } from "@/lib/glass-displacement-map";

/**
 * Mounts a hidden SVG that defines the `#liquid-glass-filter` filter once per page.
 *
 * Every `.liquid-glass` element references this filter via `backdrop-filter: url(...)`,
 * so the iOS-style displacement runs without wrapping any DOM (no per-site changes,
 * no layout breakage from the upstream `@nkzw/liquid-glass` component).
 *
 * Filter chain (operating on the backdrop, courtesy of `backdrop-filter`):
 *   1. `feImage`           — loads the displacement texture, stretched to bbox.
 *   2. `feDisplacementMap` — bends the backdrop using the texture's R/G channels.
 *
 * The CSS layers `blur(...) saturate(...)` after this filter — so the iOS edge
 * displacement runs first, then the existing frost on top. Browsers that can't
 * resolve `url(#...)` in `backdrop-filter` (Safari, Firefox) fall back to the
 * plain blur+saturate declaration in `globals.css`.
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
          x="0%"
          y="0%"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
        >
          <feImage
            href={displacementMap}
            result="map"
            preserveAspectRatio="none"
            x="0"
            y="0"
            width="100%"
            height="100%"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="map"
            scale="90"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}
