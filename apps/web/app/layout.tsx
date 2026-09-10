import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Interviewer",
  description: "Practice interviews out loud with an AI interviewer that listens, follows up, and scores you.",
};

/**
 * `maximum-scale` is deliberately NOT pinned — clamping zoom breaks
 * accessibility for anyone who needs to enlarge text. iOS only zooms inputs
 * with a font-size under 16px, which the forms here avoid instead.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fcfcfd",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
