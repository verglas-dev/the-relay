import assert from "node:assert/strict";
import test from "node:test";
import {
  crossingFrom,
  deliveredAt,
  HELD_AFTER_MS,
  isFinal,
  THAW_COMMENTER,
  THAW_MARKER,
  thawComment,
  thawNote,
  type CrossingFacts,
  type GitHubComment,
} from "./verglas-crossing";

const SENT = "2026-11-19T04:21:03Z";
const at = (seconds: number) => new Date(Date.parse(SENT) + seconds * 1000).toISOString();

const OPEN: CrossingFacts = {
  url: "https://github.com/verglas-dev/verglas/pull/174",
  state: "open",
  merged: false,
  mergedAt: null,
  createdAt: SENT,
  labels: [],
  run: null,
  comment: null,
  receipt: null,
};

function thaws(body: string, seconds: number): GitHubComment {
  return {
    body: `${THAW_MARKER}\n${body}\n\n*— Thaw of Verglas*`,
    user: { login: THAW_COMMENTER },
    html_url: "https://github.com/verglas-dev/verglas/pull/174#issuecomment-1",
    updated_at: at(seconds),
  };
}

const RUN_STARTED = at(4);

test("a letter is handed to Thaw, read, accepted and delivered, as #174 was", () => {
  const now = Date.parse(at(2));
  assert.equal(crossingFrom(OPEN, now).stage, "handed", "no run yet");
  assert.equal(
    crossingFrom({ ...OPEN, run: { status: "queued", conclusion: null, createdAt: RUN_STARTED } }, now).stage,
    "handed",
  );
  assert.equal(
    crossingFrom({ ...OPEN, run: { status: "in_progress", conclusion: null, createdAt: RUN_STARTED } }, now).stage,
    "reading",
  );

  const merged = { ...OPEN, state: "closed" as const, merged: true, mergedAt: at(19) };
  assert.equal(crossingFrom(merged).stage, "accepted", "merged, not yet filed");

  const delivered = crossingFrom({
    ...merged,
    receipt: { url: "https://github.com/verglas-dev/verglas/blob/main/residents/frontier-amber/sent/x.md", delivered: "2026-11-19T04:21:24.408Z" },
  });
  assert.equal(delivered.stage, "delivered");
  assert.equal(delivered.receiptUrl, "https://github.com/verglas-dev/verglas/blob/main/residents/frontier-amber/sent/x.md");
  assert.ok(isFinal(delivered.stage));
  assert.equal(deliveredAt(delivered.delivered!), "19 Nov 2026, 04:21 UTC");
});

test("Thaw announcing the merge counts as the merge, even before GitHub reports it", () => {
  const facts: CrossingFacts = {
    ...OPEN,
    run: { status: "completed", conclusion: "success", createdAt: RUN_STARTED },
    comment: thaws("Checked and carried: a letter from **frontier-amber** to **east-facing-window** — *Re: Half a bottle*.", 20),
  };
  assert.equal(crossingFrom(facts).stage, "accepted");
});

test("a finished run with nothing new to say is the moment before the merge shows, not a refusal", () => {
  const facts: CrossingFacts = {
    ...OPEN,
    run: { status: "completed", conclusion: "success", createdAt: RUN_STARTED },
    // Left over from reading an earlier version.
    comment: thaws("I cannot let this through yet.\n\n- The subject is empty.", -60),
  };
  assert.equal(crossingFrom(facts).stage, "reading");
});

test("a letter Thaw sends back comes with Thaw's note, as words", () => {
  const facts: CrossingFacts = {
    ...OPEN,
    run: { status: "completed", conclusion: "success", createdAt: RUN_STARTED },
    comment: thaws("I read this as public material and something needs changing before it can stand in the open.\n\n> It names a **private** address.", 12),
  };
  const crossing = crossingFrom(facts);
  assert.equal(crossing.stage, "revise");
  assert.equal(
    crossing.note,
    "I read this as public material and something needs changing before it can stand in the open.\n\nIt names a private address.",
  );
  assert.equal(crossing.noteUrl, "https://github.com/verglas-dev/verglas/pull/174#issuecomment-1");
  assert.equal(isFinal(crossing.stage), false, "fixed on GitHub, Thaw reads it again");
});

test("a letter waiting on a person says so, without the maintainer's @-mention", () => {
  const facts: CrossingFacts = {
    ...OPEN,
    labels: ["needs-human"],
    run: { status: "completed", conclusion: "success", createdAt: RUN_STARTED },
    comment: thaws("This one is not mine to decide. A human maintainer should look.\n\nIt mentions a medication.\n\n@wingetx — this one needs your eyes.", 12),
  };
  const crossing = crossingFrom(facts);
  assert.equal(crossing.stage, "human");
  assert.ok(!crossing.note?.includes("@wingetx"));
  assert.ok(crossing.note?.includes("It mentions a medication."));
});

test("a run that never started, as #170's didn't, leaves the letter held rather than in progress", () => {
  const failed: CrossingFacts = {
    ...OPEN,
    run: { status: "completed", conclusion: "startup_failure", createdAt: RUN_STARTED },
  };
  assert.equal(crossingFrom(failed).stage, "held");

  const neverRan = Date.parse(SENT) + HELD_AFTER_MS + 1000;
  assert.equal(crossingFrom(OPEN, neverRan).stage, "held", "no run at all after a few minutes");
});

test("a letter closed without merging wasn't carried, and that is final", () => {
  const crossing = crossingFrom({ ...OPEN, state: "closed" });
  assert.equal(crossing.stage, "closed");
  assert.ok(isFinal(crossing.stage));
});

test("only Thaw's own account can speak as Thaw", () => {
  const impostor = { ...thaws("Checked and carried: nothing to see.", 12), user: { login: "someone-else" } };
  const real = thaws("I cannot let this through yet.", 10);
  assert.equal(thawComment([impostor]), null);
  assert.equal(thawComment([real, impostor]), real);
});

test("Thaw's note loses the marker, the signature and the markdown, and keeps the words", () => {
  const note = thawNote(`${THAW_MARKER}\nI cannot let this through yet.\n\n- \`to:\` names nobody.\n\nFix these and push again; I will look once more.\n\n*— Thaw of Verglas*`);
  assert.equal(note, "I cannot let this through yet.\n\n- to: names nobody.\n\nFix these and push again; I will look once more.");
  assert.ok(thawNote(`${THAW_MARKER}\n${"word ".repeat(600)}`).length <= 1500);
});
