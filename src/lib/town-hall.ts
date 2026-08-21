import { promises as fs } from "fs";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import path from "path";
import {
  type Account,
  emailKey as toEmailKey,
  hashPassphrase,
  newAccountId,
  verifyPassphrase,
} from "@/lib/human-account";
import {
  type Establishment,
  type EstablishmentDraft,
  normalizeEstablishment,
} from "@/lib/establishment";
import { type BellConfig } from "@/lib/bell";
import type { BuiltRoom } from "@/lib/room-builder";
import type { Presence } from "@/lib/establishment-hours";
import {
  type Ring,
  ringAnswerable,
} from "@/lib/ring";
import {
  type Permit,
  DEFAULT_TTL_HOURS,
  expiryFromNow,
  mintPermitCode,
  permitHash,
  permitRedeemable,
} from "@/lib/establishment-permit";

/**
 * The town hall: the register of permits, the humans who hold them, and the
 * establishments they were spent on.
 *
 * **One file, deliberately.** The vault and the rooms each get their own shelf
 * because they are independent things. These three are not: opening an
 * establishment burns a permit and writes a property in the same breath, and
 * that has to be one act or it is a race. Two tabs, two stores, two write
 * chains, and both submissions see a permit that is still good — one permit,
 * two offices. Keeping them in a single file behind a single chain makes that
 * impossible by construction rather than by hoping the second write loses.
 *
 * Same discipline as `room-store.ts` otherwise: read whole, write beside
 * itself, rename into place, and serialise every write through one promise.
 *
 * Not the town repository. `verglas-dev/verglas` is public and residents write
 * to it with their own GitHub tokens; a keeper has neither a token nor any
 * business committing to it. The town keeps its own register.
 */

interface TownHallFile {
  accounts: Record<string, Account>;
  permits: Record<string, Permit>;
  establishments: Record<string, Establishment>;
  rings: Record<string, Ring>;
}

const EMPTY: TownHallFile = { accounts: {}, permits: {}, establishments: {}, rings: {} };

let writeChain: Promise<void> = Promise.resolve();

function storePath(): string {
  const fromEnv = process.env.TOWN_HALL_STORE_PATH?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.join(/* turbopackIgnore: true */ process.cwd(), fromEnv);
  }
  return path.join(process.cwd(), "data", "town-hall.json");
}

async function readFile(): Promise<TownHallFile> {
  const file = storePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as Partial<TownHallFile>;
    return {
      accounts: parsed.accounts ?? {},
      permits: parsed.permits ?? {},
      establishments: parsed.establishments ?? {},
      rings: parsed.rings ?? {},
    };
  } catch {
    return { accounts: {}, permits: {}, establishments: {}, rings: {} };
  }
}

async function writeFile(data: TownHallFile): Promise<void> {
  const file = storePath();
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(temp, file);
}

async function withWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn);
  writeChain = run.then(() => undefined, () => undefined);
  return run;
}

/** Every answer this module gives to a request that can be refused. */
export type Refusal = { ok: false; error: string; field?: string };
export type Result<T> = ({ ok: true } & T) | Refusal;

const no = (error: string, field?: string): Refusal => ({ ok: false, error, field });

/* ── Issuing ───────────────────────────────────────────────────────────── */

/**
 * Write a permit.
 *
 * The code is returned exactly once, here, and then only its hash survives.
 * There is no "show me that permit again" — if it is lost before it reaches
 * the person, issue another and let this one lapse.
 */
export async function issuePermit(options: {
  note?: string;
  /** Hours. `null` for a permit that never lapses; omitted for the default. */
  ttlHours?: number | null;
}): Promise<{ permit: Permit; code: string }> {
  return withWrite(async () => {
    const store = await readFile();

    const code = mintPermitCode();
    const hash = permitHash(code);
    // Unreachable: the mint produces canonical codes. Kept because a silent
    // null here would store a permit nothing could ever redeem.
    if (!hash) throw new Error("The town could not print that permit.");

    const permit: Permit = {
      // Independent randomness, not a slice of the hash. An id derived from
      // the digest would put most of it in the admin listing, and a permit
      // code is only forty bits — enough of the hash in the open turns an
      // online guessing problem into an offline one.
      id: `permit_${randomUUID()}`,
      hash,
      note: (options.note ?? "").trim().slice(0, 300),
      issuedAt: new Date().toISOString(),
      expiresAt: expiryFromNow(
        options.ttlHours === undefined ? DEFAULT_TTL_HOURS : options.ttlHours,
      ),
      boundTo: null,
      boundAt: null,
      spentOn: null,
      spentAt: null,
    };

    store.permits[permit.id] = permit;
    await writeFile(store);
    return { permit, code };
  });
}

export async function listPermits(): Promise<Permit[]> {
  const store = await readFile();
  return Object.values(store.permits).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
}

function findByCode(store: TownHallFile, code: string): Permit | null {
  const hash = permitHash(code);
  if (!hash) return null;
  return Object.values(store.permits).find((permit) => permit.hash === hash) ?? null;
}

/**
 * Revoke a permit that has not been spent.
 *
 * Binding is not spending, so a permit sitting on an account can still be
 * withdrawn. A spent one cannot: it is holding an establishment up.
 */
export async function revokePermit(id: string): Promise<{ ok: true } | Refusal> {
  return withWrite(async () => {
    const store = await readFile();
    const permit = store.permits[id];
    if (!permit) return no("No such permit.");
    if (permit.spentOn) return no("That permit has already been spent on an establishment.");
    delete store.permits[id];
    await writeFile(store);
    return { ok: true as const };
  });
}

/* ── Keepers ───────────────────────────────────────────────────────────── */

/**
 * Open an account and bind a permit to it, in one act.
 *
 * The permit is required *here*, at registration, rather than only at the
 * establishment form. Otherwise account creation is an open faucet — the exact
 * thing the permit exists to avoid — and a rate limit is all that stands in
 * front of it. Requiring the code up front means the only people who can hold
 * an account are people the town handed something to.
 *
 * Binding is not spending. The code dies at the establishment; until then it
 * sits on the account, and its expiry has already done its work.
 */
export async function registerKeeper(params: {
  email: string;
  emailKey: string;
  passphrase: string;
  code: string;
}): Promise<Result<{ account: Account }>> {
  return withWrite(async () => {
    const store = await readFile();

    const permit = findByCode(store, params.code);
    // One refusal for every way a code can fail, so this endpoint cannot be
    // used to sort real permits from invented ones.
    if (!permit || !permitRedeemable(permit)) {
      return no("That permit is not valid. Check the code, or ask the town for a new one.", "code");
    }

    const taken = Object.values(store.accounts).some((account) => account.emailKey === params.emailKey);
    if (taken) return no("There is already an account with that address.", "email");

    const account: Account = {
      id: newAccountId(),
      email: params.email,
      emailKey: params.emailKey,
      passphrase: hashPassphrase(params.passphrase),
      sessionEpoch: 1,
      createdAt: new Date().toISOString(),
    };

    store.accounts[account.id] = account;
    store.permits[permit.id] = {
      ...permit,
      boundTo: account.id,
      boundAt: new Date().toISOString(),
    };

    await writeFile(store);
    return { ok: true as const, account };
  });
}

/** Bind a further permit to an account that already exists — a second property. */
export async function bindPermit(params: {
  accountId: string;
  code: string;
}): Promise<Result<{ permit: Permit }>> {
  return withWrite(async () => {
    const store = await readFile();
    if (!store.accounts[params.accountId]) return no("Sign in first.");

    const permit = findByCode(store, params.code);
    if (!permit || !permitRedeemable(permit)) {
      return no("That permit is not valid. Check the code, or ask the town for a new one.", "code");
    }

    const bound: Permit = {
      ...permit,
      boundTo: params.accountId,
      boundAt: new Date().toISOString(),
    };
    store.permits[permit.id] = bound;
    await writeFile(store);
    return { ok: true as const, permit: bound };
  });
}

export async function accountById(id: string): Promise<Account | null> {
  const store = await readFile();
  return store.accounts[id] ?? null;
}

/**
 * Check a sign-in.
 *
 * Same refusal whether the address is unknown or the passphrase is wrong, and
 * a hash is computed either way — an endpoint that answers faster for an
 * address nobody holds is an endpoint that lists the town's keepers.
 */
const ABSENT_HASH = hashPassphrase(`absent:${Math.random()}`);

export async function signIn(params: {
  emailKey: string;
  passphrase: string;
}): Promise<Result<{ account: Account }>> {
  const store = await readFile();
  const account = Object.values(store.accounts).find((entry) => entry.emailKey === params.emailKey);

  const good = verifyPassphrase(params.passphrase, account?.passphrase ?? ABSENT_HASH);
  if (!account || !good) return no("That address and passphrase do not match.");

  return { ok: true as const, account };
}

/** Change the passphrase and invalidate every cookie already out there. */
export async function changePassphrase(params: {
  accountId: string;
  current: string;
  next: string;
}): Promise<Result<{ account: Account }>> {
  return withWrite(async () => {
    const store = await readFile();
    const account = store.accounts[params.accountId];
    if (!account) return no("Sign in first.");
    if (!verifyPassphrase(params.current, account.passphrase)) {
      return no("That is not your current passphrase.", "current");
    }

    const updated: Account = {
      ...account,
      passphrase: hashPassphrase(params.next),
      sessionEpoch: account.sessionEpoch + 1,
    };
    store.accounts[account.id] = updated;
    await writeFile(store);
    return { ok: true as const, account: updated };
  });
}

/* ── Establishments ────────────────────────────────────────────────────── */

/** The permits this account holds that are bound and not yet spent. */
export async function unspentPermits(accountId: string): Promise<Permit[]> {
  const store = await readFile();
  return Object.values(store.permits).filter(
    (permit) => permit.boundTo === accountId && !permit.spentOn,
  );
}

/**
 * Open an establishment, spending one permit.
 *
 * The whole invariant lives in this function: **an account holds exactly as
 * many establishments as it has spent permits.** There is no separate
 * per-account cap to keep in step with it, and no exception path for a second
 * property — a second property is a second permit, which is the same rule
 * running twice.
 *
 * Find, check, create, and burn all happen inside one turn of the write chain,
 * so a permit cannot be spent twice however many submissions arrive at once.
 */
export async function openEstablishment(params: {
  accountId: string;
  draft: EstablishmentDraft;
}): Promise<Result<{ establishment: Establishment }>> {
  return withWrite(async () => {
    const store = await readFile();
    const account = store.accounts[params.accountId];
    if (!account) return no("Sign in first.");

    const permit = Object.values(store.permits).find(
      (entry) => entry.boundTo === account.id && !entry.spentOn,
    );
    if (!permit) {
      return no(
        "You have no permit left to spend. The town issues one permit per establishment.",
        "code",
      );
    }

    const draft = normalizeEstablishment(params.draft);
    if (store.establishments[draft.slug]) {
      return no("There is already a place at that address. Choose another.", "slug");
    }

    const now = new Date().toISOString();
    const establishment: Establishment = {
      ...draft,
      accountId: account.id,
      permitId: permit.id,
      // A new place follows its own schedule and has no bell wired up yet.
      // Both are set afterwards, from inside the keeper's own page.
      presence: "auto",
      presenceUntil: null,
      bell: null,
      room: null,
      roomDraft: null,
      openedAt: now,
      updatedAt: now,
    };

    store.establishments[establishment.slug] = establishment;
    store.permits[permit.id] = { ...permit, spentOn: establishment.slug, spentAt: now };

    await writeFile(store);
    return { ok: true as const, establishment };
  });
}

/** Rewrite a place you keep. The permit is already spent; this costs nothing. */
export async function reviseEstablishment(params: {
  accountId: string;
  slug: string;
  draft: EstablishmentDraft;
}): Promise<Result<{ establishment: Establishment }>> {
  return withWrite(async () => {
    const store = await readFile();
    const existing = store.establishments[params.slug];
    if (!existing) return no("There is no such place.");
    if (existing.accountId !== params.accountId) return no("That is not your establishment.");

    const draft = normalizeEstablishment(params.draft);
    // The address is the permit's anchor and other pages link to it. Renaming
    // a place is fine; moving it is a new establishment.
    const updated: Establishment = {
      ...existing,
      ...draft,
      slug: existing.slug,
      updatedAt: new Date().toISOString(),
    };

    store.establishments[existing.slug] = updated;
    await writeFile(store);
    return { ok: true as const, establishment: updated };
  });
}

export async function getEstablishment(slug: string): Promise<Establishment | null> {
  const store = await readFile();
  return store.establishments[slug.trim().toLowerCase()] ?? null;
}

export async function listEstablishments(): Promise<Establishment[]> {
  const store = await readFile();
  return Object.values(store.establishments).sort((a, b) => a.openedAt.localeCompare(b.openedAt));
}

export async function establishmentsFor(accountId: string): Promise<Establishment[]> {
  return (await listEstablishments()).filter((entry) => entry.accountId === accountId);
}


/* ── The doorbell ──────────────────────────────────────────────────────── */

/**
 * How many rings one door keeps.
 *
 * Enough for a keeper to see who has been by lately, and a hard stop on a
 * file that would otherwise grow forever. A ring holds no conversation, so
 * the oldest ones are worth nothing once they scroll off.
 */
const RINGS_KEPT = 50;

/** Pull the bell. The record is written before anything is sent anywhere. */
export async function recordRing(params: {
  slug: string;
  pubkey: string;
  handle: string | null;
}): Promise<Result<{ ring: Ring }>> {
  return withWrite(async () => {
    const store = await readFile();
    const place = store.establishments[params.slug];
    if (!place) return no("There is no door there.");

    const ring: Ring = {
      id: randomUUID(),
      slug: place.slug,
      pubkey: params.pubkey.toLowerCase(),
      handle: params.handle,
      rungAt: new Date().toISOString(),
      state: "waiting",
      answeredAt: null,
      // 32 bytes: this travels in a notification action and is the only thing
      // standing between a lock screen and somebody else's door.
      answerKey: randomBytes(32).toString("hex"),
      delivered: false,
    };

    store.rings[ring.id] = ring;

    // Trim this door's history, oldest first.
    const mine = Object.values(store.rings)
      .filter((entry) => entry.slug === place.slug)
      .sort((a, b) => b.rungAt.localeCompare(a.rungAt));
    for (const stale of mine.slice(RINGS_KEPT)) delete store.rings[stale.id];

    await writeFile(store);
    return { ok: true as const, ring };
  });
}

export async function getRing(id: string): Promise<Ring | null> {
  const store = await readFile();
  return store.rings[id] ?? null;
}

/** Note whether the phone actually received it. */
export async function markRingDelivered(id: string, delivered: boolean): Promise<void> {
  return withWrite(async () => {
    const store = await readFile();
    const ring = store.rings[id];
    if (!ring) return;
    store.rings[id] = { ...ring, delivered };
    await writeFile(store);
  });
}

/**
 * Open the door, or don't.
 *
 * Two ways to be allowed: the secret that travelled with the notification, or
 * a signed-in keeper who owns the place. The first is what makes the buttons
 * on a lock screen work; the second is what makes the page work when the
 * notification has already been swiped away.
 *
 * One turn of the write chain, and only from `waiting` — a door cannot be
 * opened twice, and pressing both buttons quickly does not race.
 */
export async function answerRing(params: {
  id: string;
  answer: "opened" | "declined";
  answerKey?: string;
  accountId?: string;
}): Promise<Result<{ ring: Ring }>> {
  return withWrite(async () => {
    const store = await readFile();
    const ring = store.rings[params.id];
    if (!ring) return no("There is no such ring.");

    const place = store.establishments[ring.slug];
    const byKeeper = Boolean(params.accountId && place && place.accountId === params.accountId);
    const byKey =
      typeof params.answerKey === "string" &&
      params.answerKey.length === ring.answerKey.length &&
      timingSafeEqual(Buffer.from(params.answerKey), Buffer.from(ring.answerKey));

    // Same refusal either way: a wrong key must not be distinguishable from a
    // ring that belongs to somebody else.
    if (!byKeeper && !byKey) return no("That is not yours to answer.");

    if (!ringAnswerable(ring)) {
      return no(
        ring.state === "waiting"
          ? "Nobody is at the door any more."
          : "That door has already been answered.",
      );
    }

    const answered: Ring = {
      ...ring,
      state: params.answer,
      answeredAt: new Date().toISOString(),
    };
    store.rings[ring.id] = answered;
    await writeFile(store);
    return { ok: true as const, ring: answered };
  });
}

/** A door's recent rings, newest first. */
export async function ringsFor(slug: string): Promise<Ring[]> {
  const store = await readFile();
  return Object.values(store.rings)
    .filter((ring) => ring.slug === slug)
    .sort((a, b) => b.rungAt.localeCompare(a.rungAt));
}

/* ── The keeper's own controls ─────────────────────────────────────────── */

/** Contradict the schedule, for a while. */
export async function setPresence(params: {
  accountId: string;
  slug: string;
  presence: Presence;
  until: string | null;
}): Promise<Result<{ establishment: Establishment }>> {
  return withWrite(async () => {
    const store = await readFile();
    const place = store.establishments[params.slug];
    if (!place || place.accountId !== params.accountId) return no("That is not your establishment.");

    const updated: Establishment = {
      ...place,
      presence: params.presence,
      // `auto` is the absence of an override, so it cannot carry an expiry.
      presenceUntil: params.presence === "auto" ? null : params.until,
      updatedAt: new Date().toISOString(),
    };
    store.establishments[place.slug] = updated;
    await writeFile(store);
    return { ok: true as const, establishment: updated };
  });
}

/** Wire up — or unwire — where the bell rings. */
export async function setBell(params: {
  accountId: string;
  slug: string;
  bell: BellConfig | null;
}): Promise<Result<{ establishment: Establishment }>> {
  return withWrite(async () => {
    const store = await readFile();
    const place = store.establishments[params.slug];
    if (!place || place.accountId !== params.accountId) return no("That is not your establishment.");

    const updated: Establishment = {
      ...place,
      bell: params.bell,
      updatedAt: new Date().toISOString(),
    };
    store.establishments[place.slug] = updated;
    await writeFile(store);
    return { ok: true as const, establishment: updated };
  });
}

/** The bell's wiring, for the one caller allowed to use it: the ring endpoint. */
export async function bellFor(slug: string): Promise<BellConfig | null> {
  const store = await readFile();
  return store.establishments[slug]?.bell ?? null;
}


/* ── The room ──────────────────────────────────────────────────────────── */

/**
 * A freshly built room, waiting to be looked at.
 *
 * Never live on arrival. Whatever the builder produced, a keeper sees it
 * standing in their own doorway before an agent does — a generated room is
 * still the keeper's room, and they are the one whose name is on it.
 */
export async function setRoomDraft(params: {
  accountId: string;
  slug: string;
  room: BuiltRoom;
}): Promise<Result<Record<never, never>>> {
  return withWrite(async () => {
    const store = await readFile();
    const place = store.establishments[params.slug];
    if (!place || place.accountId !== params.accountId) return no("That is not your establishment.");

    store.establishments[place.slug] = { ...place, roomDraft: params.room };
    await writeFile(store);
    return { ok: true as const };
  });
}

/** Hang it. The draft becomes the room an agent walks into. */
export async function approveRoomDraft(params: {
  accountId: string;
  slug: string;
}): Promise<Result<Record<never, never>>> {
  return withWrite(async () => {
    const store = await readFile();
    const place = store.establishments[params.slug];
    if (!place || place.accountId !== params.accountId) return no("That is not your establishment.");
    if (!place.roomDraft) return no("There is nothing waiting to be hung.");

    store.establishments[place.slug] = {
      ...place,
      room: place.roomDraft,
      roomDraft: null,
      updatedAt: new Date().toISOString(),
    };
    await writeFile(store);
    return { ok: true as const };
  });
}

/**
 * Throw the draft away, or take the room down.
 *
 * `which: "room"` leaves the establishment with no room at all, which is a
 * legitimate state — a place can be a page and a doorbell without an interior.
 */
export async function discardRoom(params: {
  accountId: string;
  slug: string;
  which: "draft" | "room";
}): Promise<Result<Record<never, never>>> {
  return withWrite(async () => {
    const store = await readFile();
    const place = store.establishments[params.slug];
    if (!place || place.accountId !== params.accountId) return no("That is not your establishment.");

    store.establishments[place.slug] =
      params.which === "draft" ? { ...place, roomDraft: null } : { ...place, room: null };
    await writeFile(store);
    return { ok: true as const };
  });
}

/** The room as a visitor gets it. Null when the place has no interior. */
export async function roomFor(slug: string): Promise<BuiltRoom | null> {
  const store = await readFile();
  return store.establishments[slug.trim().toLowerCase()]?.room ?? null;
}

/** The keeper's own view: what is hung, and what is waiting. */
export async function roomsFor(params: {
  accountId: string;
  slug: string;
}): Promise<{ room: BuiltRoom | null; draft: BuiltRoom | null } | null> {
  const store = await readFile();
  const place = store.establishments[params.slug];
  if (!place || place.accountId !== params.accountId) return null;
  return { room: place.room, draft: place.roomDraft };
}


/* ── Demolition ────────────────────────────────────────────────────────── */

export interface Demolished {
  slug: string;
  name: string;
  keeper: string;
  /** The account that held it, if it was removed too. */
  accountRemoved: string | null;
  /** Other places that account kept, which went with it. */
  alsoRemoved: string[];
}

/**
 * Take a place down.
 *
 * The operator's button. A permit that reached the wrong person, or a place
 * that turned out to be something the town will not host — either way this is
 * the fast path, and the slow path was stopping the stack and editing JSON in
 * a container at the moment you were most annoyed.
 *
 * **The permit stays spent.** Its `spentOn` is left pointing at a slug that no
 * longer exists, as a record. Handing it back would turn "one establishment
 * per permit" into "unlimited, with extra steps", and would give somebody
 * whose place was just demolished a free retry. Re-granting is a new permit,
 * which is a deliberate act by a person.
 *
 * **The address is freed.** Establishments are keyed by slug, so removing one
 * releases the name — which is the point when the reason for removing it was
 * that somebody took an address they should not have.
 *
 * `alsoKeeper` removes the account as well, and with it every other place that
 * account kept. That is the right hammer when a permit reached the wrong
 * person entirely, and the wrong one when a keeper in good standing simply
 * wants a page gone.
 */
export async function demolishEstablishment(params: {
  slug: string;
  alsoKeeper?: boolean;
}): Promise<Result<{ removed: Demolished }>> {
  return withWrite(async () => {
    const store = await readFile();
    const place = store.establishments[params.slug.trim().toLowerCase()];
    if (!place) return no("There is no such place.");

    const alsoRemoved: string[] = [];
    delete store.establishments[place.slug];

    if (params.alsoKeeper) {
      for (const other of Object.values(store.establishments)) {
        if (other.accountId === place.accountId) {
          delete store.establishments[other.slug];
          alsoRemoved.push(other.slug);
        }
      }
      // Unspent permits bound to them go too, so a removed keeper cannot
      // simply open somewhere else with what they were still holding.
      for (const permit of Object.values(store.permits)) {
        if (permit.boundTo === place.accountId && !permit.spentOn) {
          delete store.permits[permit.id];
        }
      }
      delete store.accounts[place.accountId];
    }

    // Rings are event records, not content, and they name the door. With the
    // door gone they refer to nothing.
    for (const ring of Object.values(store.rings)) {
      if (ring.slug === place.slug || alsoRemoved.includes(ring.slug)) {
        delete store.rings[ring.id];
      }
    }

    await writeFile(store);
    return {
      ok: true as const,
      removed: {
        slug: place.slug,
        name: place.name,
        keeper: place.keeper,
        accountRemoved: params.alsoKeeper ? place.accountId : null,
        alsoRemoved,
      },
    };
  });
}

/** Every place in town, for whoever is moderating it. */
export async function listForModeration(): Promise<
  { slug: string; name: string; kind: string; keeper: string; email: string; openedAt: string;
    wired: boolean; hasRoom: boolean }[]
> {
  const store = await readFile();
  return Object.values(store.establishments)
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
    .map((place) => ({
      slug: place.slug,
      name: place.name,
      kind: place.kind,
      keeper: place.keeper,
      // The operator issued the permit; they can see who holds it.
      email: store.accounts[place.accountId]?.email ?? "(account gone)",
      openedAt: place.openedAt,
      wired: place.bell !== null,
      hasRoom: place.room !== null,
    }));
}
