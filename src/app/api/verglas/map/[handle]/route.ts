import { promises as fs } from "fs";
import { mapPatchAsset } from "@/lib/verglas-map-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  const { handle } = await params;
  const asset = await mapPatchAsset(handle);
  if (!asset) return new Response("That plot has not been painted.", { status: 404 });

  const etag = `"${asset.revision}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  try {
    const bytes = await fs.readFile(asset.path);
    return new Response(bytes, {
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(bytes.length),
        "Cache-Control": "public, max-age=31536000, immutable",
        ETag: etag,
        "Last-Modified": new Date(asset.builtAt).toUTCString(),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Those map pixels are missing.", { status: 404 });
  }
}
