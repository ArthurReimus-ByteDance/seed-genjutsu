import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { APP_NAME } from "@/lib/branding";
import "./globals.css";
const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
export const metadata: Metadata = {
  title: `${APP_NAME} — A new character. Every move.`,
  applicationName: APP_NAME,
  description:
    "A private creative studio for character replacement. Preserve the performance, direct the look, and create with Seedance and Seedream.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={"dark " + geist.variable + " " + mono.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
