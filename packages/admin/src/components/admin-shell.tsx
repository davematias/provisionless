import { ThemeToggle } from "@provisionless/design-system";
import Link from "next/link";
import type { ReactNode } from "react";

const NAV_ITEMS = [{ href: "/", label: "Dashboard" }] as const;

export default function AdminShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-muted/30 md:flex">
        <div className="flex h-14 items-center border-b border-border px-4">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            Provisionless
          </Link>
        </div>
        <nav aria-label="Admin" className="flex-1 p-3">
          <ul className="space-y-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="flex h-9 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="border-t border-border p-3">
          <ThemeToggle />
        </div>
      </aside>
      <div className="flex flex-1 flex-col">
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
