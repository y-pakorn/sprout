import type { Metadata } from "next";
import { decodePaymentLink } from "@/lib/payment-link";
import { PayClient } from "./pay-client";

type Params = { params: Promise<{ blob: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { blob } = await params;
  try {
    const d = decodePaymentLink(blob);
    const amt =
      d.amount != null ? `${d.amount} ${d.symbol}` : `any amount of ${d.symbol}`;
    const title = d.title ? `${d.title} — pay ${amt}` : `Pay ${amt}`;
    const description = `Pay ${d.recipient} ${amt} on Sui — gasless, pay with any token.`;
    return {
      title: `${title} · Sprout`,
      description,
      openGraph: { title, description, type: "website" },
      twitter: { card: "summary_large_image", title, description },
    };
  } catch {
    return { title: "Payment link · Sprout" };
  }
}

export default async function PayPage({ params }: Params) {
  const { blob } = await params;
  return <PayClient blob={blob} />;
}
