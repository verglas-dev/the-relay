import { promises as fs } from "fs";
import path from "path";

/**
 * The town vault.
 *
 * Residents keep a room here that the street cannot see. The vault stores it
 * sealed and has no way to open it: the contents are encrypted in the
 * resident's browser before they arrive, and the key that would open them is
 * itself wrapped to each guest. Nothing on this server can read a box, which
 * is a stronger promise than "this server chooses not to".
 *
 * The town still learns something. It knows a box exists, roughly how large it
 * is, when it changed, and whose keys have wrappers on it — so the vault knows
 * who invited whom, even sealed. That is better than a public guest list and
 * it is not nothing, and residents should be told so plainly rather than left
 * to assume otherwise.
 */

/** One guest's wrapped copy of the room key, keyed by their public key. */
export type Wrappers = Record<string, string>;

export interface VaultBox {
  owner: string;
  /** The room, encrypted with a key this server never sees. */
  sealed: string;
  /** That key, wrapped separately to each guest — and to the owner. */
  wrappers: Wrappers;
  updatedAt: string;
}

interface VaultFile {
  boxes: Record<string, VaultBox>;
}

const DEFAULT_STORE: VaultFile = { boxes: {} };

/** A sealed room, at the size where a room stops being a room. */
export const MAX_SEALED_CHARS = 256 * 1024;
/** Enough guests for a house; not enough to be a mailing list. */
export const MAX_GUESTS = 64;

let writeChain: Promise<void> = Promise.resolve();

function storePath(): string {
  const fromEnv = process.env.VAULT_STORE_PATH?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.join(/* turbopackIgnore: true */ process.cwd(), fromEnv);
  }
  return path.join(process.cwd(), "data", "vault.json");
}

async function readFile(): Promise<VaultFile> {
  const file = storePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as Partial<VaultFile>;
    return { boxes: parsed.boxes ?? {} };
  } catch {
    return { ...DEFAULT_STORE };
  }
}

async function writeFile(data: VaultFile): Promise<void> {
  const file = storePath();
  // Written beside and moved into place, so a vault that loses power mid-write
  // still has the previous contents rather than half of the new ones.
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(temp, file);
}

async function withWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn);
  writeChain = run.then(() => undefined, () => undefined);
  return run;
}

export async function getBox(owner: string): Promise<VaultBox | null> {
  const store = await readFile();
  return store.boxes[owner.toLowerCase()] ?? null;
}

export async function putBox(box: Omit<VaultBox, "updatedAt">): Promise<VaultBox> {
  return withWrite(async () => {
    const store = await readFile();
    const stored: VaultBox = {
      owner: box.owner.toLowerCase(),
      sealed: box.sealed,
      wrappers: Object.fromEntries(
        Object.entries(box.wrappers).map(([key, value]) => [key.toLowerCase(), value])
      ),
      updatedAt: new Date().toISOString(),
    };
    store.boxes[stored.owner] = stored;
    await writeFile(store);
    return stored;
  });
}

export async function deleteBox(owner: string): Promise<void> {
  return withWrite(async () => {
    const store = await readFile();
    if (!store.boxes[owner.toLowerCase()]) return;
    delete store.boxes[owner.toLowerCase()];
    await writeFile(store);
  });
}

/**
 * May this key open this box?
 *
 * Holding a wrapper is what being on the guest list *means* — the list is not
 * kept separately, because a name on a list without a wrapper could not read
 * anything anyway, and a wrapper without a name would be unreachable.
 */
export function mayOpen(box: VaultBox, pubkey: string): boolean {
  const key = pubkey.toLowerCase();
  return box.owner === key || Object.prototype.hasOwnProperty.call(box.wrappers, key);
}
