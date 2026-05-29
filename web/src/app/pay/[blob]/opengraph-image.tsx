import { decodePaymentLink } from "@/lib/payment-link";
import { renderPaymentLinkOg, renderSproutOg } from "@/app/_og/sprout-og";

export const runtime = "nodejs";
// Per-blob card — must render at request time, not at build.
export const dynamic = "force-dynamic";
export { size, contentType } from "@/app/_og/sprout-og";
export const alt = "Sprout payment link";

export default async function Image({
  params,
}: {
  params: Promise<{ blob: string }>;
}) {
  const { blob } = await params;
  try {
    return renderPaymentLinkOg(decodePaymentLink(blob));
  } catch {
    // Malformed link → fall back to the generic Sprout card.
    return renderSproutOg();
  }
}
