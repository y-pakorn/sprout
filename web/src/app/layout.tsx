import type { Metadata } from "next";
import localFont from "next/font/local";
import { Sometype_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const cashSans = localFont({
  src: [
    { path: "./Regular.woff2", weight: "400", style: "normal" },
    { path: "./Medium.woff2", weight: "500", style: "normal" },
    { path: "./Semibold.woff2", weight: "600", style: "normal" },
    { path: "./Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-brand",
  display: "swap",
});

const sometypeMono = Sometype_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono-brand",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sprout — your money's agent on Sui",
  description:
    "Tell us your goal in plain English. Sprout routes swaps, pools, and vaults across Sui — atomically — with a guardian that flags risk before you sign.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${cashSans.variable} ${sometypeMono.variable} h-full`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
