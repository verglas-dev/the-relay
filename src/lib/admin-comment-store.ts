import { promises as fs } from "fs";
import path from "path";
import {
  type AdminCommentInput,
  type AdminCommentPatch,
  type AdminCommentRecord,
  isValidEventId,
} from "@/lib/admin-comments";

interface AdminCommentStoreFile {
  comments: Record<string, AdminCommentRecord>;
}

const DEFAULT_STORE: AdminCommentStoreFile = { comments: {} };
let writeChain: Promise<void> = Promise.resolve();

function getStorePath(): string {
  const fromEnv = process.env.ADMIN_COMMENT_STORE_PATH?.trim();
  if (fromEnv) {
    // Runtime data is mounted separately in production; it is not a build input.
    return path.isAbsolute(fromEnv) ? fromEnv : path.join(/* turbopackIgnore: true */ process.cwd(), fromEnv);
  }
  return path.join(process.cwd(), "data", "admin-comments.json");
}

async function ensureStoreFile(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(DEFAULT_STORE, null, 2), "utf8");
  }
}

async function readStoreFile(filePath: string): Promise<AdminCommentStoreFile> {
  await ensureStoreFile(filePath);
  const raw = await fs.readFile(filePath, "utf8");
  try {
    const parsed = JSON.parse(raw) as Partial<AdminCommentStoreFile>;
    return {
      comments: parsed.comments ?? {},
    };
  } catch {
    return { ...DEFAULT_STORE };
  }
}

async function writeStoreFile(filePath: string, data: AdminCommentStoreFile): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function withStoreWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn);
  writeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function validateId(id: string) {
  if (!isValidEventId(id.trim().toLowerCase())) {
    throw new Error("Invalid comment id. Expected 64-char lowercase hex.");
  }
}

function normalizePatch(patch: AdminCommentPatch): AdminCommentPatch {
  const normalized: AdminCommentPatch = {};
  if (patch.content !== undefined) normalized.content = patch.content.trim();
  if (patch.deleted !== undefined) normalized.deleted = Boolean(patch.deleted);
  return normalized;
}

function validatePatch(patch: AdminCommentPatch) {
  if (patch.content !== undefined && !patch.content) {
    throw new Error("content cannot be empty.");
  }
}

export async function listAdminComments(options?: { includeDeleted?: boolean }): Promise<AdminCommentRecord[]> {
  const filePath = getStorePath();
  const store = await readStoreFile(filePath);
  const includeDeleted = Boolean(options?.includeDeleted);
  return Object.values(store.comments)
    .filter((comment) => includeDeleted || !comment.deleted)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getAdminComment(id: string): Promise<AdminCommentRecord | null> {
  validateId(id);
  const filePath = getStorePath();
  const store = await readStoreFile(filePath);
  const key = id.trim().toLowerCase();
  return store.comments[key] ?? null;
}

export async function upsertAdminComment(input: AdminCommentInput): Promise<AdminCommentRecord> {
  const id = input.id.trim().toLowerCase();
  validateId(id);
  const patch = normalizePatch(input);
  validatePatch(patch);

  return withStoreWrite(async () => {
    const filePath = getStorePath();
    const store = await readStoreFile(filePath);
    const existing = store.comments[id];
    const now = new Date().toISOString();
    const updated: AdminCommentRecord = {
      ...(existing ?? {}),
      id,
      ...patch,
      deleted: patch.deleted ?? existing?.deleted ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (!existing && updated.content === undefined && !updated.deleted) {
      throw new Error("No moderation changes provided.");
    }

    store.comments[id] = updated;
    await writeStoreFile(filePath, store);
    return updated;
  });
}

export async function updateAdminComment(id: string, patch: AdminCommentPatch): Promise<AdminCommentRecord> {
  return upsertAdminComment({ id, ...patch });
}

export async function deleteAdminComment(id: string): Promise<AdminCommentRecord> {
  const key = id.trim().toLowerCase();
  validateId(key);

  return withStoreWrite(async () => {
    const filePath = getStorePath();
    const store = await readStoreFile(filePath);
    const existing = store.comments[key];
    const now = new Date().toISOString();
    const updated: AdminCommentRecord = {
      ...(existing ?? {}),
      id: key,
      deleted: true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    store.comments[key] = updated;
    await writeStoreFile(filePath, store);
    return updated;
  });
}
