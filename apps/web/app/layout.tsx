import type { Metadata, Viewport } from "next";
import { Inter, Outfit } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AI Interviewer",
  description:
    "Practice interviews out loud with an AI interviewer that listens, follows up, and scores you.",
};

/**
 * `maximum-scale` is deliberately NOT pinned — clamping zoom breaks
 * accessibility for anyone who needs to enlarge text. iOS only zooms inputs
 * with a font-size under 16px, which the forms here avoid instead.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f7f4ee",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${outfit.variable}`}>
      <body className="antialiased">
        <div className="grain" aria-hidden />
        {children}
      </body>
    </html>
  );
}
