/**
 * What Frostwright is working on.
 *
 * A commission arrives as a letter, so the workbench is a *view* of the mail
 * rather than a second place things are kept. The town stores one thing and
 * one thing only; this reads it as a queue.
 *
 * A job is answered when he has written back naming it — letters carry
 * `reply_to`, so the town already records the link between a request and its
 * answer without anything new being invented for it.
 *
 * Server-side: reads the town.
 */

import { BUILDER, isCommission, parseCommission, parseDrawings, type CommissionDraft } from "@/lib/verglas-commission";
import { readCrossings, readLetter, type Letter } from "@/lib/verglas-town";

export interface Commission {
  id: string;
  /** Who asked. */
  from: string;
  delivered: string;
  request: CommissionDraft;
  /** The reply, once he has written one. */
  answer: { id: string; delivered: string; drawings: string[] } | null;
}

/**
 * Every commission he has been sent, newest first, with its answer attached.
 *
 * One fetch for the ledger, then one per letter that matters. The town is
 * small and each read is cached; if it ever stops being small, the ledger is
 * the natural place to carry a little more so this reads less.
 */
export async function readWorkbench(): Promise<Commission[]> {
  const crossings = await readCrossings();

  const requests = crossings.filter(
    letter => letter.to === BUILDER && isCommission(letter.subject) && letter.path,
  );
  const replies = crossings.filter(letter => letter.from === BUILDER && letter.path);

  const [requestLetters, replyLetters] = await Promise.all([
    Promise.all(requests.map(letter => readLetter(letter.path))),
    Promise.all(replies.map(letter => readLetter(letter.path))),
  ]);

  const answers = new Map<string, Letter>();
  for (const reply of replyLetters) {
    if (!reply) continue;
    // `reply_to` is a front-matter field the town already validates.
    if (reply.replyTo) answers.set(reply.replyTo, reply);
  }

  return requestLetters
    .filter((letter): letter is Letter => letter !== null)
    .map(letter => {
      const reply = answers.get(letter.id) ?? null;
      return {
        id: letter.id,
        from: letter.from,
        delivered: letter.delivered,
        request: parseCommission(letter.body),
        answer: reply
          ? { id: reply.id, delivered: reply.delivered, drawings: parseDrawings(reply.body) }
          : null,
      };
    })
    .sort((a, b) => b.delivered.localeCompare(a.delivered));
}

/**
 * The drawings currently offered to one resident, if any.
 *
 * The newest answered commission wins: if he has drawn twice for the same
 * home, the later set is the one on the table.
 */
export async function readOfferFor(handle: string): Promise<{ drawings: string[]; from: string } | null> {
  const answered = (await readWorkbench()).find(job => job.from === handle && job.answer);
  if (!answered?.answer || answered.answer.drawings.length === 0) return null;
  return { drawings: answered.answer.drawings, from: BUILDER };
}
