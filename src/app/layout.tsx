import type { Metadata } from "next";
import "./globals.css";
import StyledJsxRegistry from "./registry";

export const metadata: Metadata = {
  title: "AuraSci",
  description:
    "Milestone-based open science funding infrastructure powered by AI Agents.",
};

// Web3 providers (wagmi/RainbowKit/react-query) live in `(app)/layout.tsx` so
// the static landing page at `/` doesn't pull the wallet stack into its compile graph.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&display=swap"
          rel="stylesheet"
        />
        <link rel="stylesheet" href="/bust-theme.css?v=3" />
      </head>
      <body>
        <StyledJsxRegistry>{children}</StyledJsxRegistry>
      </body>
    </html>
  );
}
