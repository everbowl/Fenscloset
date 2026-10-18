import type { Metadata, Viewport } from "next";
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
import { ImportQueueProvider } from "@/components/import-queue-provider";

export const metadata: Metadata = {
  title: { default: "Fen's Closet", template: "%s · Fen's Closet" },
  description: "The family wardrobe.",
  applicationName: "Fen's Closet",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Fen's Closet" },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col"><ImportQueueProvider>{children}</ImportQueueProvider></body>
    </html>
  );
}
