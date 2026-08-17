import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { githubConfigured, openRekeyPullRequest, viewerLogin } from "@/lib/verglas-github";
import { forgetSession, rememberSession, sessionToken } from "@/lib/verglas-session";
import { readResidentFiles } from "@/lib/verglas-town";
import { rekeyAddress } from "@/lib/verglas-edit";
import { publishToRelay } from "@/lib/relay-bridge";
import {
  attachAddressPull,
  getRecoveryRequest,
  markRecoveryClaimed,
} from "@/lib/recovery-request-store";
import { PUBKEY_PATTERN, requesterView } from "@/lib/recovery-requests";
import { operatorPrivateKey, signSuccessorAttestation } from "@/lib/identity-recovery";

export const dynamic = "force-dynamic";

/**
 * POST /api/verglas/recovery/claim — finish an approved recovery.
 *
 * The requester's browser mints the keypair and sends only the public half, so
 * the private key is never in this request, never in the store, and never in
 * anyone's mail. This route's job is to bind that public key to the identity
 * the operator approved, and to put the house back in step with it.
 */
export async function POST(request: Request) {
  if (!githubConfigured()) {
    return NextResponse.json({ error: "Recovery is not configured on this server." }, { status: 503 });
  }

  const operatorKey = operatorPrivateKey();
  if (!operatorKey) {
    return NextResponse.json(
      { error: "Recovery is not configured on this server." },
      { status: 503 },
    );
  }

  const jar = await cookies();
  const token = sessionToken(jar);
  if (!token) return NextResponse.json({ error: "Sign in with GitHub first." }, { status: 401 });

  let login: string;
  try {
    login = (await viewerLogin(token)).toLowerCase();
  } catch {
    forgetSession(jar);
    return NextResponse.json({ error: "That sign-in has expired. Sign in again." }, { status: 401 });
  }
  rememberSession(token, login, jar);

  let payload: { newPubkey?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "That request could not be read." }, { status: 400 });
  }

  const newPubkey = typeof payload.newPubkey === "string" ? payload.newPubkey.trim().toLowerCase() : "";
  if (!PUBKEY_PATTERN.test(newPubkey)) {
    return NextResponse.json({ error: "A new public key is required." }, { status: 400 });
  }

  const existing = await getRecoveryRequest(login);
  if (!existing) {
    return NextResponse.json({ error: "No recovery has been requested for this account." }, { status: 404 });
  }
  if (existing.state === "claimed") {
    return NextResponse.json(
      { error: "This recovery has already been claimed.", request: requesterView(existing) },
      { status: 409 },
    );
  }
  if (existing.state !== "approved") {
    return NextResponse.json(
      { error: "This recovery has not been approved yet.", request: requesterView(existing) },
      { status: 403 },
    );
  }
  // A key cannot succeed itself, and an address already on this key has
  // nothing to recover — both would publish an attestation that does nothing.
  if (newPubkey === existing.oldPubkey) {
    return NextResponse.json({ error: "That is the key being replaced." }, { status: 400 });
  }

  const attestation = signSuccessorAttestation({
    oldPubkey: existing.oldPubkey,
    newPubkey,
    note: `verglas resident ${existing.handle}; github @${login} verified by sign-in`,
    operatorPrivateKey: operatorKey,
  });

  const published = await publishToRelay(attestation);
  if (!published.ok) {
    return NextResponse.json(
      { error: `The relay would not take the attestation: ${published.message}` },
      { status: 502 },
    );
  }

  // Claim before the pull request. The attestation is the part that actually
  // hands the identity over, and it has already landed — if GitHub is having a
  // bad afternoon that must not read as a failed recovery, or a retry would
  // publish a second attestation and retire the key they are already holding.
  const claimed = await markRecoveryClaimed(login, { newPubkey, eventId: attestation.id });
  if (!claimed) {
    return NextResponse.json({ error: "This recovery is no longer claimable." }, { status: 409 });
  }

  let addressPullUrl: string | undefined;
  let addressError: string | undefined;
  try {
    const files = await readResidentFiles(existing.handle);
    const rekeyed = files ? rekeyAddress(files.address, newPubkey) : null;
    if (rekeyed) {
      const pull = await openRekeyPullRequest(token, login, existing.handle, rekeyed);
      addressPullUrl = pull.url;
      await attachAddressPull(login, pull.url);
    } else {
      addressError = "The town's copy of the address could not be rewritten automatically.";
    }
  } catch (error) {
    addressError = error instanceof Error ? error.message : "The address change could not be sent.";
  }

  return NextResponse.json({
    request: requesterView({ ...claimed, addressPullUrl }),
    eventId: attestation.id,
    addressPullUrl,
    // Surfaced rather than swallowed: the identity is theirs either way, but
    // until the address is merged the town still points uploads at the old key.
    addressError,
  });
}
