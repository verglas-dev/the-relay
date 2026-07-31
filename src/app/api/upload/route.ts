import { createHash } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { sha512 } from "@noble/hashes/sha512";
import { hexToBytes } from "@noble/hashes/utils";
import * as ed from "@noble/ed25519";
import { UPLOAD_MAX_BYTES, identify, isBlocked, isRevoked, keep } from "@/lib/upload-store";
import { residentForKey } from "@/lib/verglas-town";

ed.etc.sha512Sync = (...messages: Uint8Array[]): Uint8Array => {
  const joined = new Uint8Array(messages.reduce((total, m) => total + m.length, 0));
  let at = 0;
  for (const message of messages) {
    joined.set(message, at);
    at += message.length;
  }
  return sha512(joined);
};

export const dynamic = "force-dynamic";

/**
 * Keeping a picture for someone who lives here.
 *
 * There are no accounts, so the uploader proves themselves the way everything
 * else on this site does: by signing. The signature covers the SHA-256 of the
 * exact bytes being sent, which means it cannot be replayed against different
 * content, and it ties the file to a keypair permanently.
 *
 * Being a keypair is not enough, though. A key costs nothing to make, so
 * revoking one would only start an argument that repeats forever. Uploading
 * requires a Verglas address — a GitHub account, a pull request, Thaw's
 * review, one per account — and revoking *that* actually holds.
 */
export async function POST(request: NextRequest) {
  const ip =
    (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "";

  // Checked before anything else is read: a refused address should cost the
  // server as little as possible.
  if (await isBlocked(ip)) {
    return NextResponse.json({ error: "This address cannot upload." }, { status: 403 });
  }

  const pubkey = (request.headers.get("x-pubkey") ?? "").trim().toLowerCase();
  const signature = (request.headers.get("x-signature") ?? "").trim().toLowerCase();

  if (!/^[0-9a-f]{64}$/.test(pubkey) || !/^[0-9a-f]{128}$/.test(signature)) {
    return NextResponse.json({ error: "An upload must be signed by the key sending it." }, { status: 401 });
  }

  const bytes = Buffer.from(await request.arrayBuffer());
  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: "That request carried no file." }, { status: 400 });
  }
  if (bytes.byteLength > UPLOAD_MAX_BYTES) {
    return NextResponse.json(
      { error: `That picture is ${Math.round(bytes.byteLength / 1024)} KB; the limit is ${UPLOAD_MAX_BYTES / 1024} KB.` },
      { status: 413 },
    );
  }

  // What it is comes from the bytes themselves, never the filename or the
  // content type the caller claimed.
  if (!identify(bytes)) {
    return NextResponse.json({ error: "That file is not a PNG, JPEG, GIF, or WebP." }, { status: 415 });
  }

  const digest = createHash("sha256").update(bytes).digest();
  let signed = false;
  try {
    signed = ed.verify(hexToBytes(signature), new Uint8Array(digest), hexToBytes(pubkey));
  } catch {
    signed = false;
  }
  if (!signed) {
    return NextResponse.json({ error: "That signature does not match the file." }, { status: 401 });
  }

  const handle = await residentForKey(pubkey);
  if (!handle) {
    return NextResponse.json(
      {
        error:
          "Pictures are kept here for residents of Verglas. Move in with this key and the site " +
          "will hold them for you — until then, a link to an image elsewhere works.",
      },
      { status: 403 },
    );
  }

  if (await isRevoked(handle)) {
    return NextResponse.json(
      { error: "Uploading has been withdrawn for this address." },
      { status: 403 },
    );
  }

  try {
    const stored = await keep(bytes, { pubkey, handle, ip });
    return NextResponse.json({
      url: `/i/${stored.hash}.${stored.ext}`,
      hash: stored.hash,
      bytes: stored.bytes,
      type: stored.type,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "That picture could not be kept." },
      { status: 400 },
    );
  }
}
