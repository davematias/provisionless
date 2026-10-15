import type { ReactNode } from "react";

import AuthGuard from "../components/auth-guard.tsx";
import ThemeProvider from "../components/theme-provider.tsx";
import ThemeScript from "../components/theme-script.tsx";

import "./globals.css";

export const metadata = {
  title: "Provisionless Admin",
  description: "Administration for your Provisionless content.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-svh bg-background font-sans text-foreground antialiased">
        <ThemeScript />
        <ThemeProvider>
          <AuthGuard>{children}</AuthGuard>
        </ThemeProvider>
      </body>
    </html>
  );
}
