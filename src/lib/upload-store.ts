/**
 * Pictures kept by the site itself.
 *
 * Linking to an image host worked until it didn't: the wrong URL renders as
 * nothing, and the right one rots when someone else's account is deleted. So
 * the Relay holds the file. That trade is not free — an image host is also
 * absorbing the question of what strangers upload, and hosting it here means
 * answering that question here.
 *
 * Three things keep it answerable:
 *
 *   Only residents may upload. A Verglas address costs a GitHub account, a
 *   pull request, Thaw's review, and there is one per account. Revoking a
 *   keypair means nothing — anyone makes another in a second — but revoking
 *   a residency actually holds.
 *
 *   Files are content-addressed. A picture is stored as its own SHA-256, so
 *   deleting one hash removes every copy at once and re-uploading the same
 *   bytes lands on the same name instead of filling the disk.
 *
 *   Nothing is trusted from the client. The type comes from the first bytes
 *   of the file, never the filename or the declared content type, and the
 *   stored name is hex — there is no path for a caller to influence.
 */

import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";

/** Enough for a page banner, small enough to bound what a bad day costs. */
export const UPLOAD_MAX_BYTES = 512 * 1024;

/**
 * Formats identified by their own first bytes. SVG is deliberately absent: it
 * is a script host wearing a picture's clothes.
 */
const SIGNATURES: { ext: string; type: string; match: (b: Buffer) => boolean }[] = [
  { ext: "png", type: "image/png", match: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: "jpg", type: "image/jpeg", match: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "gif", type: "image/gif", match: b => b.subarray(0, 6).toString("ascii") === "GIF87a" || b.subarray(0, 6).toString("ascii") === "GIF89a" },
  {
    ext: "webp",
    type: "image/webp",
    match: b => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

export interface StoredUpload {
  /** SHA-256 of the bytes, hex. Also the filename. */
  hash: string;
  ext: string;
  type: string;
  bytes: number;
  /** The Ed25519 public key that signed for it. */
  pubkey: string;
  /** The Verglas address that key belongs to, at the time of upload. */
  handle: string;
  at: string;
  /** Kept so an abusive upload can be traced, not to identify readers. */
  ip: string;
}

interface UploadIndex {
  uploads: Record<string, StoredUpload>;
  /** Residents whose upload rights are withdrawn, by handle. */
  revoked: string[];
  /**
   * Addresses refused outright. The fast layer: it stops what is happening
   * now, within seconds, without waiting for anyone to identify themselves.
   * It is also the weak one — a VPN defeats it in half a minute, and a mobile
   * network shares one address between thousands of unrelated people. Use it
   * for the next ten minutes; use revocation for keeps.
   */
  blocked: string[];
}

const EMPTY: UploadIndex = { uploads: {}, revoked: [], blocked: [] };
let writeChain: Promise<void> = Promise.resolve();

function uploadDir(): string {
  const fromEnv = process.env.UPLOAD_DIR?.trim();
  if (fromEnv) {
    // Runtime uploads live on a mounted volume; they are not build inputs.
    return path.isAbsolute(fromEnv) ? fromEnv : path.join(/* turbopackIgnore: true */ process.cwd(), fromEnv);
  }
  return path.join(process.cwd(), "data", "uploads");
}

function indexPath(): string {
  return path.join(uploadDir(), "index.json");
}

async function readIndex(): Promise<UploadIndex> {
  try {
    const raw = await fs.readFile(indexPath(), "utf8");
    const parsed = JSON.parse(raw);
    return {
      uploads: parsed.uploads ?? {},
      revoked: Array.isArray(parsed.revoked) ? parsed.revoked : [],
      blocked: Array.isArray(parsed.blocked) ? parsed.blocked : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

/** Serialised, so two uploads landing together cannot lose each other. */
function writeIndex(next: UploadIndex): Promise<void> {
  writeChain = writeChain.then(async () => {
    await fs.mkdir(uploadDir(), { recursive: true });
    await fs.writeFile(indexPath(), JSON.stringify(next, null, 2), "utf8");
  });
  return writeChain;
}

/** What kind of picture this actually is, or null if it isn't one. */
export function identify(bytes: Buffer): { ext: string; type: string } | null {
  if (bytes.byteLength < 12) return null;
  const found = SIGNATURES.find(signature => signature.match(bytes));
  return found ? { ext: found.ext, type: found.type } : null;
}

export async function isRevoked(handle: string): Promise<boolean> {
  const index = await readIndex();
  return index.revoked.includes(handle.toLowerCase());
}

export async function setRevoked(handle: string, revoked: boolean): Promise<void> {
  const index = await readIndex();
  const key = handle.toLowerCase();
  const without = index.revoked.filter(entry => entry !== key);
  await writeIndex({ ...index, revoked: revoked ? [...without, key] : without });
}

export async function listUploads(): Promise<StoredUpload[]> {
  const index = await readIndex();
  return Object.values(index.uploads).sort((a, b) => b.at.localeCompare(a.at));
}

export async function revokedHandles(): Promise<string[]> {
  return (await readIndex()).revoked;
}

/**
 * Store bytes that have already been verified as an image from a resident who
 * is allowed to send them. Returns the stored record; an identical file that
 * is already here is returned rather than written twice.
 */
export async function keep(
  bytes: Buffer,
  who: { pubkey: string; handle: string; ip: string },
): Promise<StoredUpload> {
  const kind = identify(bytes);
  if (!kind) throw new Error("That file is not a PNG, JPEG, GIF, or WebP.");
  if (bytes.byteLength > UPLOAD_MAX_BYTES) {
    throw new Error(`That picture is ${Math.round(bytes.byteLength / 1024)} KB; the limit is ${UPLOAD_MAX_BYTES / 1024} KB.`);
  }

  const hash = createHash("sha256").update(bytes).digest("hex");
  const index = await readIndex();
  const existing = index.uploads[hash];
  if (existing) return existing;

  const record: StoredUpload = {
    hash,
    ext: kind.ext,
    type: kind.type,
    bytes: bytes.byteLength,
    pubkey: who.pubkey,
    handle: who.handle.toLowerCase(),
    at: new Date().toISOString(),
    ip: who.ip,
  };

  await fs.mkdir(uploadDir(), { recursive: true });
  await fs.writeFile(path.join(/* turbopackIgnore: true */ uploadDir(), `${hash}.${kind.ext}`), bytes);
  await writeIndex({ ...index, uploads: { ...index.uploads, [hash]: record } });
  return record;
}

/** Read a stored picture. The hash is validated as hex, so no path escapes. */
export async function read(hash: string): Promise<{ bytes: Buffer; record: StoredUpload } | null> {
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  const index = await readIndex();
  const record = index.uploads[hash];
  if (!record) return null;

  try {
    const bytes = await fs.readFile(
      /* turbopackIgnore: true */ path.join(
        /* turbopackIgnore: true */ uploadDir(),
        `${hash}.${record.ext}`,
      ),
    );
    return { bytes, record };
  } catch {
    return null;
  }
}

/** Remove a picture everywhere. Content addressing makes that one delete. */
export async function forget(hash: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(hash)) return false;
  const index = await readIndex();
  const record = index.uploads[hash];
  if (!record) return false;

  await fs.rm(path.join(/* turbopackIgnore: true */ uploadDir(), `${hash}.${record.ext}`), { force: true });
  const uploads = { ...index.uploads };
  delete uploads[hash];
  await writeIndex({ ...index, uploads });
  return true;
}

/**
 * Whether an address is refused. An IPv6 caller is matched on its /64 as well
 * as in full: one household holds 18 quintillion v6 addresses, so blocking a
 * single one of them accomplishes nothing at all.
 */
export async function isBlocked(ip: string): Promise<boolean> {
  const address = ip.trim().toLowerCase();
  if (!address) return false;

  const index = await readIndex();
  if (index.blocked.includes(address)) return true;

  if (address.includes(":")) {
    const prefix = address.split(":").slice(0, 4).join(":");
    return index.blocked.some(entry => entry.toLowerCase() === prefix || entry.toLowerCase() === `${prefix}::/64`);
  }

  return false;
}

export async function setBlocked(ip: string, blocked: boolean): Promise<void> {
  const address = ip.trim().toLowerCase();
  if (!address) return;
  const index = await readIndex();
  const without = index.blocked.filter(entry => entry !== address);
  await writeIndex({ ...index, blocked: blocked ? [...without, address] : without });
}

export async function blockedAddresses(): Promise<string[]> {
  return (await readIndex()).blocked;
}
