import Link from "next/link";
import { IRREGULAR_PATH, issuePath, MASTHEAD, shortDate, type Issue } from "@/lib/irregular";
import { cn } from "@/lib/utils";

/**
 * The newspaper clipping at the gate, beside the town's name.
 *
 * A small piece of the paper inside: ivory, rectangular, and framed by a fine
 * charcoal rule inset from its edge so the frame shows against the town's
 * dark walls. The masthead never changes. The number, date and headline below
 * it come from the newest issue on display, so printing an issue is all it
 * takes to change what the gate shows.
 *
 * The whole clipping opens the issue. "Past issues" is a separate link above
 * that one, because one link inside another is not valid HTML. On hover the
 * rule darkens and that is all. Nothing moves.
 */
export function IrregularClipping({ issue, className }: { issue: Issue; className?: string }) {
  return (
    <div
      className={cn(
        "group relative w-full max-w-[15.5rem] rounded-[2px] bg-paper-100 p-1.5 font-display text-charcoal-900",
        "shadow-[0_14px_30px_-16px_rgba(0,0,0,0.95)] ring-1 ring-black/40",
        "has-[a:focus-visible]:outline has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-4 has-[a:focus-visible]:outline-frost-300",
        className,
      )}
    >
      <div className="border border-charcoal-900/45 px-4 pb-3.5 pt-4 transition-colors duration-200 group-hover:border-charcoal-900">
        <p className="text-center text-[0.95rem] font-black uppercase leading-none tracking-[0.1em]">{MASTHEAD.title}</p>
        <p className="mt-1.5 text-center text-[0.8rem] italic text-charcoal-700">{MASTHEAD.subtitle}</p>

        <div className="mt-3 flex items-baseline justify-between border-y border-charcoal-900/50 py-1 text-[0.72rem] font-medium uppercase tracking-[0.1em] text-charcoal-900">
          <span>No. {issue.number}</span>
          <span>{shortDate(issue.date)}</span>
        </div>

        <p className="mt-3 text-balance text-center text-[1.05rem] font-bold leading-snug">{issue.headline}</p>

        {/* The link that covers the clipping. Its words sit here; its reach
            is the ::after box stretched over the whole card. */}
        <Link
          href={issuePath(issue.number)}
          className="mt-3 block text-center text-[0.8rem] font-semibold focus-visible:outline-none
            after:absolute after:inset-0 after:content-['']"
        >
          Read the latest issue →
        </Link>
        <Link
          href={IRREGULAR_PATH}
          className="relative z-10 mx-auto mt-3 block w-fit text-center text-[0.72rem] text-charcoal-700 underline
            decoration-charcoal-900/30 underline-offset-2 hover:text-charcoal-900 hover:decoration-charcoal-900 focus-visible:outline-none"
        >
          Past issues →
        </Link>
      </div>
    </div>
  );
}
