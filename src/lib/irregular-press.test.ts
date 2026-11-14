import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as ed from "@noble/ed25519";
import { bytesToHex } from "@noble/hashes/utils";
import { signPress, verifyPress } from "./irregular-auth";
import { press } from "./irregular-press";
import { latestIssue, publishedIssues, readIssue, withdrawnNumbers } from "./irregular-store";

function keypair() {
  const priv = ed.utils.randomPrivateKey();
  return { priv: bytesToHex(priv), pub: bytesToHex(ed.getPublicKey(priv)) };
}

const EDITOR = keypair();
const STRANGER = keypair();

async function withPaper(t: test.TestContext) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "irregular-"));
  const file = path.join(dir, "irregular.json");
  process.env.IRREGULAR_STORE_PATH = file;
  process.env.VERGLAS_EDITOR_KEY = EDITOR.pub;
  t.after(async () => {
    delete process.env.IRREGULAR_STORE_PATH;
    delete process.env.VERGLAS_EDITOR_KEY;
    await fs.rm(dir, { recursive: true, force: true });
  });
  return file;
}

async function as(who: { priv: string; pub: string }, request: Record<string, unknown>) {
  // As the desk does: a nonce, so identical requests are still separate requests.
  const signed = signPress(who.priv, who.pub, JSON.stringify({ ...request, nonce: Math.random().toString(36) }));
  return press(JSON.stringify(signed));
}

const STORY = {
  headline: "Two Men, Three Shoes, and a Troubling Amount of Tea",
  standfirst: "",
  date: "2026-11-13",
  layout: "story",
  pieces: [{ headline: "", body: "It began with a kettle.", alone: false }],
};

async function draftAndPrint(content = STORY, number: number | null = null) {
  const saved = await as(EDITOR, { action: "draft.save", number, content });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const draft = saved.body.draft as { id: string; updatedAt: string };
  const printed = await as(EDITOR, { action: "publish", id: draft.id, revision: draft.updatedAt });
  assert.equal(printed.status, 200, JSON.stringify(printed.body));
  return printed.body as { issue: { number: number; updatedAt: string | null; publishedAt: string }; url: string };
}

test("a signature covers the exact request, not just who sent it", () => {
  const signed = signPress(EDITOR.priv, EDITOR.pub, JSON.stringify({ action: "desk" }));
  assert.equal(verifyPress(signed), null);
  assert.notEqual(verifyPress({ ...signed, payload: JSON.stringify({ action: "issue.withdraw", number: 1 }) }), null);
  assert.notEqual(verifyPress({ ...signed, pubkey: STRANGER.pub }), null);
  assert.notEqual(verifyPress(signed, (signed.at + 301) * 1000), null, "stale");
});

test("the press refuses everyone when no editor is configured", async (t) => {
  await withPaper(t);
  delete process.env.VERGLAS_EDITOR_KEY;
  const answer = await as(EDITOR, { action: "desk" });
  assert.equal(answer.status, 503);
});

test("a validly signed request from anyone but the editor is refused, for every action", async (t) => {
  await withPaper(t);
  const { issue } = await draftAndPrint();

  for (const request of [
    { action: "desk" },
    { action: "draft.save", number: null, content: STORY },
    { action: "issue.open", number: issue.number },
    { action: "issue.withdraw", number: issue.number },
    { action: "issue.correct", number: issue.number, revision: issue.publishedAt, content: STORY, note: "" },
  ]) {
    const answer = await as(STRANGER, request);
    assert.equal(answer.status, 403, request.action);
  }
  assert.equal((await latestIssue())?.number, issue.number, "nothing the stranger asked for happened");
});

test("drafts stay off the public paper until printed, and printing makes a fixed copy", async (t) => {
  await withPaper(t);
  const saved = await as(EDITOR, { action: "draft.save", number: 17, content: STORY });
  const draft = saved.body.draft as { id: string; updatedAt: string };
  assert.deepEqual(await publishedIssues(), [], "a draft is not an issue");

  const printed = await as(EDITOR, { action: "publish", id: draft.id, revision: draft.updatedAt });
  assert.equal(printed.status, 200);
  assert.equal(printed.body.url, "https://verglas.town/irregular/17");

  const desk = await as(EDITOR, { action: "desk" });
  assert.deepEqual(desk.body.drafts, [], "the draft became the issue");
  assert.equal(desk.body.nextNumber, 18);
  assert.equal((await latestIssue())?.headline, STORY.headline);
});

test("only a draft as it was last seen can be printed", async (t) => {
  await withPaper(t);
  const saved = await as(EDITOR, { action: "draft.save", number: null, content: STORY });
  const draft = saved.body.draft as { id: string; updatedAt: string };
  // A daemon changes the draft after the editor previewed it.
  await as(EDITOR, { action: "draft.save", id: draft.id, revision: draft.updatedAt, number: null, content: { ...STORY, headline: "Something else" } });

  const stale = await as(EDITOR, { action: "publish", id: draft.id, revision: draft.updatedAt });
  assert.equal(stale.status, 409);
  assert.equal(await latestIssue(), null);
});

test("a refused print leaves the paper exactly as it was", async (t) => {
  const file = await withPaper(t);
  await draftAndPrint(STORY, 1);
  const before = await fs.readFile(file, "utf8");

  const unfinished = await as(EDITOR, { action: "draft.save", number: null, content: { ...STORY, headline: "" } });
  const draft = unfinished.body.draft as { id: string; updatedAt: string };
  const midway = await fs.readFile(file, "utf8");
  const refused = await as(EDITOR, { action: "publish", id: draft.id, revision: draft.updatedAt });
  assert.equal(refused.status, 422);
  assert.ok((refused.body.problems as string[]).includes("The issue needs a headline."));
  assert.equal(await fs.readFile(file, "utf8"), midway, "nothing was written");
  assert.notEqual(before, midway, "(the draft itself was saved)");
  assert.equal((await publishedIssues()).length, 1);
});

test("a number already printed cannot be printed again", async (t) => {
  await withPaper(t);
  await draftAndPrint(STORY, 5);
  const clash = await as(EDITOR, { action: "draft.save", number: 5, content: STORY });
  assert.equal(clash.status, 409);
});

test("a correction keeps the address and says it was updated", async (t) => {
  await withPaper(t);
  const { issue } = await draftAndPrint(STORY, 3);
  const corrected = await as(EDITOR, {
    action: "issue.correct",
    number: 3,
    revision: issue.publishedAt,
    content: { ...STORY, pieces: [{ headline: "", body: "It began with a teapot.", alone: false }] },
    note: "It was a teapot.",
  });
  assert.equal(corrected.status, 200, JSON.stringify(corrected.body));
  assert.equal(corrected.body.url, "https://verglas.town/irregular/3");

  const found = await readIssue(3);
  assert.equal(found?.issue.pieces[0].body, "It began with a teapot.");
  assert.equal(found?.issue.correction, "It was a teapot.");
  assert.ok(found?.issue.updatedAt);

  // A second window still holding the first revision cannot overwrite it.
  const stale = await as(EDITOR, { action: "issue.correct", number: 3, revision: issue.publishedAt, content: STORY, note: "" });
  assert.equal(stale.status, 409);
});

test("a withdrawn issue leaves the archive and the gate, keeps its number, and can come back", async (t) => {
  await withPaper(t);
  await draftAndPrint(STORY, 1);
  await draftAndPrint({ ...STORY, headline: "The Trousers, Part Two" }, 2);
  await draftAndPrint({ ...STORY, headline: "The Trousers, Concluded" }, 3);

  assert.equal((await as(EDITOR, { action: "issue.withdraw", number: 3 })).status, 200);
  assert.equal((await latestIssue())?.number, 2, "the gate falls back to the newest issue on display");
  assert.deepEqual((await publishedIssues()).map((i) => i.number), [2, 1]);
  assert.deepEqual(await withdrawnNumbers(), [3], "the archive can account for the gap, by number only");

  const withdrawn = await readIssue(3);
  assert.ok(withdrawn?.issue.withdrawnAt, "the address still answers, as withdrawn");
  assert.equal((await readIssue(2))?.next, null, "next/previous skip what is withdrawn");

  const reuse = await as(EDITOR, { action: "draft.save", number: 3, content: STORY });
  assert.equal(reuse.status, 409, "the number stays reserved");

  assert.equal((await as(EDITOR, { action: "issue.restore", number: 3 })).status, 200);
  assert.equal((await latestIssue())?.number, 3);
});

test("the same signed change is carried out once", async (t) => {
  await withPaper(t);
  await draftAndPrint(STORY, 1);
  const signed = JSON.stringify(signPress(EDITOR.priv, EDITOR.pub, JSON.stringify({ action: "issue.withdraw", number: 1 })));
  assert.equal((await press(signed)).status, 200);
  assert.equal((await as(EDITOR, { action: "issue.restore", number: 1 })).status, 200);
  assert.equal((await press(signed)).status, 409, "a copied withdrawal cannot be replayed");
  assert.equal((await latestIssue())?.number, 1);
});

test("a damaged paper store is reported rather than read as empty and overwritten", async (t) => {
  const file = await withPaper(t);
  await fs.writeFile(file, "{ not json");
  await assert.rejects(publishedIssues());
  await assert.rejects(as(EDITOR, { action: "draft.save", number: null, content: STORY }));
  assert.equal(await fs.readFile(file, "utf8"), "{ not json");
});
