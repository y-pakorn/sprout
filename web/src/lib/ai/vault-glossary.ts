// Canonical plain-English explanations for the recurring DeFi concepts
// Sprout's vault flow exposes. The system prompt instructs the agent to
// reproduce these verbatim when the user asks, AND the deposit card's
// expandable risk rows + the vault info dialog render the same strings.
// One source of truth keeps the prose consistent across surfaces.

export type GlossaryKey =
  | "impermanent-loss"
  | "concentrated-liquidity"
  | "apy-composition"
  | "reward-emissions"
  | "performance-fee"
  | "management-fee"
  | "withdrawal-lockup"
  | "mpc-custody"
  | "variable-apy"
  | "tvl-capacity"
  | "bluefin7k-aggregator"
  | "price-impact"
  | "slippage"
  | "protocol-risk"
  | "rate-slippage";

export const VAULT_GLOSSARY: Record<GlossaryKey, string> = {
  "impermanent-loss": `**Impermanent loss** is the gap between holding two tokens passively and putting them into a liquidity pool. When the price ratio between the two assets moves, the pool rebalances to keep its invariant — so you end up with less of the asset that went UP and more of the asset that went DOWN. The bigger the move, the wider the gap.

It's "impermanent" only in the sense that it closes if prices return to where you entered. If you withdraw after a big move, the loss is realized. Concentrated liquidity vaults amplify this: the LP position only earns fees while the price is inside the operator's chosen range, and exits the range with more of the worse-performing asset.`,

  "concentrated-liquidity": `**Concentrated liquidity** is an LP strategy where the operator picks a narrow price range — say "SUI between $2.80 and $3.20" — and provides all the capital inside that band. Fees are dense inside the range (higher yield per dollar) but the position EARNS NOTHING when price exits, and rebalancing back into the range can lock in losses.

This is why vaults running this strategy can show eye-catching APYs while still being riskier than a stablecoin pool: the headline rate assumes the operator's range stays correct.`,

  "apy-composition": `**Vault APY = Deposit Yield + Rewards − Fees.**

- **Deposit Yield**: yield the strategy actually generates from its core activity (LP fees, lending interest, etc.). Sustainable.
- **Rewards**: emissions paid in a separate token (often the protocol's governance token). Can dry up; the reward token itself can lose value. NOT durable.
- **Performance Fee**: applied to deposit yield only. Subtracted from your share of yield.

A vault showing 14% APY where 9% comes from rewards is very different from a vault showing 14% all-from-deposit-yield. The first depends on emission schedules; the second is closer to "real" yield.`,

  "reward-emissions": `**Reward emissions** are tokens minted by the protocol and distributed pro-rata to vault depositors. They juice the headline APY but carry two extra risks:

1. The emission schedule can end or get cut at any time.
2. The reward token's market price determines its USD value — if the token drops, your effective APY drops with it.

If reward APY > deposit APY, treat the headline as aspirational, not realized.`,

  "performance-fee": `**Performance fee** is a percentage the vault skims from yield (not principal) as compensation for the strategy operator. It's typically 5–20% and applied weekly or per-rate-update.

Performance fees apply to **deposit yield only**, not reward emissions. If a vault advertises 14% APY (10% deposit + 4% rewards) and charges a 10% performance fee, you actually see ~9% deposit yield + 4% rewards = ~13%.`,

  "management-fee": `**Management fee** is an annual percentage charged on TVL regardless of performance. Many Ember vaults charge 0% management; check the vault info before depositing.`,

  "withdrawal-lockup": `**Withdrawal lockup** means you can REQUEST to withdraw at any time, but funds become claimable only after a fixed delay (e.g. 3 days). The operator uses that window to unwind positions without forced losses.

During the lockup the strategy can still lose money, and reward emissions usually stop for shares queued for withdrawal. If you might need the funds quickly, this is a major risk.`,

  "mpc-custody": `**MPC custody** (multi-party computation) means the keys that hold vault assets are split across multiple parties (commonly FordeFi for Ember vaults), and no single party can move funds alone. Better than a single hot key, but you're still trusting the policy setup and the MPC operator.

It is NOT the same as self-custody. Funds aren't in your wallet while deposited — you hold shares; the vault holds the underlying.`,

  "variable-apy": `**APY is a rear-view-mirror number.** The headline you see is computed from the vault's recent share-price growth (deposit yield) plus current reward emission rates. Tomorrow's APY can differ.

What you actually realize depends on (a) how share price moves between your deposit and withdrawal, (b) how long emissions stay at current rates. The dashboards show 7-day / 30-day / 90-day growth — those are the closest thing to "what would I have earned."`,

  "tvl-capacity": `**TVL capacity** is the cap on total deposits a vault accepts. When a vault is near or at capacity, large deposits can move the share price unfavorably for you (you pay more per share). If the vault is past capacity, deposits are refused entirely.

A deposit that's a large fraction of current TVL (say >10%) is also risky for a different reason: your withdrawal can trigger position unwinds that the strategy may not absorb cleanly.`,

  "bluefin7k-aggregator": `**Bluefin7K** is a DEX aggregator on Sui that splits your trade across multiple liquidity venues (Cetus, Bluefin, Kriya, Aftermath, Turbos, FlowX, DeepBook, …) to find the best execution price. It runs the routing on-chain via a PTB so the swap is atomic — every leg executes or none do.

Sprout uses it for every swap, including the swap leg of "swap-and-deposit" flows.`,

  "price-impact": `**Price impact** is how much your trade itself moves the price you pay. It's separate from slippage (which is the protection threshold you set). A 2% price impact means your effective rate is 2% worse than the spot price quoted before you traded — usually because you're trading a meaningful fraction of pool liquidity.

For large trades in thin pools, price impact dominates fees and gas combined. The Guardian flags anything ≥1%.`,

  slippage: `**Slippage tolerance** is the maximum worse-than-expected fill you'll accept before the swap reverts. Set it too tight and your transaction fails; set it too loose and a sandwich/MEV bot can extract from you.

The Guardian's "Slippage cap" row checks whether your cap is wider than the current price impact. If the cap is tighter than impact, the swap will almost certainly revert.`,

  "protocol-risk": `**Protocol risk** is the umbrella term for everything that can go wrong with the on-chain code or its operators: smart-contract bugs, admin-key compromises, operator misconduct, oracle failures, dependent protocols collapsing.

For Ember vaults specifically: assets are held in MPC wallets, strategies are executed by named operators, and admin powers are limited but non-zero. Read Ember's risk disclosure before sizing a position you can't afford to lose.`,

  "rate-slippage": `**Rate slippage on vault deposits** happens when the vault's share-price updates between the moment you accept the quote and the moment the transaction lands on chain. We currently mint at \`minSharesToMint = 0\` — meaning we accept any share count — which is fine for most vaults where rates move slowly, but if the rate jumps adversely you could get fewer shares than expected.`,
};

/**
 * Helper to look up a glossary entry by key. Returns undefined for
 * unknown keys (so callers can decide whether to fall back).
 */
export function getGlossary(key: GlossaryKey): string {
  return VAULT_GLOSSARY[key];
}

/**
 * Compact catalog string for embedding in the agent's system prompt —
 * the keys + short summary. The agent uses keys to retrieve full text
 * via getGlossary on demand.
 */
export function glossaryIndex(): string {
  return (Object.keys(VAULT_GLOSSARY) as GlossaryKey[])
    .map((k) => {
      const first = VAULT_GLOSSARY[k].split("\n")[0].replace(/^\*\*|\*\*$/g, "").slice(0, 90);
      return `  - ${k}: ${first}`;
    })
    .join("\n");
}
