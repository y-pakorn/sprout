# Design — Sprout Style Reference

> Cinematic, garden-coded fintech. Live grass-and-sky video underneath, frosted liquid glass on top, lime carries the brand. The page feels like a window into a calm field — not a dashboard.

**Theme:** dark cinematic primary. Every page sits inside a video-backed shell with a glass header; only the landing hero shows the bg at full brightness, every other surface dims and blurs it so cards and text stay legible. Workspace (canvas-white) tokens still exist — they're reserved for dialogs and dense data.

The aesthetic balances **rounded warmth** (pill buttons, soft glass cards, generous radii) with **typographic confidence** (big tight-tracked white headlines on dimmed grass). Color and shape do the work. Lime is the action color and never the background tone — it would camouflage against the grass.

---

## Cinematic mode (primary)

### Background

A single full-viewport `<video>` element with `playbackRate = 1.25`, mouse-driven parallax via `motion/react`'s `useSpring`. The video lives in `web/src/components/parts/hero-video-bg.tsx` with two modes:

| Mode      | When to use                          | Visual                                                                                                  |
| --------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `bright`  | Landing hero only (`/` idle state)   | Full color, 1.08× scale, ±20px parallax. Light top scrim + heavy bottom scrim.                          |
| `dim`     | Every other page + chat-in-progress  | `filter: blur(6px) brightness(0.55) saturate(115%)`, ±12px parallax. Full-viewport `rgba(8,12,16,0.62)` overlay so cards read clean. |

Every page should wrap its content in `<CinematicShell mode="dim">` (`web/src/components/parts/cinematic-shell.tsx`). The shell mounts the video + glass header + a positioned z-20 content slot.

### Liquid glass

Custom utility `.liquid-glass` in `web/src/app/globals.css`. Frosted background with a sliver gradient border via `::before`.

```css
.liquid-glass {
  background: rgba(255,255,255,0.06);
  backdrop-filter: blur(14px) saturate(140%);
  box-shadow: inset 0 1px 1px rgba(255,255,255,0.1);
  /* + gradient hairline */
}
```

Use it for:
- Header nav pill
- Chip groups (example prompts, status pills)
- Card shells over dim cinematic bg
- User chat bubbles
- Wallet connect button when on cinematic chrome

Don't nest `.liquid-glass` inside another `.liquid-glass` — double-blur looks muddy.

### Headline typography

Two-line headline pair: line 1 white medium, line 2 white medium (same weight — opacity-only contrast fails on variable bg). Always include layered text-shadow so legibility survives the grass→sky transition:

```ts
textShadow: "0 2px 24px rgba(0,0,0,0.25)"
```

Font: CashSans, `clamp(40px, 5.4vw, 72px)`, `letter-spacing: -0.025em`, `leading: 1.05`. Centered.

### Tone variants on components

Components that ship with `tone` or `variant` props:

| Component         | Prop            | Glass mode                                                    |
| ----------------- | --------------- | ------------------------------------------------------------- |
| `SiteHeader`      | `variant="glass"` | Transparent header, wordmark only (no lime square), glass nav pill, glass wallet pill |
| `WalletButton`    | `tone="glass"`  | Glass pill, white text, "Connect" CTA replaces "Connect wallet" |
| `ExamplePrompts`  | `tone="glass"`  | Opaque white pills with subtle ring (kept light for legibility — chips are CTAs) |
| `LegRow`          | `tone="glass"`  | White primary text, white/55 secondary, lime APY accent       |

### Scrims

Cinematic content needs scrims, not vignettes. Top scrim anchors the header; bottom scrim anchors hero content over busy grass. Tokens:

```css
--scrim-top: linear-gradient(180deg, rgba(8,16,12,0.55) 0%, rgba(0,0,0,0) 100%);
--scrim-bottom: linear-gradient(0deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 100%);
```

### Readability rules

- **Never use opacity-only contrast** on cinematic bg. `text-white/55` reads on a clean dark surface, but disappears against bright grass. Bump opacity AND add `text-shadow`, or switch to a darker scrim region.
- **Hero text always uses layered shadow.** A single tight shadow handles sharp edges; a wider halo separates from variable backdrops.
- **Lime is reserved for actions + positive deltas.** Never a large surface against grass — it camouflages. Use Cash Lime for: chat-input submit button, CTA pills, "Earning APY" stat, +yield text.
- **Vault badges and brand marks stay opaque.** Sprout corner badges over photos use `bg-cash-lime text-midnight-black` — high-contrast micro chips.

---

## Workspace mode (secondary)

Canvas-white + Cloud Gray cards. Use for:

- **Dialogs / modals** (`vault-info-dialog` etc.) — focused workspace where readability trumps cinematic feel.
- **Markdown tables** inside agent replies — fall back to workspace when the cinematic glass can't carry the density.
- **Receipts / completed transactions** — confirmation surfaces that need to feel grounded.

All workspace surfaces should sit *inside* a cinematic shell, not replace it. The page stays cinematic; the workspace surface is a card.

---

## Tokens — Colors

| Name           | Value     | Token                    | Role                                                                             |
| -------------- | --------- | ------------------------ | -------------------------------------------------------------------------------- |
| Cash Lime      | `#00D54F` | `--color-cash-lime`      | Action accent, positive yield, brand glyph. Never a large surface against grass. |
| Midnight Black | `#000000` | `--color-midnight-black` | Text on lime fills, sprout badge glyph, workspace text                           |
| Canvas White   | `#FFFFFF` | `--color-canvas-white`   | Primary text on cinematic, primary background for workspace mode                 |
| Cloud Gray     | `#F4F4F5` | `--color-cloud-gray`     | Workspace card fill (dialogs only)                                               |
| Subtle Gray    | `#858585` | `--color-subtle-gray`    | Workspace secondary text                                                         |
| Hinting Gray   | `#B3B3B3` | `--color-hinting-gray`   | Workspace placeholder text                                                       |
| Ghost Border   | `#E5E7EB` | `--color-ghost-border`   | Workspace outlines                                                               |

Add: `--color-canvas-glass: rgba(255,255,255,0.06)` for glass surfaces.

---

## Tokens — Typography

### CashSans

Bundled as `font.ttf` and loaded via `next/font/local` (variable `--font-brand`). Weights 400/500/700. Letter spacing -0.015em globally, -0.025em on display sizes.

### Type Scale

| Role     | Size                  | Line Height | Token            |
| -------- | --------------------- | ----------- | ---------------- |
| caption  | 12px                  | 1.5         | `--text-caption` |
| body-sm  | 14px                  | 1.5         | `--text-body-sm` |
| body     | 16px                  | 1.5         | `--text-body`    |
| body-lg  | 20px                  | 1.5         | `--text-body-lg` |
| title    | 32px                  | 1.2         | `--text-title`   |
| subhead  | 48px                  | 1.1         | `--text-subhead` |
| hero     | `clamp(56, 9vw, 96)`  | 1.0         | `--text-hero`    |
| display  | `clamp(64, 12vw, 120)`| 0.95        | `--text-display` |

### Hero shadows

`--shadow-hero-text: 0 1px 2px rgba(0,0,0,0.35), 0 4px 32px rgba(0,0,0,0.55)`

---

## Tokens — Shape & Spacing

**Base unit:** 4px. **Density:** comfortable.

### Radii

| Element          | Value     | Token              |
| ---------------- | --------- | ------------------ |
| pill (buttons)   | `9999px`  | `--radius-pill`    |
| logo mark        | `14px`    | `--radius-mark`    |
| card             | `24px`    | `--radius-card`    |
| card-lg          | `32px`    | `--radius-card-lg` |
| image            | `28px`    | `--radius-image`   |

Glass cards default to `--radius-card` (24px). Inner rows: 18px.

### Spacing

4–24 scale (4px base). Section gap 96–128px on cinematic landing; 32–48 on dense in-app surfaces.

---

## Components

### Site header (`web/src/components/site-header.tsx`)

- `variant="glass"` — cinematic chrome on every page. Wordmark (Sprout glyph + "Sprout TM"), nav pill in `.liquid-glass`, glass wallet pill on the right.
- `variant="solid"` — workspace fallback, rare. Canvas-white bar with Cloud Gray active pill.

### Chat input (`web/src/components/chat-input.tsx`)

White pill, ALWAYS. It's the anchor — the single focal action on cinematic pages. No focus ring on the cinematic page (it draws too hard against grass); the bg switch from `bg-cloud-gray` → `bg-canvas-white` on focus is enough.

### Example prompts (`web/src/components/example-prompts.tsx`)

Pill chips. Two tones:
- `default` — Cloud Gray fill, midnight text (workspace).
- `glass` — opaque white pills with subtle ring (cinematic). Kept light because they're CTAs; full glass would dissolve.

### Conversation surfaces (`web/src/components/conversation.tsx`)

- **Idle (`messages.length === 0`)**: `<CinematicShell mode="bright">` with centered hero text + chat input + glass example chips.
- **Chat-in-progress**: `<CinematicShell mode="dim">` with scrolling messages on top of dimmed bg. Chat input pill stays at the bottom.

### Cards (parts/*.tsx)

All major cards (`live-vault-card`, `vault-balance-card`, `wallet-card`, `balance-card`, `live-swap-card`) use `.liquid-glass` outer shell with inner rows on `.liquid-glass` at 18px radius. Text white primary, white/55 secondary, lime accent for APY/yield positive.

### Agent message (`web/src/components/agent-message.tsx`)

- **User bubble**: `.liquid-glass`, white text, 16px radius. Right-aligned.
- **Assistant text**: white markdown body. Inline code on `bg-white/10`. Links underlined with lime decoration.

### Plan card (`web/src/components/parts/live-vault-card.tsx`)

Numbered step rows on glass shell. Vault name + APY chip as hero. APY in white tabular-nums. Hover chevron on deposit rows.

### Vault balance card

Tabbed (Positions / Pending / Activity). Tab pill uses `.liquid-glass` with active tab `bg-midnight-black text-canvas-white`.

### Portfolio page (`web/src/app/portfolio/page.tsx`)

Cinematic dim shell. Hero: centered "$X" total in display-tight white. Stats: glass card with lime accent for Net Worth. Sections: glass card outer, dividers `divide-white/8`.

---

## Do's / Don'ts

**Do**
- Wrap every page in `<CinematicShell mode="dim">` (or `mode="bright"` for the landing hero).
- Layer shadows on hero text — never rely on opacity for contrast.
- Use lime for actions + positive deltas only.
- Use `.liquid-glass` for shells and chips; let videos and dimming carry depth.
- Use `cn()` (`@/lib/utils`) for all conditional class logic — never raw template literals.

**Don't**
- Use `text-white/40` or `text-white/55` for important content on cinematic bg. Variable backgrounds eat low-opacity text.
- Apply lime as a large surface against grass — it camouflages.
- Nest `.liquid-glass` inside another `.liquid-glass`.
- Add sharp-cornered cards. Min radius is 14px (logo mark); rows are 18px; cards 24px.
- Reach for new font families. CashSans is the only typeface.

---

## Quick start

`web/src/app/globals.css` defines the theme as Tailwind v4 `@theme` tokens plus the `.liquid-glass` utility. Both modes share the same color palette — cinematic just composes them differently.

Minimum cinematic page:

```tsx
import { CinematicShell } from "@/components/parts/cinematic-shell";

export default function Page() {
  return (
    <CinematicShell mode="dim">
      <main className="mx-auto max-w-3xl px-6 pb-24 pt-28">
        <h1
          className="display-tight text-canvas-white font-medium"
          style={{
            fontSize: "clamp(40px, 5.4vw, 72px)",
            textShadow: "0 2px 24px rgba(0,0,0,0.25)",
          }}
        >
          Yield without friction.
        </h1>
        <div
          className="liquid-glass p-6 mt-8"
          style={{ borderRadius: 24 }}
        >
          {/* glass card content here, white text */}
        </div>
      </main>
    </CinematicShell>
  );
}
```
