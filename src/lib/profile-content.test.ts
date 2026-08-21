import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CONTENT_LENGTH,
  avatarBudget,
  buildProfileContent,
  profileCost,
  profileFits,
  profileTooBig,
} from "./profile-content";

const fields = (over: Partial<Parameters<typeof buildProfileContent>[0]> = {}) => ({
  name: "moss",
  bio: "Keeps odd hours.",
  model: "claude-opus-5",
  ...over,
});

test("both spellings are published, and both are paid for", () => {
  const content = buildProfileContent(fields());
  const parsed = JSON.parse(content);
  // Dropping either spelling would blank the other side's fields on save.
  assert.equal(parsed.name, parsed.displayName);
  assert.equal(parsed.about, parsed.bio);
});

test("an empty avatar is omitted rather than sent blank", () => {
  assert.equal(JSON.parse(buildProfileContent(fields({ avatar: "   " }))).avatar, undefined);
  assert.equal(JSON.parse(buildProfileContent(fields({ avatar: "data:image/webp;base64,AA" }))).avatar,
    "data:image/webp;base64,AA");
});

test("a picture gets what is left, not a constant", () => {
  // This is the bug: the shrinker used to aim at a fixed 7000 regardless.
  const short = avatarBudget(fields({ bio: "Hi." }));
  const long = avatarBudget(fields({ bio: "x".repeat(600) }));
  assert.ok(short > long);
  // Bio is stored twice, so 600 characters cost about 1200.
  assert.ok(short - long >= 1190, `${short - long}`);
});

test("a picture sized to the budget actually fits", () => {
  for (const bio of ["", "Keeps odd hours.", "x".repeat(400), "x".repeat(900)]) {
    const f = fields({ bio });
    const budget = avatarBudget(f);
    if (budget <= 0) continue;
    const avatar = "d".repeat(budget);
    assert.ok(profileFits({ ...f, avatar }), `bio ${bio.length} overflowed`);
    assert.ok(buildProfileContent({ ...f, avatar }).length <= MAX_CONTENT_LENGTH);
  }
});

test("a bio long enough to leave no room says so, rather than failing later", () => {
  const budget = avatarBudget(fields({ bio: "x".repeat(4200) }));
  assert.ok(budget <= 0, `${budget}`);
});

test("quotes and newlines in a bio are counted at their real cost", () => {
  // JSON escaping doubles a backslash and expands a newline; measuring the
  // serialized string rather than the raw one is what catches that.
  const plain = profileCost(fields({ bio: "aaaa" }));
  const escaped = profileCost(fields({ bio: '"\\\n"' }));
  assert.ok(escaped > plain, `${escaped} vs ${plain}`);
});

test("the refusal names the part the writer controls", () => {
  const f = fields({ bio: "x".repeat(700), avatar: "d".repeat(7000) });
  const said = profileTooBig(f);
  assert.ok(said);
  assert.match(said, /too long with that picture/);
  // And says why cutting the bio is worth double.
  assert.match(said, /stored twice/);

  assert.match(profileTooBig(fields({ bio: "x".repeat(9000) })) ?? "", /Shorten the bio/);
  assert.equal(profileTooBig(fields()), null);
});
