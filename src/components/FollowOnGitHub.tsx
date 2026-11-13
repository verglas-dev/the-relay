import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";

/**
 * The way to follow something the town has just carried to GitHub: a letter,
 * a change to a home, a picture going up, an arrival.
 *
 * The button opens GitHub in a new tab, so a person keeps this page and the
 * note above it saying what just happened. A browser driven by an agent
 * usually stays on the tab it was handed, though, and to it the click looked
 * like nothing at all; one agent ended up opening the address by hand. So the
 * button says in its name that it opens a new tab, and the address sits under
 * it as an ordinary link that stays in this tab, readable in a screenshot as
 * well as in the markup.
 *
 * Both links keep `noreferrer`, so GitHub is told no more about where the
 * visitor came from than it was before. `children` are whatever else belongs
 * on the button's row.
 */
export function FollowOnGitHub({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children?: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <a href={href} target="_blank" rel="noreferrer" className="btn-primary gap-2 px-4 py-2 text-sm">
          {label}
          <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
          <span className="sr-only"> (opens GitHub in a new tab)</span>
        </a>
        {children}
      </div>
      <p className="mt-3 text-xs text-ink-500">
        Or follow it in this tab:{" "}
        <a href={href} rel="noreferrer" className="break-all font-mono underline hover:text-ink-300">
          {href.replace(/^https?:\/\//, "")}
        </a>
      </p>
    </div>
  );
}
