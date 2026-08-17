import { promises as fs } from "fs";
import path from "path";
import type { RecoveryRequest, RecoveryRequestState } from "@/lib/recovery-requests";

interface RecoveryStoreFile {
  requests: Record<string, RecoveryRequest>;
}

const DEFAULT_STORE: RecoveryStoreFile = { requests: {} };
let writeChain: Promise<void> = Promise.resolve();

function getStorePath(): string {
  const fromEnv = process.env.RECOVERY_REQUEST_STORE_PATH?.trim();
  if (fromEnv) {
    // Runtime data is mounted separately in production; it is not a build input.
    return path.isAbsolute(fromEnv) ? fromEnv : path.join(/* turbopackIgnore: true */ process.cwd(), fromEnv);
  }
  return path.join(process.cwd(), "data", "recovery-requests.json");
}

async function ensureStoreFile(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(DEFAULT_STORE, null, 2), "utf8");
  }
}

async function readStoreFile(filePath: string): Promise<RecoveryStoreFile> {
  await ensureStoreFile(filePath);
  const raw = await fs.readFile(filePath, "utf8");
  try {
    const parsed = JSON.parse(raw) as Partial<RecoveryStoreFile>;
    return { requests: parsed.requests ?? {} };
  } catch {
    return { ...DEFAULT_STORE };
  }
}

async function writeStoreFile(filePath: string, data: RecoveryStoreFile): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

/** Read, mutate, write — serialised through withStoreWrite by every caller. */
async function updateStore<T>(
  fn: (store: RecoveryStoreFile) => { result: T; dirty: boolean },
): Promise<T> {
  return withStoreWrite(async () => {
    const filePath = getStorePath();
    const store = await readStoreFile(filePath);
    const { result, dirty } = fn(store);
    if (dirty) await writeStoreFile(filePath, store);
    return result;
  });
}

async function withStoreWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn);
  writeChain = run.then(() => undefined, () => undefined);
  return run;
}

export async function getRecoveryRequest(login: string): Promise<RecoveryRequest | null> {
  const store = await readStoreFile(getStorePath());
  return store.requests[login.toLowerCase()] ?? null;
}

export async function listRecoveryRequests(): Promise<RecoveryRequest[]> {
  const store = await readStoreFile(getStorePath());
  return Object.values(store.requests).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

/**
 * Open a request, or return the one already open for this account.
 *
 * Requesting again after a denial is allowed — the operator may have wanted
 * something clarified — but an already-approved request is returned untouched
 * so a reload cannot walk an approval backwards into pending.
 */
export async function openRecoveryRequest(input: {
  login: string;
  handle: string;
  oldPubkey: string;
}): Promise<RecoveryRequest> {
  return updateStore((store) => {
    const login = input.login.toLowerCase();
    const existing = store.requests[login];
    if (existing && existing.state !== "denied") return { result: existing, dirty: false };

    const request: RecoveryRequest = {
      login,
      handle: input.handle,
      oldPubkey: input.oldPubkey.toLowerCase(),
      state: "pending",
      requestedAt: new Date().toISOString(),
    };
    store.requests[login] = request;
    return { result: request, dirty: true };
  });
}

export async function decideRecoveryRequest(
  login: string,
  state: Extract<RecoveryRequestState, "approved" | "denied">,
  decisionNote?: string,
): Promise<RecoveryRequest | null> {
  return updateStore((store) => {
    const key = login.toLowerCase();
    const existing = store.requests[key];
    if (!existing) return { result: null, dirty: false };
    // A claimed request is finished. Re-approving would offer a second key and
    // silently retire the one already in the requester's hands.
    if (existing.state === "claimed") return { result: existing, dirty: false };

    const updated: RecoveryRequest = {
      ...existing,
      state,
      decidedAt: new Date().toISOString(),
      decisionNote: decisionNote?.trim() || undefined,
    };
    store.requests[key] = updated;
    return { result: updated, dirty: true };
  });
}

/**
 * Mark a request claimed and record what it produced.
 *
 * Returns null when the request is not in `approved`, which is what stops a
 * replayed claim from minting a second identity off one approval.
 */
export async function markRecoveryClaimed(
  login: string,
  result: { newPubkey: string; eventId: string; addressPullUrl?: string },
): Promise<RecoveryRequest | null> {
  return updateStore((store) => {
    const key = login.toLowerCase();
    const existing = store.requests[key];
    if (!existing || existing.state !== "approved") return { result: null, dirty: false };

    const updated: RecoveryRequest = {
      ...existing,
      state: "claimed",
      newPubkey: result.newPubkey,
      eventId: result.eventId,
      addressPullUrl: result.addressPullUrl,
    };
    store.requests[key] = updated;
    return { result: updated, dirty: true };
  });
}

/** Attach the ADDRESS.md pull request opened after a claim, best-effort. */
export async function attachAddressPull(login: string, url: string): Promise<void> {
  await updateStore((store) => {
    const key = login.toLowerCase();
    const existing = store.requests[key];
    if (!existing) return { result: undefined, dirty: false };
    store.requests[key] = { ...existing, addressPullUrl: url };
    return { result: undefined, dirty: true };
  });
}
