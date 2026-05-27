# Sprout

An intent execution engine for Sui. Describe an outcome in plain English and Sprout turns it into a single atomic, fully sponsored on-chain transaction that you review in full before signing.

Built for [Sui Overflow 2026](https://overflow.sui.io), Agentic Web track (Intent Engine).

## Overview

Sprout executes DeFi rather than describing it. You state an outcome, for example "swap everything to USDC and spread it across the safest three vaults" or "convert half my SUI and send it to alice.sui", and Sprout works out every action that outcome requires (swaps, splits, merges, vault deposits, withdrawals, transfers) and composes them into one atomic transaction on Sui. Whether the request is complex or trivial, it resolves to a single signature. Every step settles together or none of them do.

Moving funds is the straightforward part. The harder part is doing it in a way the user can trust, so Sprout pairs execution with three guarantees: an Adaptive Risk Guardian that flags every relevant risk, a PTB viewer that presents the exact transaction in plain language, and a strict rule that nothing reaches the chain without the user reading and signing it. Every transaction is also fully sponsored, so no gas, dust, or SUI balance is required to act.

Plain-English intent goes in; a reviewed, atomic, gas-free transaction comes out.

## Core capabilities

**Any Sui action, composed into one transaction.**
Sprout supports swaps, splits, merges, multi-vault deposits, withdrawals, and transfers, and composes them in parallel inside a single transaction. A request like "swap everything to USDC and spread it across the top three vaults" becomes one atomic operation. Every step succeeds together or the whole transaction reverts, so there are no partial states and no sequence of wallet prompts to manage.

**An Adaptive Risk Guardian.**
The Guardian reviews each transaction and surfaces every meaningful risk before the user commits. It is adaptive: as a transaction grows more complex, the review expands to cover it point by point. Capacity limits, fees, reward dependence, real-world-asset and lockup caveats, beta status, and irreversible transfers are each stated in plain language the user can read in one pass.

**A PTB viewer.**
Before signing, Sprout shows the actual Programmable Transaction Block as a readable summary and a clear step-by-step flow: what moves, where it goes, and why. The user sees exactly what will be submitted to the chain instead of raw transaction data.

**Full gas sponsorship.**
Every action and transfer run through Sprout is sponsored. Users do not need to hold SUI, top up gas, or keep dust on hand to transact.

## The core principle

Sprout never takes an action the user did not ask for, and the user always sees the full transaction before signing.

An agent that handles funds is only safe if a person remains the final approver. Every action, without exception, is presented in full through the PTB viewer and the Guardian's risk review before a signature is requested. If the agent gets something wrong, the user catches it on screen, because there is no path to the chain that bypasses review. There are no blind confirmations and no silent execution. Nothing leaves the wallet until the user has read, understood, and signed it, and the agent cannot exceed the permissions it was given.

## Built on Sui

Sprout relies on several Sui primitives that make this approach possible:

- **Programmable Transaction Blocks (PTBs)** allow a full multi-step plan to execute atomically under a single signature.
- **zkLogin** lets users sign in and transact without managing a seed phrase.
- **Sponsored transactions (Enoki)** let Sprout cover gas, so users do not need SUI to get started.
- **SuiNS** resolves names like `alice.sui`, so recipients can be confirmed by name.
- **Object-centric composability** lets Sprout route across protocols, using the 7K/Bluefin aggregator for swaps and Ember Finance for vaults, without deploying a custom contract.

A generic language model that happens to hold SUI cannot do any of this. The agent is more capable, safer, and more composable because it runs on Sui.

## How it works

1. The user states a goal.
2. Sprout reasons through it, calls on-chain tools to fetch live quotes and vault data, and assembles a plan.
3. The plan renders as a PTB viewer card alongside the Guardian's risk review, showing exactly what will be submitted and why.
4. The user reviews and signs once. The plan executes atomically and Sprout sponsors the gas.

## Additional features

- **On-chain reads.** Balances, vault positions and yield, recent activity for any address, token market data, and SuiNS lookups.
- **Explanations on demand.** Ask about a concept such as impermanent loss and Sprout explains it in the context of what is on screen.

## Stack

Next.js (App Router), React, TypeScript, Tailwind CSS, AI SDK over OpenRouter, `@mysten/sui` and dapp-kit (wallet, RPC, PTBs), Enoki (gas sponsorship), 7K/Bluefin aggregator (swaps), and Ember Finance (vaults).

The application lives in [`web/`](./web).

```bash
cd web
pnpm install
pnpm dev   # http://localhost:3000
```

Set `OPENROUTER_API_KEY` and `ENOKI_API_KEY` (for gas sponsorship) in `web/.env.local`. See `web/.env.example`.
