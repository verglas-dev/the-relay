"use client";

import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import * as ed from "@noble/ed25519";
// Imported for the side effect: it wires the sha512 the signer needs.
import type { BrowserIdentity } from "@/lib/browser-identity";
import "@/lib/browser-identity";

/** Matches the server's ceiling. Shrinking aims comfortably below it. */
export const UPLOAD_MAX_BYTES = 512 * 1024;

/** Longest edge kept for a page picture. Wide enough for a banner. */
const MAX_EDGE = 1600;

/**
 * Shrink a picture until it is worth sending.
 *
 * A photograph off a phone is several megabytes of detail nobody will see
 * behind a page of text, and the server refuses anything over half a megabyte.
 * Rather than reject the file and make it the person's problem, the browser
 * re-encodes it: a background at 1600 pixels is indistinguishable from the
 * original on any screen it will be displayed on.
 *
 * A file already small enough is passed through untouched — re-encoding a
 * tidy PNG of flat colours would only make it worse.
 */
export async function shrinkForUpload(file: File, maxBytes = UPLOAD_MAX_BYTES): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("That isn't an image file.");
  if (file.size <= maxBytes && file.type !== "image/bmp") return file;
  // An animated GIF loses its animation on a canvas, so it is sent as it is
  // and refused by the server if it's too heavy. Better than silently
  // flattening someone's animation to a single frame.
  if (file.type === "image/gif") return file;

  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));

  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser will not give us a canvas to draw on.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  for (const quality of [0.85, 0.72, 0.6, 0.45, 0.32]) {
    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, "image/webp", quality),
    );
    if (blob && blob.size <= maxBytes) return blob;
  }

  throw new Error(
    `That picture won't come down under ${Math.round(maxBytes / 1024)} KB. Try a smaller one.`,
  );
}

/**
 * Send a picture the site will keep.
 *
 * The signature covers the SHA-256 of the exact bytes, so it proves both who
 * is sending and what they are sending — it cannot be lifted onto a different
 * file. The server checks it against the keypair, then checks that the keypair
 * belongs to someone who lives in Verglas.
 */
export async function uploadPicture(
  file: File,
  identity: BrowserIdentity,
): Promise<{ url: string; bytes: number }> {
  const blob = await shrinkForUpload(file);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const signature = bytesToHex(ed.sign(sha256(bytes), hexToBytes(identity.privateKey)));

  const response = await fetch("/api/upload", {
    method: "POST",
    headers: {
      "x-pubkey": identity.publicKey,
      "x-signature": signature,
      "content-type": "application/octet-stream",
    },
    body: bytes,
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "That picture could not be kept.");
  return { url: body.url as string, bytes: body.bytes as number };
}
