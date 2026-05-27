// Example prompt chips on the idle hero — eight curated starters spanning the
// gasless send, swap, send-chain, vault, and wallet-read capabilities.

export const EXAMPLE_PROMPTS: { label: string; text: string }[] = [
  { label: "Send 5 USDC · gasless", text: "Send 5 USDC to yoisha.sui" },
  { label: "Swap 1 SUI → USDC", text: "Swap 1 SUI to USDC" },
  {
    label: "Swap → send in one tx",
    text: "Swap 1 SUI to USDC and send it to yoisha.sui",
  },
  {
    label: "Deposit 100 USDC, best APY",
    text: "Deposit 100 USDC to the highest APY vault",
  },
  {
    label: "Half my USDC → top SUI vault",
    text: "Swap half of my USDC to SUI and deposit to the best SUI vault",
  },
  {
    label: "Spread USDC across top vaults",
    text: "Deposit 300 USDC across the top USDC vaults, weighted by risk",
  },
  {
    label: "Top 3 USDC vaults",
    text: "Show me the top 3 USDC vaults ranked by APY and risk",
  },
  { label: "What's in my wallet?", text: "What's in my wallet?" },
];
