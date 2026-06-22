import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AuraGate · Agent Settlement Console",
  description: "Five AI agents buying live x402 APIs with real USDC on Arc Testnet.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
