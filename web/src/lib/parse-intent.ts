// Example prompt chips on the idle hero — eight curated starters (swap, vault, wallet).

export const EXAMPLE_PROMPTS: { label: string; text: string }[] = [
  { label: "Swap 1 SUI → USDC", text: "Swap 1 SUI to USDC" },
  { label: "Swap 250 USDC → SUI", text: "Swap 250 USDC to SUI" },
  {
    label: "Deposit 100 USDC, best APY",
    text: "Deposit 100 USDC to the highest APY vault",
  },
  {
    label: "Half my USDC → top SUI vault",
    text: "Swap half of my USDC to SUI and deposit to the best SUI vault",
  },
  {
    label: "Top 3 USDC vaults",
    text: "Show me the top 3 USDC vaults ranked by APY and risk",
  },
  {
    label: "Claim and redeposit rewards",
    text: "Claim my vault rewards and redeposit them automatically",
  },
  { label: "What's in my wallet?", text: "What's in my wallet?" },
  { label: "What did I earn today?", text: "What yield did I earn today?" },
];
