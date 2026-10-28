import { cn } from "../lib/utils.ts";

export interface LogoProps {
  /** Renders the wordmark next to the mark. Defaults to true. */
  showWordmark?: boolean;
  /** Extra classes for the wrapper. */
  className?: string;
  /** Extra classes for the mark, such as a larger size. */
  markClassName?: string;
}

/**
 * Provisionless lockup: the open-box mark with an optional wordmark.
 *
 * The mark draws with `currentColor`, so it follows the surrounding text colour in both themes. When
 * the wordmark is hidden the mark becomes the accessible label instead of decoration.
 */
export function Logo({ showWordmark = true, className, markClassName }: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg
        viewBox="0 0 32 32"
        fill="none"
        className={cn("size-6 shrink-0", markClassName)}
        aria-hidden={showWordmark ? true : undefined}
        role={showWordmark ? undefined : "img"}
        aria-label={showWordmark ? undefined : "Provisionless"}
      >
        <g stroke="currentColor" strokeWidth={4} strokeLinecap="round">
          <path d="M24 6H13a7 7 0 0 0-7 7v6a7 7 0 0 0 7 7h11" />
        </g>
        <circle cx="16" cy="16" r="3.4" fill="currentColor" />
      </svg>
      {showWordmark ? (
        <span className="text-sm font-semibold tracking-tight">Provisionless</span>
      ) : null}
    </span>
  );
}
