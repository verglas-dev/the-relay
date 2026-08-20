import { NextRequest, NextResponse } from "next/server";
import { callerIp, rateLimit } from "@/lib/relay-bridge";
import { isPubkey, verifySignedRequest, type VaultAction } from "@/lib/vault-auth";
import {
  MAX_GUESTS,
  MAX_SEALED_CHARS,
  deleteBox,
  getBox,
  mayOpen,
  putBox,
} from "@/lib/vault-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const READS_PER_MIN = 30;
const WRITES_PER_MIN = 10;
const MAX_BODY_BYTES = 512 * 1024;

interface Params {
  params: Promise<{ owner: string }>;
}

async function readBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The signature fields every request carries, whatever else it says. */
function credentials(body: Record<string, unknown>, owner: string, action: VaultAction) {
  return {
    pubkey: String(body.pubkey ?? "").toLowerCase(),
    owner: owner.toLowerCase(),
    action,
    at: Number(body.at),
    sig: String(body.sig ?? "").toLowerCase(),
  };
}

const refused = (message: string, status: number) =>
  NextResponse.json({ ok: false, error: message }, { status });

/**
 * POST /api/vault/<owner> — open a box you are allowed to open.
 *
 * A POST rather than a GET because reading requires proving who is asking, and
 * a signature does not belong in a URL that ends up in logs and history.
 *
 * The answer carries the sealed room and only the caller's own wrapper. Handing
 * over every wrapper would tell each guest exactly who else was invited, which
 * is the resident's business rather than theirs.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { owner } = await params;
  if (!isPubkey(owner)) return refused("that is not an address in this town", 400);
  if (!rateLimit(`vault-read:${callerIp(request)}`, READS_PER_MIN)) {
    return refused("too many requests at the window — try again shortly", 429);
  }

  const body = await readBody(request);
  if (!body) return refused("that request could not be read", 400);

  const claim = credentials(body, owner, "read");
  const problem = verifySignedRequest(claim);
  if (problem) return refused(problem, 401);

  const box = await getBox(owner);
  // The same answer whether the box is empty or simply not theirs to open:
  // "no box here" and "not for you" would otherwise map the town's guest lists
  // for anyone patient enough to ask about every address.
  if (!box || !mayOpen(box, claim.pubkey)) return refused("there is nothing here for you", 404);

  return NextResponse.json({
    ok: true,
    sealed: box.sealed,
    wrapper: box.wrappers[claim.pubkey] ?? null,
    updatedAt: box.updatedAt,
    /** Owners get the guest count back; it is their list. */
    guests: box.owner === claim.pubkey ? Object.keys(box.wrappers) : undefined,
  });
}

/**
 * PUT /api/vault/<owner> — put a sealed room in your own box.
 *
 * The vault checks that the writer owns the box and that what arrives is the
 * right shape and size. It cannot check the contents, by design: it is
 * ciphertext, and a vault that could tell whether it made sense would be a
 * vault that could read it.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const { owner } = await params;
  if (!isPubkey(owner)) return refused("that is not an address in this town", 400);
  if (!rateLimit(`vault-write:${callerIp(request)}`, WRITES_PER_MIN)) {
    return refused("too many changes at once — try again shortly", 429);
  }

  const body = await readBody(request);
  if (!body) return refused("that request could not be read", 413);

  const claim = credentials(body, owner, "write");
  const problem = verifySignedRequest(claim);
  if (problem) return refused(problem, 401);
  // Only the owner of a box may put anything in it.
  if (claim.pubkey !== claim.owner) return refused("that box is not yours", 403);

  const sealed = typeof body.sealed === "string" ? body.sealed : "";
  if (!sealed) return refused("there is nothing to put away", 400);
  if (sealed.length > MAX_SEALED_CHARS) return refused("that room is too large for a box", 413);

  const wrappersInput = body.wrappers;
  if (!wrappersInput || typeof wrappersInput !== "object" || Array.isArray(wrappersInput)) {
    return refused("the wrapped keys are missing", 400);
  }
  const wrappers = wrappersInput as Record<string, unknown>;
  const guests = Object.keys(wrappers);
  if (guests.length > MAX_GUESTS) return refused(`a guest list stops at ${MAX_GUESTS}`, 400);
  if (guests.some((key) => !isPubkey(key))) return refused("a guest is named by their key", 400);
  if (Object.values(wrappers).some((value) => typeof value !== "string" || !value)) {
    return refused("every guest needs a wrapped key", 400);
  }
  // Locking yourself out is the one mistake with no way back: without a
  // wrapper of your own you could never read what you just sealed.
  if (!guests.includes(claim.owner)) return refused("keep a wrapper for yourself", 400);

  const box = await putBox({
    owner: claim.owner,
    sealed,
    wrappers: wrappers as Record<string, string>,
  });
  return NextResponse.json({ ok: true, guests: Object.keys(box.wrappers).length, updatedAt: box.updatedAt });
}

/** DELETE /api/vault/<owner> — empty the box. Same proof as writing. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const { owner } = await params;
  if (!isPubkey(owner)) return refused("that is not an address in this town", 400);

  const body = await readBody(request);
  if (!body) return refused("that request could not be read", 400);

  const claim = credentials(body, owner, "write");
  const problem = verifySignedRequest(claim);
  if (problem) return refused(problem, 401);
  if (claim.pubkey !== claim.owner) return refused("that box is not yours", 403);

  await deleteBox(claim.owner);
  return NextResponse.json({ ok: true });
}
