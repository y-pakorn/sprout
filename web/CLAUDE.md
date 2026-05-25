# CLAUDE.md — Sprout (web)

Project-level guidance for Claude Code. Read this before making changes.

## Project

**Sprout** — an agentic yield + swap concierge on **Sui**. Tell it a goal in plain English; it routes swaps, pools, and vault deposits across Sui atomically, with a "Guardian" that surfaces every meaningful risk before you sign. Built for **Sui Overflow 2026** (Agentic Web track). Single-page conversational UX; no custom Move contract (composes existing protocols).

## Stack

- **Next.js 16** (App Router, Turbopack) · React 19 · TypeScript
- **Tailwind CSS v4** (`@theme` tokens in `src/app/globals.css`; no `tailwind.config`)
- **base-ui** (`@base-ui/react`) primitives + a small shadcn-style `ui/` layer
- **motion** (`motion/react`) for animation
- **@mysten/dapp-kit** + `@mysten/sui` (wallet, tx, RPC) · **@tanstack/react-query**
- **AI SDK v5** (`ai`, `@ai-sdk/react`) over OpenRouter
- **Bluefin 7K aggregator** (swaps) + **Ember Finance** vaults (yield)
- Package manager: **pnpm**

## Design system — read `web/DESIGN.md` (canonical)

Amplemarket-derived **light** theme. Summary (full detail + refero source in DESIGN.md):

- **Palette:** Midnight Ink `#111` (text + dark-fill CTAs), Canvas `#f6f5f3` (page base), Canvas White `#fff` (cards), Whisper Gray `#f4f3ef` (nested recess), Muted Ash `#6d6c6b` (secondary text), hairline `rgba(17,17,17,.08)`. Pillar accents are **small functional accents only**.
- **Elevation:** page `#f6f5f3` (L0) → white `.surface-card` (L1, pops) → `.surface-panel` whisper-gray (L2, **nested-in-white only**). **Never gray on the page** — top-level surfaces are white.
- **Yield/positive signal = Deliver Green `#47d096`** (accent — fills/dots/strokes, never a CTA, never small green text). Warning = Engagement Gold `#fbc768`. Error = LeadGen Red `#e16540`.
- **Radius:** `rounded-card` = **12px** (default: cards/inputs/badges/chips/dialogs/images) · `rounded-button` = **8px** (buttons + nav) · `rounded-full` = **circles only** (avatars, dots, icon disks). shadcn `rounded-md/lg/xl` resolve to 12.
- **Shadows:** only the three refero tokens — `shadow-card`, `shadow-header` (dialogs/menus/sticky/floating), `shadow-button`. Never invent heavier shadows.
- **Type:** Labil Grotesk Variable (`Variable.woff2`, var `--font-brand`), Inter fallback. Per-size tracking (negative ≥20px, positive at 12/14). **Weights: 400 + 500; 600 rare. `font-bold` (700) is banned** — even hero headlines are medium.
- **Background:** WebGL `<GradientField>` (`parts/gradient-field.tsx`) — vivid orange/purple metaball blobs anchored lower-left/bottom over `#f6f5f3`, fluid + grainy + mouse-tracked; intensity via `<CinematicShell mode="bright|dim">`. Colors are the `--color-wash-*` tokens.

## Conventions (hard rules)

1. **`cn()` for all conditional className logic** (`@/lib/utils`). Never raw template-literal class strings.
2. **No inline `style={{}}` for design tokens.** Use Tailwind classes + CSS variables. Inline `style` is allowed *only* for genuinely runtime-dynamic values: element size from a `size` prop, hashed avatar background colors, the `--wash-opacity` CSS-var setter, and sparkline SVG geometry. Radius/shadow/font-weight/spacing/color must be classes.
3. **Reuse the `ui/` atoms** — don't re-implement repeated markup:
   - `SproutBadge` — the corner Sprout mark on a vault/position icon.
   - `StatusDisk` — circular icon container (`tone` green/gold/red/neutral, `solid?`).
   - `Tag` — small status/label chip (`tone` neutral/green/gold/red/violet).
   - `PillButton` — action button (`variant` primary/secondary/ghost).
   Surfaces use the `.surface-card` / `.surface-panel` / `.surface-charcoal` utilities.
4. **Keep server proxy routes for CORS-locked APIs** (`src/app/api/*` proxying Bluefin/7K). Never delete a proxy — the upstream is CORS-locked and Origin can't be faked from the browser.
5. **Test before asserting API/SDK behavior** — curl the endpoint / run the SDK before claiming "it does X." Don't guess response shapes.
6. **Don't start the dev server** — the user keeps `localhost:3000` running. Verify with build/lint, not by launching a server.
7. Don't reintroduce the old dark theme: no `<video>` background, no `.liquid-glass`, no lime `#00D54F`.

## Structure

```
src/
  app/            App Router pages (/, /portfolio) + api/ proxy routes; globals.css; layout.tsx (fonts)
  components/
    ui/           design atoms + shadcn primitives (button, dialog, input, badge, slider, …)
    parts/        feature cards/dialogs (live-plan-card, portfolio-view, vault-balance-card, …)
    *.tsx         top-level (site-header, chat-input, conversation, agent-message, wallet-button, …)
  lib/
    ai/           system prompt, tools, pricing, autocomplete, glossary
    bluefin7k.ts  7K aggregator client     vaults.ts / ember-actions.ts  Ember vaults
    sui.ts        networks/client          utils.ts  cn()
```

## Commands

```bash
pnpm -C web lint     # eslint (note: some pre-existing react-compiler/hooks warnings in app logic)
pnpm -C web build    # next build — the real correctness gate (types + compile)
```
