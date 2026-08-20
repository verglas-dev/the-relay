import { promises as fs } from "fs";
import path from "path";

export { MAX_ROOM_BYTES } from "@/lib/room-safety";

/**
 * Where the rooms are kept.
 *
 * A sibling of the vault, and deliberately not the same shelf, because the two
 * make opposite promises and blurring them would be the worst kind of quiet
 * mistake:
 *
 *   The vault holds a note the town **cannot read**. It arrives encrypted.
 *   This holds a room the town **can read**. It has to — a browser is going to
 *   be handed it as HTML, so the server necessarily has the plaintext.
 *
 * That is not a weaker version of the vault's promise, it is a different one,
 * and residents are told so in the room's own editor rather than left to
 * assume the sealed thing next to it covers this too.
 *
 * Not the town repository either. `verglas-dev/verglas` is public, so a room
 * committed there would publish the answers to its own quiz, the layout of its
 * own maze, and whatever the note told a guest to type — next to the room they
 * were meant to protect.
 *
 * Same file discipline as the vault: one JSON file, written beside itself and
 * moved into place, writes serialised through one chain.
 */

export interface Room {
  owner: string;
  /** One HTML file, as the resident wrote it. */
  html: string;
  updatedAt: string;
}

interface RoomFile {
  rooms: Record<string, Room>;
}

let writeChain: Promise<void> = Promise.resolve();

function storePath(): string {
  const fromEnv = process.env.ROOM_STORE_PATH?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.join(/* turbopackIgnore: true */ process.cwd(), fromEnv);
  }
  return path.join(process.cwd(), "data", "rooms.json");
}

async function readFile(): Promise<RoomFile> {
  const file = storePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as Partial<RoomFile>;
    return { rooms: parsed.rooms ?? {} };
  } catch {
    return { rooms: {} };
  }
}

async function writeFile(data: RoomFile): Promise<void> {
  const file = storePath();
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(temp, file);
}

async function withWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn);
  writeChain = run.then(() => undefined, () => undefined);
  return run;
}

export async function getRoom(owner: string): Promise<Room | null> {
  const store = await readFile();
  return store.rooms[owner.toLowerCase()] ?? null;
}

export async function putRoom(room: Omit<Room, "updatedAt">): Promise<Room> {
  return withWrite(async () => {
    const store = await readFile();
    const stored: Room = {
      owner: room.owner.toLowerCase(),
      html: room.html,
      updatedAt: new Date().toISOString(),
    };
    store.rooms[stored.owner] = stored;
    await writeFile(store);
    return stored;
  });
}

export async function deleteRoom(owner: string): Promise<void> {
  return withWrite(async () => {
    const store = await readFile();
    if (!store.rooms[owner.toLowerCase()]) return;
    delete store.rooms[owner.toLowerCase()];
    await writeFile(store);
  });
}
