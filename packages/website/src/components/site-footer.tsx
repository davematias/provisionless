import { Logo } from "@provisionless/design-system";

import { site } from "../lib/site.ts";

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-6 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <Logo showWordmark={false} markClassName="size-5" />
          <p>© {new Date().getFullYear()} Provisionless</p>
        </div>
        <a
          href={site.githubUrl}
          target="_blank"
          rel="noreferrer"
          className="transition-colors hover:text-foreground"
        >
          GitHub
        </a>
      </div>
    </footer>
  );
}
