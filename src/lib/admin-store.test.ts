import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getAdminProfile, updateAdminProfile } from "./admin-store";

const KEY = "c".repeat(64);

async function withStore(t: test.TestContext, contents?: unknown) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "admin-store-"));
  const file = path.join(dir, "admin-profiles.json");
  if (contents) await fs.writeFile(file, JSON.stringify(contents));
  process.env.ADMIN_PROFILE_STORE_PATH = file;
  t.after(async () => {
    delete process.env.ADMIN_PROFILE_STORE_PATH;
    await fs.rm(dir, { recursive: true, force: true });
  });
}

test("verifying a member writes nothing of theirs and is not an edit", async (t) => {
  await withStore(t);
  const record = await updateAdminProfile(KEY, { verified: true, badges: ["sheriff"] });

  assert.equal(record.verified, true);
  assert.deepEqual(record.badges, ["sheriff"]);
  assert.equal(record.displayName, "");
  assert.equal(record.bio, "");
  assert.equal(record.model, "");
  assert.equal(record.editedAt, undefined);
});

test("an edit is dated when the words change, and verifying later does not move it", async (t) => {
  await withStore(t);
  const edited = await updateAdminProfile(KEY, { displayName: "Amber", bio: "a bio written for her" });
  assert.ok(edited.editedAt);

  await new Promise((resolve) => setTimeout(resolve, 5));
  const verified = await updateAdminProfile(KEY, { verified: true, bio: "a bio written for her" });
  assert.equal(verified.editedAt, edited.editedAt, "the same bio sent again is not a new edit");
  assert.notEqual(verified.updatedAt, edited.updatedAt);
});

test("an edit is withdrawn by blanking it, and the rest of the record stays", async (t) => {
  await withStore(t);
  await updateAdminProfile(KEY, { displayName: "Amber", bio: "an old bio", model: "an old model", verified: true });

  await updateAdminProfile(KEY, { bio: "", model: "" });
  const record = await getAdminProfile(KEY);

  assert.equal(record?.bio, "");
  assert.equal(record?.model, "");
  assert.equal(record?.displayName, "Amber", "a field the patch does not name is left as it was");
  assert.equal(record?.verified, true);
});

test("a record from before edits were dated keeps its last save as its date", async (t) => {
  const saved = "2026-08-01T00:00:00.000Z";
  await withStore(t, {
    profiles: {
      [KEY]: {
        pubkey: KEY,
        displayName: "Amber",
        bio: "copied in when she was verified",
        model: "deepseek-pro-v4",
        verified: true,
        badges: [],
        deleted: false,
        themeDisabled: false,
        createdAt: saved,
        updatedAt: saved,
      },
    },
  });

  assert.equal((await getAdminProfile(KEY))?.editedAt, saved);
  const badged = await updateAdminProfile(KEY, { badges: ["sheriff"] });
  assert.equal(badged.editedAt, saved, "a badge does not make the old copy newer than her own edits");
});
