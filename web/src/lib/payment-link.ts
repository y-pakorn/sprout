import { toBase64, fromBase64 } from "@mysten/sui/utils";

/**
 * Sprout Pay — stateless payment links.
 *
 * A payment link is just its data, base64url-encoded into the URL path
 * (`/pay/<blob>`). There is NO backend store: the link IS the record. The
 * recipient is kept VERBATIM (a 0x address or a SuiNS name) and re-resolved
 * live on the pay page — never trusted from the URL as a pre-resolved address.
 * The payload is intentionally unsigned (a signature wouldn't change what the
 * payer reviews on-page before signing; recipient disclosure is the defense).
 */

export const PAYMENT_LINK_VERSION = 1 as const;

/** Wire shape encoded into the URL. Keys are SHORT to keep links chat-friendly. */
type PaymentLinkWire = {
  v: 1;
  /** recipient: 0x address OR SuiNS name, exactly as the creator gave it. */
  r: string;
  /** token symbol (registry key, uppercased), e.g. "USDC" / "SUI". */
  s: string;
  /** requested amount (human units). Omitted => OPEN amount (payer chooses). */
  a?: number;
  /** title / memo, e.g. "Haidilao Meal". */
  t?: string;
  /** expiry, unix ms. Omitted => never expires. */
  e?: number;
  /** creator address — receipt "created by" line + the agentic status check.
   *  Never used as authority. */
  c?: string;
};

export type PaymentLinkData = {
  version: 1;
  /** Recipient name-or-address exactly as entered; resolved live on the pay page. */
  recipient: string;
  symbol: string;
  /** undefined = open amount (payer chooses). */
  amount?: number;
  title?: string;
  expiryMs?: number;
  creator?: string;
};

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(blob: string): Uint8Array {
  const b64 = blob.replace(/-/g, "+").replace(/_/g, "/");
  return fromBase64(b64);
}

export function encodePaymentLink(d: PaymentLinkData): string {
  const wire: PaymentLinkWire = {
    v: PAYMENT_LINK_VERSION,
    r: d.recipient.trim(),
    s: d.symbol.toUpperCase(),
    ...(d.amount != null && d.amount > 0 ? { a: d.amount } : {}),
    ...(d.title?.trim() ? { t: d.title.trim().slice(0, 80) } : {}),
    ...(d.expiryMs ? { e: d.expiryMs } : {}),
    ...(d.creator ? { c: d.creator } : {}),
  };
  const json = JSON.stringify(wire);
  return toBase64Url(new TextEncoder().encode(json));
}

export function decodePaymentLink(blob: string): PaymentLinkData {
  const json = new TextDecoder().decode(fromBase64Url(blob));
  const w = JSON.parse(json) as Partial<PaymentLinkWire>;
  if (w.v !== PAYMENT_LINK_VERSION) {
    throw new Error(`Unsupported payment-link version (${String(w.v)}).`);
  }
  if (typeof w.r !== "string" || !w.r || typeof w.s !== "string" || !w.s) {
    throw new Error("Malformed payment link.");
  }
  return {
    version: 1,
    recipient: w.r,
    symbol: w.s.toUpperCase(),
    amount: typeof w.a === "number" && w.a > 0 ? w.a : undefined,
    title: typeof w.t === "string" ? w.t : undefined,
    expiryMs: typeof w.e === "number" ? w.e : undefined,
    creator: typeof w.c === "string" ? w.c : undefined,
  };
}

export function isExpired(d: PaymentLinkData, nowMs = Date.now()): boolean {
  return d.expiryMs != null && nowMs > d.expiryMs;
}

/** Absolute share URL. `baseUrl` is `window.location.origin` on the client. */
export function paymentLinkUrl(baseUrl: string, blob: string): string {
  return `${baseUrl.replace(/\/$/, "")}/pay/${blob}`;
}
