import type { ReactNode } from "react";

export const metadata = {
  title: "Provisionless Admin",
  description: "Administration for your Provisionless content.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
