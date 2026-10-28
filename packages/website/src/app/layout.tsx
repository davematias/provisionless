import { ThemeProvider, ThemeScript } from "@provisionless/design-system";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SiteFooter } from "../components/site-footer.tsx";
import { SiteHeader } from "../components/site-header.tsx";
import { site } from "../lib/site.ts";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(site.siteUrl),
  title: {
    default: site.name,
    template: `%s | ${site.name}`,
  },
  description: site.description,
  openGraph: {
    type: "website",
    url: site.siteUrl,
    siteName: site.name,
    title: site.name,
    description: site.description,
    images: [
      {
        url: "/social-preview.png",
        width: 1280,
        height: 640,
        alt: "Provisionless — a serverless, headless CMS",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: site.name,
    description: site.description,
    images: ["/social-preview.png"],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-svh flex-col bg-background font-sans text-foreground antialiased">
        <ThemeScript />
        <ThemeProvider>
          <SiteHeader />
          <div className="flex-1">{children}</div>
          <SiteFooter />
        </ThemeProvider>
      </body>
    </html>
  );
}
