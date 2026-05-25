import type { Metadata } from "next";
import localFont from "next/font/local";
import { Sometype_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { CinematicChrome } from "@/components/cinematic-chrome";
import "./globals.css";

const labilGrotesk = localFont({
  src: [{ path: "./Variable.woff2", weight: "100 800", style: "normal" }],
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
      className={`${labilGrotesk.variable} ${sometypeMono.variable} h-full`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>
          <CinematicChrome>{children}</CinematicChrome>
        </Providers>
      </body>
    </html>
  );
}
