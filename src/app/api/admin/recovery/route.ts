import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-auth";
import { publishToRelay, queryRelay } from "@/lib/relay-bridge";
import {
  KIND_IDENTITY_SUCCESSOR,
  generateRecoveryKeypair,
  isPubkey,
  operatorPrivateKey,
  operatorPublicKey,
  signSuccessorAttestation,
} from "@/lib/identity-recovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthed(req: NextRequest): boolean {
  return isAdminRequest(req.headers.get("authorization"));
}

interface AttestationView {
  eventId: string;
  oldPubkey: string;
  newPubkey: string;
  note: string;
  issuedAt: number;
}

function toView(event: {
  id: string;
  content: string;
  created_at: number;
  tags: string[][];
}): AttestationView | null {
  const oldPubkey = event.tags.find((t) => t[0] === "old")?.[1];
  const newPubkey = event.tags.find((t) => t[0] === "p")?.[1];
  if (!oldPubkey || !newPubkey) return null;
  return {
    eventId: event.id,
    oldPubkey,
    newPubkey,
    note: event.content,
    issuedAt: event.created_at,
  };
}

/**
 * GET /api/admin/recovery — every recovery issued so far, newest first.
 *
 * Read back from the relay rather than a local file: the attestations are the
 * record, so this cannot drift from what the relay is actually honouring.
 */
export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return unauthorizedResponse();

  const operator = operatorPublicKey();
  if (!operator) {
    return NextResponse.json(
      { configured: false, recoveries: [], error: "OPERATOR_PRIVATE_KEY is not set." },
      { status: 200 },
    );
  }

  const result = await queryRelay([
    { kinds: [KIND_IDENTITY_SUCCESSOR], authors: [operator], limit: 200 },
  ]);
  if (!result.ok) {
    return NextResponse.json(
      { configured: true, operator, recoveries: [], error: result.message },
      { status: result.status },
    );
  }

  const recoveries = result.events
    .map(toView)
    .filter((r): r is AttestationView => r !== null)
    .sort((a, b) => b.issuedAt - a.issuedAt);

  return NextResponse.json({ configured: true, operator, recoveries });
}

/**
 * POST /api/admin/recovery — issue a replacement key for a lost identity.
 *
 * Mints a fresh keypair, publishes an operator-signed attestation that it
 * continues `oldPubkey`, and returns the private key. That private key is in
 * this response and nowhere else: it is never stored, and reissuing produces a
 * different key rather than the same one again.
 */
export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return unauthorizedResponse();

  const priv = operatorPrivateKey();
  if (!priv) {
    return NextResponse.json(
      { error: "OPERATOR_PRIVATE_KEY is not set — account recovery is switched off." },
      { status: 503 },
    );
  }

  let body: { oldPubkey?: unknown; note?: unknown; force?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const oldPubkey = typeof body.oldPubkey === "string" ? body.oldPubkey.trim().toLowerCase() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";

  if (!isPubkey(oldPubkey)) {
    return NextResponse.json(
      { error: "oldPubkey must be a 64-character hex public key." },
      { status: 400 },
    );
  }
  // The note is the only durable answer to "why does this key own that history",
  // so an attestation without one is not worth issuing.
  if (note.length < 3) {
    return NextResponse.json(
      { error: "Record how you identified this user — the note is the audit trail." },
      { status: 400 },
    );
  }
  if (note.length > 500) {
    return NextResponse.json({ error: "Note must be 500 characters or fewer." }, { status: 400 });
  }

  // Recovering an identity that has already been recovered would silently
  // strand the key issued last time, so make the operator look at it first.
  const existing = await queryRelay([
    { kinds: [KIND_IDENTITY_SUCCESSOR], authors: [operatorPublicKey()!], "#old": [oldPubkey], limit: 1 },
  ]);
  if (existing.ok && existing.events.length > 0 && body.force !== true) {
    return NextResponse.json(
      {
        error: "This identity has already been recovered once.",
        priorRecovery: toView(existing.events[0]),
        hint: "Reissuing retires the key handed out last time. Send force: true to proceed.",
      },
      { status: 409 },
    );
  }

  const keypair = generateRecoveryKeypair();
  const attestation = signSuccessorAttestation({
    oldPubkey,
    newPubkey: keypair.publicKey,
    note,
    operatorPrivateKey: priv,
  });

  const result = await publishToRelay(attestation);
  if (!result.ok) {
    // Say nothing about the keypair: the attestation never landed, so the key
    // owns no history and handing it over would strand the user again.
    return NextResponse.json(
      { error: `The relay rejected the attestation: ${result.message}` },
      { status: 502 },
    );
  }

  return NextResponse.json(
    {
      oldPubkey,
      newPubkey: keypair.publicKey,
      // Shown once. Copy it to the user now — it is not recoverable from here.
      privateKey: keypair.privateKey,
      note,
      eventId: attestation.id,
      issuedAt: attestation.created_at,
    },
    { status: 201 },
  );
}
