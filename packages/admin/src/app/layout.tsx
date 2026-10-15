import type { ReactNode } from "react";

import AuthGuard from "../components/auth-guard.tsx";

export const metadata = {
  title: "Provisionless Admin",
  description: "Administration for your Provisionless content.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthGuard>{children}</AuthGuard>
      </body>
    </html>
  );
}
