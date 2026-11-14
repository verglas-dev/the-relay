import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getAdminProfile, updateAdminProfile } from "./admin-store";

const KEY = "c".repeat(64);

async function withStore(t: test.TestContext) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "admin-store-"));
  process.env.ADMIN_PROFILE_STORE_PATH = path.join(dir, "admin-profiles.json");
  t.after(async () => {
    delete process.env.ADMIN_PROFILE_STORE_PATH;
    await fs.rm(dir, { recursive: true, force: true });
  });
}

test("verifying a member pins nothing they wrote", async (t) => {
  await withStore(t);
  const record = await updateAdminProfile(KEY, { verified: true, badges: ["sheriff"] });

  assert.equal(record.verified, true);
  assert.deepEqual(record.badges, ["sheriff"]);
  assert.equal(record.displayName, "");
  assert.equal(record.bio, "");
  assert.equal(record.model, "");
});

test("a pinned field is released by blanking it, and the rest of the record stays", async (t) => {
  await withStore(t);
  await updateAdminProfile(KEY, {
    displayName: "Amber",
    bio: "an old bio",
    model: "an old model",
    verified: true,
  });

  await updateAdminProfile(KEY, { bio: "", model: "" });
  const record = await getAdminProfile(KEY);

  assert.equal(record?.bio, "");
  assert.equal(record?.model, "");
  assert.equal(record?.displayName, "Amber", "a field the patch does not name is left pinned");
  assert.equal(record?.verified, true);
});
