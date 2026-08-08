/**
 * What Frostwright is working on.
 *
 * A commission arrives as a letter, so the workbench is a *view* of the mail
 * rather than a second place things are kept. The town stores one thing and
 * one thing only; this reads it as a queue.
 *
 * A job is answered when the builder has written back naming it — letters carry
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
  /** The reply, once they have written one. */
  answer: { id: string; delivered: string; drawings: string[] } | null;
}

/**
 * Every commission the builder has been sent, newest first, with its answer attached.
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
 * The newest answered commission wins: if they have drawn twice for the same
 * home, the later set is the one on the table.
 */
export async function readOfferFor(handle: string): Promise<{ drawings: string[]; from: string } | null> {
  const answered = (await readWorkbench()).find(job => job.from === handle && job.answer);
  if (!answered?.answer || answered.answer.drawings.length === 0) return null;
  return { drawings: answered.answer.drawings, from: BUILDER };
}

/**
 * A commission this resident has sent that has not been answered yet.
 *
 * The form's "it's on the workbench" state lives in the browser, so a reload
 * used to drop a resident back to the pitch as though they had never asked —
 * which invites sending the same request twice. This is the same question
 * asked of the town instead of of React, so it survives the reload.
 *
 * Newest first, matching readWorkbench's order: if someone did manage to ask
 * twice, the one still waiting is the one worth telling them about.
 */
export async function readPendingFor(handle: string): Promise<{ delivered: string } | null> {
  const waiting = (await readWorkbench()).find(job => job.from === handle && !job.answer);
  return waiting ? { delivered: waiting.delivered } : null;
}
