import { cardLine, issuePath, MASTHEAD, shortDate, type CardIssue } from "@/lib/irregular";
import { townUrl } from "@/lib/verglas-site";
import { cn } from "@/lib/utils";

/**
 * The Irregular on The Relay's front page: a copy of the paper left on a
 * coffeehouse table. You can see it's there to be read, and nobody stands
 * beside it insisting.
 *
 * The same ivory sheet and charcoal rule as the clipping at the gate, so it's
 * recognisably the town's paper. What it says is the editor's own: the name,
 * her invitation, the newest issue's number and date, and the line she chose
 * to lift out of it, left with no explanation. Until she chooses one, that line
 * is the headline. It doesn't announce new issues. Printing one quietly
 * changes the date and the line.
 *
 * The whole card opens the newest issue. The paper lives in the town, so the
 * link goes to the town's address. On hover the rule darkens and that is all.
 * Nothing moves. `link={false}` is the desk's preview, which draws the words
 * without going anywhere.
 */
export function IrregularCard({
  issue,
  link = true,
  className,
}: {
  issue: CardIssue;
  link?: boolean;
  className?: string;
}) {
  const read = "Read the paper →";
  return (
    <div
      className={cn(
        "group relative w-full max-w-[17.5rem] rounded-[2px] bg-paper-100 p-1.5 text-left font-display text-charcoal-900",
        "shadow-[0_14px_30px_-16px_rgba(0,0,0,0.95)] ring-1 ring-black/40",
        "has-[a:focus-visible]:outline has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-4 has-[a:focus-visible]:outline-frost-300",
        className,
      )}
    >
      <div className="border border-charcoal-900/45 px-4 pb-3.5 pt-4 transition-colors duration-200 group-hover:border-charcoal-900">
        <p className="text-center text-[0.95rem] font-black uppercase leading-none tracking-[0.1em]">{MASTHEAD.name}</p>
        <p className="mt-1.5 text-balance text-center text-[0.8rem] italic leading-snug text-charcoal-700">
          {MASTHEAD.invitation}
        </p>

        <div className="mt-3 flex items-baseline justify-between border-y border-charcoal-900/50 py-1 text-[0.72rem] font-medium uppercase tracking-[0.1em]">
          <span>No. {issue.number}</span>
          <span>{shortDate(issue.date)}</span>
        </div>

        <p className="mt-3 text-balance break-words text-center text-[1.05rem] font-bold leading-snug">{cardLine(issue)}</p>

        {link ? (
          // Its words sit here; its reach is the ::after box stretched over the card.
          <a
            href={townUrl(issuePath(issue.number))}
            aria-label={`${read.replace(" →", "")}: ${MASTHEAD.name}, No. ${issue.number}`}
            className="mt-3 block text-center text-[0.8rem] font-semibold focus-visible:outline-none
              after:absolute after:inset-0 after:content-['']"
          >
            {read}
          </a>
        ) : (
          <p className="mt-3 text-center text-[0.8rem] font-semibold">{read}</p>
        )}
      </div>
    </div>
  );
}
