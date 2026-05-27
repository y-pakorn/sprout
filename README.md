# Sprout

**An agentic money concierge for Sui. Tell it a goal in plain English — it builds the transaction, shows you exactly what will happen, and only acts once you understand and sign.**

Built for **[Sui Overflow 2026](https://overflow.sui.io)** · Agentic Web track (Intent Engine).

---

## What it is

Most people can't use DeFi. Not because the yields aren't there, but because doing anything means hopping between a swap aggregator, three vault dashboards, a block explorer, and a wallet popup full of hex you have to trust blindly.

Sprout collapses all of that into one conversation. You say what you want — *"swap half my SUI to USDC and put it in the safest vault"*, *"send 20 USDC to alice.sui"*, *"what's my wallet earning right now?"* — and Sprout figures out the steps, fetches live on-chain data, and assembles a single transaction you can read before you sign.

It's not a chatbot that *describes* what you could do. It actually does it, on-chain, atomically.

## The core

**1. Anything on Sui, in one intent-driven transaction.**
Sprout aggregates a wide range of Sui actions — swaps, splits, merges, multi-vault deposits, withdrawals, transfers — and composes them *in parallel inside a single transaction*. Complex or simple, it's the same flow: state the goal in English, and a goal like *"swap everything to USDC and spread it across the top 3 vaults"* becomes one atomic transaction. Every step succeeds together or none do — no half-finished states, no babysitting a chain of wallet popups.

**2. An Adaptive Risk Guardian that flags everything.**
The Guardian reviews your transaction and surfaces every meaningful risk *before* you commit — and it's *adaptive*: the more complex the transaction, the more the review evolves to cover it, item by item. Capacity, fees, reward dependence, RWA and lockup caveats, beta status, irreversible sends — each called out in plain, human-readable language you can digest in one read.

**3. A PTB viewer — see exactly what hits the chain, before you sign.**
Before you ever press sign, Sprout shows you the actual Programmable Transaction Block in a human-readable summary and an easy-to-follow flow: *what* moves, *where*, and *why*. You see precisely what will be sent to the blockchain — never blind hex, never "trust me."

**4. Fully sponsored — no gas, no dust.**
Every action and transfer you run through Sprout is fully sponsored. You don't need to hold SUI, top up gas, or keep dust around to act. Just connect and go.

### The one rule that matters most

**The agent never does anything you didn't tell it to — and you always see the truth before you sign.**

This is the heart of Sprout. An AI agent that touches your money is only safe if a human stays the final gate. So Sprout is built so that *every* action, without exception, is laid out in full — the readable PTB and the Guardian's risk review — *before* your signature. Even if the agent gets something wrong, you catch it on screen, because there is no path to the chain that skips your eyes. No blind confirms. No silent execution. No "the agent already did it." Nothing leaves your wallet until you've read it, understood it, and signed it yourself — and the agent can never exceed the permission you granted.

You understand the transaction and its risk before you sign. That's the whole point.

## Also does

- **Reads anything on-chain.** Your balances, your vault positions and yield, any address's recent activity, token market data, and SuiNS name lookups — all in the same conversation.
- **Teaches as it goes.** Ask "what's impermanent loss?" and it explains, grounded in what's actually on your screen.

## Why Sui

Sprout is built around the primitives that make Sui uniquely suited to an action agent:

- **Programmable Transaction Blocks (PTBs)** let an entire multi-step plan — swap, split, merge, deposit, send — execute atomically in one signature.
- **zkLogin** means users sign in and transact without managing a seed phrase.
- **Sponsored transactions (Enoki)** let Sprout cover gas, so onboarding doesn't require holding SUI first.
- **SuiNS** turns `alice.sui` into a recipient you can confirm by name.
- **Object-centric composability** lets Sprout route across protocols (the 7K/Bluefin aggregator for swaps, Ember Finance for yield) without deploying a custom contract.

A generic LLM that happens to hold some SUI can't do any of this. The agent is better, safer, and more composable *because* it's on Sui.

## How it works (at a glance)

1. You type a goal.
2. Sprout streams its reasoning, calls on-chain tools to fetch live quotes and vault data, and assembles a plan.
3. The plan renders as a readable PTB viewer card alongside the Guardian's risk review — you see exactly what will hit the chain and why.
4. You review, understand, then sign once. The whole plan executes atomically, and Sprout sponsors the gas — no SUI or dust required.

## Tech

Next.js (App Router) · React · TypeScript · Tailwind CSS · AI SDK over OpenRouter · `@mysten/sui` + dapp-kit (wallet, RPC, PTBs) · Enoki (gas sponsorship) · 7K/Bluefin aggregator (swaps) · Ember Finance (vaults).

The full app lives in [`web/`](./web).

```bash
cd web
pnpm install
pnpm dev   # http://localhost:3000
```

Requires an `OPENROUTER_API_KEY` (and an `ENOKI_API_KEY` for gas sponsorship) in `web/.env.local` — see `web/.env.example`.
