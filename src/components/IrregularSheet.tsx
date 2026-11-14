import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { CorrectionsLink } from "@/components/CorrectionsLink";
import { LinkifiedText } from "@/components/LinkifiedText";
import {
  bodyBlocks,
  IRREGULAR_PATH,
  issuePath,
  longDate,
  MASTHEAD,
  type Issue,
  type IssueContent,
  type Piece,
} from "@/lib/irregular";
import { splitInline } from "@/lib/post-content";
import { cn } from "@/lib/utils";

/**
 * The Verglas Irregular, set as a page of newsprint.
 *
 * The town's colours and bar stay around it; the sheet itself is warm ivory
 * with charcoal ink and wide margins. It has no creases, no stains and no
 * parchment. The newspaper character comes from the typesetting: one serif
 * throughout, thin rules, a dateline, and enough empty space that a short
 * piece can stand on its own.
 *
 * No hooks and nothing server-only, because the editor's desk renders the very
 * same sheet in the browser as its preview. What she previews is what prints.
 */

const INK_LINK =
  "text-charcoal-900 underline decoration-charcoal-900/35 underline-offset-2 hover:decoration-charcoal-900";

/** The ivory sheet. Rectangular, with a hint of shadow. */
export function PaperSheet({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <article
      className={cn(
        "mx-auto w-full max-w-[58rem] rounded-[2px] bg-paper-100 font-display text-charcoal-900 ring-1 ring-black/40",
        "shadow-[0_28px_60px_-30px_rgba(0,0,0,0.95)] selection:bg-charcoal-900/15",
        // The town's base styles make every heading white for its dark walls.
        // On paper they are ink like everything else.
        "[&_:is(h1,h2,h3)]:text-charcoal-900",
        "px-5 py-9 sm:px-10 sm:py-12 md:px-16 md:py-14",
        className,
      )}
    >
      {children}
    </article>
  );
}

/** The masthead, then a dateline between thin rules. */
export function Masthead({ left, middle, right }: { left: ReactNode; middle: ReactNode; right?: ReactNode }) {
  return (
    <>
      <header className="text-center">
        <p className="text-balance text-[clamp(1.7rem,6.2vw,3.6rem)] font-black uppercase leading-[0.95] tracking-[0.07em]">
          {MASTHEAD.title}
        </p>
        <p className="mt-3 text-lg italic text-charcoal-700 md:text-xl">{MASTHEAD.subtitle}</p>
        <p className="mt-3 text-balance text-[0.8rem] text-charcoal-600">{MASTHEAD.disclaimer}</p>
      </header>
      <div
        className="mt-7 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-y border-charcoal-900/80
          border-t-[3px] border-t-charcoal-900/80 py-2 text-[0.78rem] font-medium uppercase tracking-[0.16em] [border-top-style:double]"
      >
        <span>{left}</span>
        <span className="text-center">{middle}</span>
        <span className="hidden sm:inline">{right ?? "verglas.town"}</span>
      </div>
    </>
  );
}

/** A run of words with her emphasis and links set as such. Always React text, never HTML. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {splitInline(text).map((piece, index) => {
        const words = <LinkifiedText text={piece.text} linkClassName={INK_LINK} />;
        const emphasised = piece.italic ? <em>{words}</em> : words;
        return <Fragment key={index}>{piece.bold ? <strong className="font-bold">{emphasised}</strong> : emphasised}</Fragment>;
      })}
    </>
  );
}

/** About two lines at the story's measure, beside a cap two lines tall. */
const DROP_CAP_MIN = 80;

function PieceBody({ piece, dropCap, quiet }: { piece: Piece; dropCap: boolean; quiet: boolean }) {
  const blocks = bodyBlocks(piece.body);
  let firstParagraph = true;

  return (
    <div className={cn("whitespace-pre-line text-[1.0625rem] leading-[1.7] md:text-[1.125rem]", quiet && "text-center")}>
      {blocks.map((block, index) => {
        if (block.kind === "break") {
          return (
            <p key={index} aria-hidden="true" className="my-7 text-center tracking-[0.6em] text-charcoal-600">
              ⁂
            </p>
          );
        }
        if (block.kind === "subhead") {
          return (
            <h3 key={index} className="mb-2 mt-8 text-[0.8rem] font-bold uppercase tracking-[0.16em]">
              <Inline text={block.text} />
            </h3>
          );
        }

        // Newsprint, not a web page: paragraphs follow one another with an
        // indent rather than a gap, except where the text starts afresh.
        const previous = blocks[index - 1];
        const indented = !quiet && previous?.kind === "paragraph";
        // A drop cap is two lines tall, so it needs at least that much
        // paragraph beside it; on a one-line opening it hangs in the air.
        const capped = dropCap && firstParagraph && block.text.length >= DROP_CAP_MIN;
        firstParagraph = false;
        return (
          <p
            key={index}
            className={cn(
              indented && "indent-[1.5em]",
              quiet && index > 0 && "mt-4",
              capped &&
                "first-letter:float-left first-letter:mr-2 first-letter:mt-[0.08em] first-letter:text-[3.4em] first-letter:font-bold first-letter:leading-[0.82]",
            )}
          >
            <Inline text={block.text} />
          </p>
        );
      })}
    </div>
  );
}

/**
 * The pieces of an issue.
 *
 * Set as one story, they read on in a single column. Set as separate pieces,
 * each is its own article: a full rule above it and a headline at article
 * size, so a brief can't be mistaken for a section of the piece beside it.
 * Sections *within* a piece use the small capitals of a `# subheading`, which
 * no article headline ever does.
 *
 * A piece that stands alone belongs to the whole issue, not to whatever came
 * before it. Under separate pieces it gets a full-width rule that closes the
 * columns above it. In a single story it is the closing beat, set apart by
 * space alone.
 */
function Pieces({ content }: { content: IssueContent }) {
  const columns = content.layout === "columns" && content.pieces.length > 1;

  return (
    <div
      className={cn(
        "mt-10",
        columns
          ? "md:columns-2 md:gap-x-12 md:[column-rule:1px_solid_rgba(38,36,33,0.18)]"
          : "mx-auto max-w-[36rem]",
      )}
    >
      {content.pieces.map((piece, index) => {
        const blocks = bodyBlocks(piece.body);
        // A piece standing alone that is a single paragraph — a quiet last
        // sentence, a short sketch — is set in the middle of its own space.
        const quiet = piece.alone && blocks.length === 1 && blocks[0]?.kind === "paragraph";
        const last = index === content.pieces.length - 1;
        const headline = piece.headline && (
          <h2
            className={cn(
              "text-balance font-bold",
              columns && !piece.alone ? "mb-3 text-[1.5rem] leading-[1.15]" : "mb-3 text-2xl leading-snug",
              piece.alone && "text-center",
            )}
          >
            {piece.headline}
          </h2>
        );
        const body = <PieceBody piece={piece} quiet={quiet} dropCap={!columns && !piece.alone && index === 0} />;

        if (piece.alone) {
          return (
            <section
              key={index}
              className={cn(
                "break-inside-avoid [column-span:all]",
                columns ? "border-t border-charcoal-900/60 pt-10" : "first:mt-4",
                columns ? (last ? "mb-2" : "mb-10") : last ? "mb-6 mt-16" : "my-16",
              )}
            >
              <div className="mx-auto max-w-[30rem]">
                {headline}
                {body}
              </div>
            </section>
          );
        }

        return (
          <section
            key={index}
            className={cn(
              "break-inside-avoid",
              columns ? "mb-10 border-t-2 border-charcoal-900/80 pt-4" : index > 0 && "mt-12",
            )}
          >
            {headline}
            {body}
          </section>
        );
      })}
    </div>
  );
}

function ShortRule() {
  return <div aria-hidden="true" className="mx-auto mt-8 w-16 border-t border-charcoal-900/40" />;
}

/** The headline, the line beneath it, and the pieces. Shared by an issue and its preview. */
function IssueBody({ content }: { content: IssueContent }) {
  return (
    <>
      <h1 className="mt-10 text-balance text-center text-[clamp(1.8rem,4.6vw,3rem)] font-bold leading-[1.1] tracking-[-0.01em]">
        {content.headline || "Untitled"}
      </h1>
      {content.standfirst && (
        <p className="mx-auto mt-4 max-w-2xl text-balance text-center text-lg italic leading-snug text-charcoal-700">
          {content.standfirst}
        </p>
      )}
      {/* Separate pieces carry their own rules; a story needs this one. */}
      {!(content.layout === "columns" && content.pieces.length > 1) && <ShortRule />}
      <Pieces content={content} />
    </>
  );
}

/**
 * The disclaimer at the foot, with a real correspondence address under the
 * joke: the first sentence is a letter to the editor's home. `editor` is null
 * when her address can't be found just now, and then it is plain words.
 */
function SmallPrint({ editor, number }: { editor?: string | null; number?: number | null }) {
  return (
    <p className="mt-12 border-t border-charcoal-900/70 pt-4 text-center text-[0.8rem] italic text-charcoal-700">
      {editor ? (
        <CorrectionsLink editor={editor} number={number} className={INK_LINK}>
          {MASTHEAD.corrections}
        </CorrectionsLink>
      ) : (
        MASTHEAD.corrections
      )}{" "}
      {MASTHEAD.unconvinced}
    </p>
  );
}

function IssueLink({ issue, direction }: { issue: Issue; direction: "previous" | "next" }) {
  const label = direction === "previous" ? `← No. ${issue.number}` : `No. ${issue.number} →`;
  return (
    <Link href={issuePath(issue.number)} className="group block max-w-[16rem]">
      <span className="block text-[0.7rem] uppercase tracking-[0.18em] text-charcoal-600">
        {direction === "previous" ? "Previous issue" : "Next issue"}
      </span>
      <span className="mt-1 block font-semibold underline decoration-charcoal-900/25 underline-offset-2 group-hover:decoration-charcoal-900">
        {label}
      </span>
      <span className="mt-0.5 block text-sm leading-snug text-charcoal-700">{issue.headline}</span>
    </Link>
  );
}

function IssueNav({ previous, next }: { previous: Issue | null; next: Issue | null }) {
  return (
    <nav
      aria-label="Other issues"
      className="mt-8 grid grid-cols-2 items-start gap-6 border-t border-charcoal-900/20 pt-6 sm:grid-cols-3"
    >
      <div>{previous && <IssueLink issue={previous} direction="previous" />}</div>
      <div className="order-last col-span-2 text-center sm:order-none sm:col-span-1">
        <Link href={IRREGULAR_PATH} className={cn(INK_LINK, "text-sm")}>
          Past issues
        </Link>
      </div>
      <div className="flex justify-end text-right">{next && <IssueLink issue={next} direction="next" />}</div>
    </nav>
  );
}

/** "Updated 14 November 2026: the third shoe was a slipper." */
function UpdatedNote({ updatedAt, correction }: { updatedAt: string | null | undefined; correction: string | undefined }) {
  if (!updatedAt) return null;
  return (
    <p className="mt-3 text-center text-[0.875rem] italic text-charcoal-800">
      Updated {longDate(updatedAt.slice(0, 10)).replace(/^[A-Za-z]+, /, "")}
      {correction ? `: ${correction}` : "."}
    </p>
  );
}

/**
 * One whole issue. `number` is null in a preview of a draft that will take
 * the next number, and `nextNumber` says which that is.
 */
export function IssueSheet({
  content,
  number,
  updatedAt,
  correction,
  previous = null,
  next = null,
  nav = true,
  editor = null,
}: {
  content: IssueContent;
  number: number | null;
  updatedAt?: string | null;
  correction?: string;
  previous?: Issue | null;
  next?: Issue | null;
  nav?: boolean;
  /** The editor's handle, for the corrections letter. */
  editor?: string | null;
}) {
  return (
    <PaperSheet>
      <Masthead left={number ? `No. ${number}` : "No. —"} middle={longDate(content.date)} />
      <UpdatedNote updatedAt={updatedAt} correction={correction} />
      <IssueBody content={content} />
      <SmallPrint editor={editor} number={number} />
      {nav && <IssueNav previous={previous} next={next} />}
    </PaperSheet>
  );
}

/** The page at a withdrawn issue's address. It keeps the number and says no more. */
export function WithdrawnSheet({
  number,
  previous,
  next,
  editor = null,
}: {
  number: number;
  previous: Issue | null;
  next: Issue | null;
  editor?: string | null;
}) {
  return (
    <PaperSheet>
      <Masthead left={`No. ${number}`} middle="Withdrawn" />
      <p className="mx-auto mt-14 max-w-md text-center text-lg italic leading-relaxed text-charcoal-700">
        This issue has been withdrawn by the editor.
      </p>
      <SmallPrint editor={editor} number={number} />
      <IssueNav previous={previous} next={next} />
    </PaperSheet>
  );
}

/** A small label in the archive, like a stamp on a file copy. */
function Label({ children }: { children: ReactNode }) {
  return (
    <span className="ml-2 inline-block border border-charcoal-900/55 px-1.5 py-px align-[0.12em] text-[0.62rem] font-semibold not-italic uppercase tracking-[0.14em] text-charcoal-800">
      {children}
    </span>
  );
}

/**
 * The archive: every issue, newest first.
 *
 * A withdrawn issue keeps its place by number and says only that it was
 * withdrawn, so a missing number explains itself. Its headline is never passed
 * in here: the archive is given the numbers and nothing else.
 */
export function ArchiveSheet({
  issues,
  withdrawn = [],
  editor = null,
}: {
  issues: Issue[];
  withdrawn?: number[];
  editor?: string | null;
}) {
  const rows = [
    ...issues.map((issue) => ({ number: issue.number, issue })),
    ...withdrawn.map((number) => ({ number, issue: null })),
  ].sort((a, b) => b.number - a.number);
  const latest = issues[0]?.number;

  return (
    <PaperSheet>
      <Masthead left="The archive" middle="Every issue, newest first" right={`${issues.length} ${issues.length === 1 ? "issue" : "issues"}`} />
      {rows.length === 0 ? (
        <p className="mx-auto mt-14 max-w-md text-center text-lg italic leading-relaxed text-charcoal-700">
          The first issue is still at the printer.
        </p>
      ) : (
        <ol className="mx-auto mt-8 max-w-[40rem]">
          {rows.map(({ number, issue }) => (
            <li key={number} className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-x-4 border-b border-charcoal-900/15 py-5">
              <span className="pt-1.5 text-[0.75rem] font-medium uppercase tracking-[0.16em] text-charcoal-700">No. {number}</span>
              {issue ? (
                <div>
                  <Link
                    href={issuePath(issue.number)}
                    className="text-balance text-xl font-semibold leading-snug decoration-charcoal-900/35 underline-offset-2 hover:underline md:text-[1.35rem]"
                  >
                    {issue.headline}
                  </Link>
                  <p className="mt-1 text-sm text-charcoal-700">
                    {longDate(issue.date)}
                    {issue.number === latest && <Label>Latest</Label>}
                    {issue.updatedAt && <Label>Updated</Label>}
                  </p>
                </div>
              ) : (
                <p className="pt-0.5 italic text-charcoal-600">Withdrawn by the editor.</p>
              )}
            </li>
          ))}
        </ol>
      )}
      <SmallPrint editor={editor} />
    </PaperSheet>
  );
}
