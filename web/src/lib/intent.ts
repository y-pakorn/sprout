export type IntentInput = {
  amount: number;
  asset: string;
  toAsset?: string;
  risk: 0 | 1 | 2 | 3;
  targetApy: number;
  constraints: string;
  rawText: string;
};

export const DEFAULT_INTENT: IntentInput = {
  amount: 1000,
  asset: "USDC",
  risk: 1,
  targetApy: 7,
  constraints: "",
  rawText: "",
};

const STORAGE_KEY = "sprout.intent.v1";

export function saveIntent(intent: IntentInput) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(intent));
  } catch {
    /* ignore quota errors */
  }
}

export function loadIntent(): IntentInput | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as IntentInput;
  } catch {
    return null;
  }
}

export const RISK_LABELS = ["Sleep tight", "Steady", "Adventurous", "Send it"] as const;

export const SLIPPAGE_OPTIONS = [0.1, 0.3, 0.5, 1.0] as const;
export const LP_RANGE_OPTIONS = ["Wide", "Balanced", "Tight"] as const;
export type LPRange = (typeof LP_RANGE_OPTIONS)[number];

export type TuneState = {
  slippagePct: number;
  lpRange: LPRange;
};

export const DEFAULT_TUNE: TuneState = {
  slippagePct: 0.5,
  lpRange: "Balanced",
};
