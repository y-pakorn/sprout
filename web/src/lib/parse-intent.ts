// Example prompt chips on the idle hero — curated starters that span the full
// capability surface: Sprout Pay payment links, gasless send, atomic swap→send,
// vault deposit + withdraw, vault P&L, wallet reads, on-chain activity, and
// concept education. One chip per capability; payment links lead as the
// headline feature.

export const EXAMPLE_PROMPTS: { label: string; text: string }[] = [
  // Sprout Pay — payment links (fixed + open tip jar)
  { label: "Create a 5 USDC link", text: "Create a payment link for 5 USDC" },
  { label: "Open tip jar link", text: "Create an open USDC tip jar link" },
  // Gasless send
  { label: "Send 5 USDC · gasless", text: "Send 5 USDC to yoisha.sui" },
  // Atomic swap → send in one signature
  {
    label: "Swap → send in one tx",
    text: "Swap 1 SUI to USDC and send it to yoisha.sui",
  },
  // Yield — deposit to the best vault
  {
    label: "Deposit 100 USDC, best APY",
    text: "Deposit 100 USDC to the highest APY vault",
  },
  // Yield — withdraw / redeem
  {
    label: "Withdraw from my vault",
    text: "Withdraw 50% of my USD vault position",
  },
  // Vault P&L read
  { label: "How are my vaults doing?", text: "How are my vaults doing?" },
  // Wallet read
  { label: "What's in my wallet?", text: "What's in my wallet?" },
  // On-chain activity
  { label: "My recent activity", text: "Show my recent on-chain activity" },
  // Concept education
  { label: "Explain impermanent loss", text: "What is impermanent loss?" },
];
