import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pump Scanner",
  description: "Find pre-breakout Binance futures setups.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-muted">
        <div className="mx-auto max-w-md min-h-screen bg-background shadow-xl overflow-hidden relative">
          {children}
        </div>
      </body>
    </html>
  );
}
