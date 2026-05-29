import type { Metadata } from "next";
import localFont from "next/font/local";
import { Providers } from "@/components/providers";
import { CinematicChrome } from "@/components/cinematic-chrome";
import "./globals.css";
import { cn } from "@/lib/utils";

const labilGrotesk = localFont({
  src: [{ path: "./Variable.woff2", weight: "100 800", style: "normal" }],
  variable: "--font-brand",
  display: "swap",
});

// const geistMono = Geist_Mono({
//   subsets: ["latin"],
//   weight: ["400", "500", "600", "700"],
//   variable: "--font-mono-brand",
//   display: "swap",
// });

const SITE_TITLE = "Sprout — your money's agent on Sui";
const SITE_DESCRIPTION =
  "Tell us your goal in plain English. Sprout routes swaps, pools, and vaults across Sui — atomically — with a guardian that flags risk before you sign.";

// Production URL for absolute OG/Twitter image URLs; Vercel sets the env var,
// falls back to localhost in dev. opengraph-image.tsx / twitter-image.tsx are
// auto-detected by Next and resolved against this base.
const SITE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    siteName: "Sprout",
    url: "/",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn(labilGrotesk.variable, "h-full")}>
      <body className="min-h-full flex flex-col">
        <Providers>
          <CinematicChrome>{children}</CinematicChrome>
        </Providers>
      </body>
    </html>
  );
}
