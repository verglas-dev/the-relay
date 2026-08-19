import { promises as fs } from "fs";
import path from "path";

/**
 * Every message the contact form takes, written down before anything is sent.
 *
 * Mail is the part of this that can fail: a wrong password, an expired token,
 * a provider refusing the connection, or simply nobody having configured one
 * yet. None of those are the sender's fault, and none of them should mean the
 * message is gone. It is stored first and mailed second, so the worst case is
 * an operator reading a file instead of an inbox.
 */

export interface ContactMessage {
  id: string;
  subject: string;
  body: string;
  /** Whatever the sender chose to put in "From" — often nothing. */
  from: string;
  receivedAt: string;
  /** Whether the email carrying this actually went out. */
  mailed: boolean;
  /** Why it did not, when it did not. */
  mailError?: string;
}

interface ContactStoreFile {
  messages: ContactMessage[];
}

const DEFAULT_STORE: ContactStoreFile = { messages: [] };
/** Older messages are dropped past this, so an unattended file cannot grow forever. */
const MAX_STORED = 500;

let writeChain: Promise<void> = Promise.resolve();

function getStorePath(): string {
  const fromEnv = process.env.CONTACT_STORE_PATH?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.join(/* turbopackIgnore: true */ process.cwd(), fromEnv);
  }
  return path.join(process.cwd(), "data", "contact-messages.json");
}

async function readStoreFile(filePath: string): Promise<ContactStoreFile> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<ContactStoreFile>;
    return { messages: Array.isArray(parsed.messages) ? parsed.messages : [] };
  } catch {
    return { ...DEFAULT_STORE };
  }
}

async function withStoreWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn);
  writeChain = run.then(() => undefined, () => undefined);
  return run;
}

export async function recordContactMessage(
  message: Omit<ContactMessage, "id" | "receivedAt" | "mailed">
): Promise<ContactMessage> {
  return withStoreWrite(async () => {
    const filePath = getStorePath();
    const store = await readStoreFile(filePath);
    const stored: ContactMessage = {
      ...message,
      id: crypto.randomUUID(),
      receivedAt: new Date().toISOString(),
      mailed: false,
    };
    store.messages.unshift(stored);
    store.messages = store.messages.slice(0, MAX_STORED);
    await fs.writeFile(filePath, JSON.stringify(store, null, 2), "utf8");
    return stored;
  });
}

/** Note how the send went, once it has been attempted. */
export async function markContactMessageMailed(id: string, error?: string): Promise<void> {
  return withStoreWrite(async () => {
    const filePath = getStorePath();
    const store = await readStoreFile(filePath);
    const found = store.messages.find((message) => message.id === id);
    if (!found) return;
    found.mailed = !error;
    if (error) found.mailError = error;
    else delete found.mailError;
    await fs.writeFile(filePath, JSON.stringify(store, null, 2), "utf8");
  });
}

export async function listContactMessages(): Promise<ContactMessage[]> {
  return readStoreFile(getStorePath()).then((store) => store.messages);
}
