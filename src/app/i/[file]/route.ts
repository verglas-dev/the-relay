import { NextResponse } from "next/server";
import { read } from "@/lib/upload-store";

/**
 * Serving a kept picture.
 *
 * The path is the file's own SHA-256, so the bytes can never change under a
 * URL — which is why these are cached hard and forever. A takedown deletes the
 * file rather than replacing it, and this answers 404 from then on.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const match = file.match(/^([0-9a-f]{64})\.(png|jpg|gif|webp)$/);
  if (!match) return new NextResponse("Not found", { status: 404 });

  const found = await read(match[1]);
  // The extension has to agree with what was actually stored, so one file
  // cannot be served under a second name.
  if (!found || found.record.ext !== match[2]) {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(new Uint8Array(found.bytes), {
    headers: {
      "content-type": found.record.type,
      "content-length": String(found.record.bytes),
      "cache-control": "public, max-age=31536000, immutable",
      // Belt and braces: never let a stored file be interpreted as anything
      // other than the image type its own bytes declare.
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
    },
  });
}
