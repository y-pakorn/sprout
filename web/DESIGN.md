# Design — Style Reference

> Cash App's design language. Soft on shape, loud on contrast, generous with whitespace. Buttons are pills. Cards are pillows. Lime carries the brand.

**Theme:** light-primary with full-bleed lime / black / white sections that alternate by content type.

The aesthetic balances **rounded warmth** (pill buttons, soft cards, large image tiles) with **typographic confidence** (big tight-tracked headlines, single-color accents). Color and shape do the work — shadow and texture stay quiet.

---

## Tokens — Colors

| Name           | Value     | Token                    | Role                                                                              |
| -------------- | --------- | ------------------------ | --------------------------------------------------------------------------------- |
| Cash Lime      | `#00D54F` | `--color-cash-lime`      | Primary brand, hero backgrounds, primary CTA fills, status accents               |
| Midnight Black | `#000000` | `--color-midnight-black` | Primary text on light, secondary CTA fills, full-bleed dark sections             |
| Canvas White   | `#FFFFFF` | `--color-canvas-white`   | Primary background, button fills on lime, card fills on dark                     |
| Cloud Gray     | `#F4F4F5` | `--color-cloud-gray`     | Card fills on white, inner phone surfaces, low-contrast section dividers         |
| Subtle Gray    | `#858585` | `--color-subtle-gray`    | Secondary text, captions, supporting information                                  |
| Hinting Gray   | `#B3B3B3` | `--color-hinting-gray`   | Placeholder text, tertiary information, disabled icons                            |
| Ghost Border   | `#E5E7EB` | `--color-ghost-border`   | Subtle outlines on outline-pill buttons against light backgrounds                |

**Use Cash Lime liberally** — as full-section background, primary CTA fill, brand mark, status checks. It is the load-bearing brand element, not a sparse accent.

---

## Tokens — Typography

### CashSans — Primary brand typeface, used across all text. Bundled as `font.ttf` and loaded via `next/font/local` (variable `--font-brand`).

- **Substitute:** system-ui, -apple-system, BlinkMacSystemFont
- **Weights:** 400, 500, 700
- **Letter spacing:** -0.015em globally; -0.025em on display sizes
- **Line height:** 1.0 on display, 1.3 on title, 1.5 on body

### Type Scale

| Role        | Size                  | Line Height | Token              |
| ----------- | --------------------- | ----------- | ------------------ |
| caption     | 12px                  | 1.5         | `--text-caption`   |
| body-sm     | 14px                  | 1.5         | `--text-body-sm`   |
| body        | 16px                  | 1.5         | `--text-body`      |
| body-lg     | 20px                  | 1.5         | `--text-body-lg`   |
| title       | 32px                  | 1.2         | `--text-title`     |
| subhead     | 48px                  | 1.1         | `--text-subhead`   |
| hero        | `clamp(56, 9vw, 96)`  | 1.0         | `--text-hero`      |
| display     | `clamp(64, 12vw, 120)`| 0.95        | `--text-display`   |

Hero sizes are responsive clamp ranges, not fixed pixels — Cash App's hero headlines scale gracefully across viewports.

---

## Tokens — Spacing & Shapes

**Base unit:** 4px. **Density:** comfortable.

### Spacing Scale

| Name    | Value  | Token            |
| ------- | ------ | ---------------- |
| 1       | 4px    | `--spacing-1`    |
| 2       | 8px    | `--spacing-2`    |
| 3       | 12px   | `--spacing-3`    |
| 4       | 16px   | `--spacing-4`    |
| 5       | 20px   | `--spacing-5`    |
| 6       | 24px   | `--spacing-6`    |
| 8       | 32px   | `--spacing-8`    |
| 12      | 48px   | `--spacing-12`   |
| 16      | 64px   | `--spacing-16`   |
| 24      | 96px   | `--spacing-24`   |
| 32      | 128px  | `--spacing-32`   |

### Border Radius

| Element          | Value     | Token              |
| ---------------- | --------- | ------------------ |
| pill (buttons)   | `9999px`  | `--radius-pill`    |
| logo mark        | `14px`    | `--radius-mark`    |
| card             | `24px`    | `--radius-card`    |
| card-lg          | `32px`    | `--radius-card-lg` |
| image tile       | `28px`    | `--radius-image`   |
| phone mockup     | `40px`    | `--radius-phone`   |

**No sharp corners anywhere.** Even small UI elements take at least 14px.

### Layout

- **Section gap:** 96–128px between major content blocks
- **Card padding:** 24–32px inside cards
- **Element gap:** 12–16px within compositions

---

## Components

### Pill Button

The foundational interactive primitive. Always fully rounded. Four variants by context:

| Variant              | Fill                  | Text                  | Border       | Use                                                              |
| -------------------- | --------------------- | --------------------- | ------------ | ---------------------------------------------------------------- |
| **Primary lime**     | `Cash Lime`           | `Midnight Black`      | none         | Primary CTAs on light/dark backgrounds (Sign up, Get started)    |
| **Primary white**    | `Canvas White`        | `Midnight Black`      | none         | Primary actions on lime backgrounds (Add money, Done)            |
| **Secondary black**  | `Midnight Black`      | `Canvas White`        | none         | Secondary actions on lime/light (Log in on lime hero)            |
| **Outline light**    | transparent           | `Canvas White`        | 1.5px white  | Tertiary actions on dark backgrounds (Meet Cash App Card)        |
| **Outline dark**     | transparent           | `Midnight Black`      | 1.5px black  | Tertiary actions on light backgrounds (Learn about Green)        |

Sizes: standard pill is ~48px tall (16px body text, 14px vertical padding, 24px horizontal padding). Small pill is ~36px tall.

### Card

Soft container with generous rounding. Two variants:

- **Surface card** — Cloud Gray fill (`#F4F4F5`), 24px radius, 24–32px inner padding, no border, no shadow. Use for grouped content on white.
- **Dark card** — Midnight Black fill, 24px radius, white text, 24–32px inner padding. Use for emphasized blocks against light.

### Logo Mark

Rounded square brand mark. 28–32px square, 14px radius, Cash Lime fill, contrasting glyph inside. Sized down to 24px in dense headers.

### Image Tile

Full-bleed photographic/illustrative content in a rounded container. 28px radius, no border, no shadow. Image fills 100% of tile. Used in card grids for product features.

### Phone Mockup

Device-style container. 40px outer radius, content fills viewport with internal cards using 16-20px radius. Background is typically Cloud Gray or Black to read against the page section.

### Conversation Surface (Sprout-specific)

For the AI chat flow, message blocks are **24px rounded cards** with 24px padding, separated by 16-24px vertical gap. Allocation, guardian, and receipt blocks each render as their own card.

---

## Do's and Don'ts

### Do

- **Make everything rounded.** Pills for buttons (fully rounded), 24px+ for cards, 14px for marks, 28px for image tiles.
- **Use Cash Lime liberally** — full-section backgrounds, primary CTAs, brand identity. It's the brand, not a sparse accent.
- **Alternate section backgrounds** — lime, black, and white can each carry a full page section. Let pages breathe across these zones.
- **Pair big tight-tracked headlines with calm body text** — apply `-0.025em` letter-spacing to display sizes, `-0.015em` everywhere else.
- **Use generous whitespace** — 96-128px gaps between major sections, 24-32px inside cards.
- **Give every CTA a pill shape and a clear hierarchy** (primary lime / secondary black / outline tertiary).
- **Keep card surfaces soft** — Cloud Gray fill on white pages, no shadows, no borders, just radius and fill.

### Don't

- **No sharp corners.** Anything 0px feels off-brand. Minimum radius is 14px for small marks, 24px for cards, full-pill for buttons.
- **No heavy shadows or gradients** — depth comes from color contrast and radius, not blur.
- **Don't use saturated colors outside the palette** — Cash Lime is the only brand accent.
- **Don't crowd the layout** — Cash App pages are 70% empty space. Let typography and one strong visual carry each section.
- **Don't mix button shapes** — every button is a pill. Square buttons exist only for icon-only utility actions (and even those are usually rounded-square).
- **Don't use display sizes (>56px) for non-hero copy** — that scale is reserved for one statement per section.

---

## Quick Start

### Tailwind v4 `@theme`

```css
@theme {
  /* Colors */
  --color-cash-lime: #00d54f;
  --color-midnight-black: #000000;
  --color-canvas-white: #ffffff;
  --color-cloud-gray: #f4f4f5;
  --color-subtle-gray: #858585;
  --color-hinting-gray: #b3b3b3;
  --color-ghost-border: #e5e7eb;

  /* Typography */
  --font-cashsans:
    var(--font-brand), "CashSans", ui-sans-serif, system-ui, -apple-system, sans-serif;

  --text-caption: 12px;
  --text-body-sm: 14px;
  --text-body: 16px;
  --text-body-lg: 20px;
  --text-title: 32px;
  --text-subhead: 48px;
  --text-hero: clamp(56px, 9vw, 96px);
  --text-display: clamp(64px, 12vw, 120px);

  /* Spacing — base 4px */
  --spacing-1: 4px;
  --spacing-2: 8px;
  --spacing-3: 12px;
  --spacing-4: 16px;
  --spacing-5: 20px;
  --spacing-6: 24px;
  --spacing-8: 32px;
  --spacing-12: 48px;
  --spacing-16: 64px;
  --spacing-24: 96px;
  --spacing-32: 128px;

  /* Radii */
  --radius-pill: 9999px;
  --radius-mark: 14px;
  --radius-card: 24px;
  --radius-card-lg: 32px;
  --radius-image: 28px;
  --radius-phone: 40px;
}
```

### Component examples

**Pill button — primary lime:**
```tsx
<button className="rounded-pill bg-cash-lime px-6 py-3.5 text-body font-medium text-midnight-black transition-colors hover:bg-midnight-black hover:text-cash-lime">
  Sign up →
</button>
```

**Pill button — outline on light:**
```tsx
<button className="rounded-pill border-[1.5px] border-midnight-black bg-transparent px-6 py-3.5 text-body font-medium text-midnight-black transition-colors hover:bg-midnight-black hover:text-canvas-white">
  Learn more
</button>
```

**Surface card:**
```tsx
<div className="rounded-card bg-cloud-gray p-6">
  ...content...
</div>
```

**Logo mark:**
```tsx
<span className="inline-flex size-7 items-center justify-center rounded-mark bg-cash-lime text-midnight-black">
  $
</span>
```

---

## Similar Brands (aesthetic neighbors, not copies)

- **Robinhood** — Generous whitespace, single-color brand accent, large rounded image tiles.
- **Linear** — Sharp typographic hierarchy, calm card surfaces, deliberate rounding.
- **Stripe** — Confident lime/green moments embedded in a calm white system.

---

## Sprout Application Notes

For the Sprout intent-engine app specifically:

1. **Hero section** uses `--text-hero` clamp(56, 9vw, 96), left-aligned, with a one-line question that immediately solicits intent.
2. **Chat input** is a single-line pill (rounded-full, Cloud Gray fill, 24px horizontal padding) with a pill-shaped or rounded-square send button at the right.
3. **Example prompt chips** are small pills (Cloud Gray fill, rounded-pill, 14px body-sm, 8px vertical / 16px horizontal padding).
4. **Agent allocation/guardian/receipt blocks** each render as 24px-rounded surface cards with the protocol icons inset.
5. **Sticky confirm bar** appears as a single composed pill row at the bottom: Cloud Gray background pill containing the primary lime "Confirm & sign" pill plus a secondary outline "Start over" pill.
6. **Brand mark** is the lime rounded square containing the Sprout glyph (14px radius, 28px size).
7. **Status indicators** (guardian pass/flag/block) use small colored dots inside pill chips, never sharp shapes.
