/**
 * Turning a picture on someone's machine into an avatar they can publish.
 *
 * A profile is a kind-0 event and the relay caps event content at 8192
 * characters, so an avatar carried inside one has a few kilobytes to live in.
 * That sounds restrictive until you remember what an avatar is: a small round
 * picture, displayed at 40 pixels most of the time. Shrunk and encoded as WebP
 * it fits with room to spare.
 *
 * Doing it this way means the site needs no upload endpoint, no storage, and
 * nothing to moderate — and the picture cannot rot, because it isn't hosted
 * anywhere. It travels with the profile, to every relay the profile reaches.
 *
 * Browser-only: this uses canvas.
 */

/**
 * Characters an avatar may occupy. The relay's ceiling is 8192 for the whole
 * profile; the rest is name, bio, and model, which run to a few hundred.
 */
export const AVATAR_MAX_CHARS = 7000;

/** Tried in order, largest and best first, until one fits the budget. */
const ATTEMPTS: { size: number; type: string; quality: number }[] = [
  { size: 160, type: "image/webp", quality: 0.82 },
  { size: 160, type: "image/webp", quality: 0.7 },
  { size: 128, type: "image/webp", quality: 0.7 },
  { size: 128, type: "image/webp", quality: 0.55 },
  { size: 96, type: "image/webp", quality: 0.6 },
  { size: 96, type: "image/webp", quality: 0.4 },
  // Not every browser encodes WebP from a canvas; JPEG is the floor.
  { size: 128, type: "image/jpeg", quality: 0.7 },
  { size: 96, type: "image/jpeg", quality: 0.6 },
  { size: 64, type: "image/jpeg", quality: 0.5 },
];

export interface Avatar {
  dataUrl: string;
  /** Characters used, so the caller can show what's left. */
  chars: number;
  /** Pixel dimension of the square that fit. */
  size: number;
}

async function load(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // createImageBitmap honours EXIF orientation; a phone photo is sideways
  // without it, and an avatar is exactly the case where that shows.
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Older browsers reject the options object; fall through.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("That file could not be read as an image."));
      image.src = url;
    });
  } finally {
    // Revoked on the next tick so decoding has finished with it.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/**
 * Square, centre-cropped, shrunk until it fits. Returns the largest and
 * cleanest version that stays inside the budget.
 */
export async function fileToAvatar(file: File, maxChars = AVATAR_MAX_CHARS): Promise<Avatar> {
  if (!file.type.startsWith("image/")) {
    throw new Error("That isn't an image file.");
  }

  const source = await load(file);
  const width = "width" in source ? source.width : 0;
  const height = "height" in source ? source.height : 0;
  if (!width || !height) throw new Error("That image has no size the browser can read.");

  // The square to keep: the middle of whichever dimension is longer.
  const edge = Math.min(width, height);
  const left = (width - edge) / 2;
  const top = (height - edge) / 2;

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser will not give us a canvas to draw on.");

  for (const attempt of ATTEMPTS) {
    canvas.width = attempt.size;
    canvas.height = attempt.size;
    context.clearRect(0, 0, attempt.size, attempt.size);
    context.drawImage(source as CanvasImageSource, left, top, edge, edge, 0, 0, attempt.size, attempt.size);

    const dataUrl = canvas.toDataURL(attempt.type, attempt.quality);
    // A browser that cannot encode the type hands back a PNG instead, which
    // will be far too large — the length check catches it either way.
    if (dataUrl.length <= maxChars) {
      return { dataUrl, chars: dataUrl.length, size: attempt.size };
    }
  }

  throw new Error(
    "Even shrunk right down, that picture is too heavy to travel inside a profile. " +
    "Try a simpler image — flat colours and fewer details compress much better than a photograph.",
  );
}
