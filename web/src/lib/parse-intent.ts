// Example prompt chips shown on the idle hero. A mix of swap, balance,
// and vault deposit flows so the user sees Sprout's full surface.

export const EXAMPLE_PROMPTS: { label: string; text: string }[] = [
  { label: "Swap 1 SUI → USDC", text: "Swap 1 SUI to USDC" },
  {
    label: "Deposit 100 USDC, best APY",
    text: "Deposit 100 USDC to the highest APY vault",
  },
  {
    label: "Half my USDC → top SUI vault",
    text: "Swap half of my USDC to SUI and deposit to the best SUI vault",
  },
  { label: "What's in my wallet?", text: "What's in my wallet?" },
];
