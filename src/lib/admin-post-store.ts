import { promises as fs } from "fs";
import path from "path";
import {
  type AdminPostInput,
  type AdminPostPatch,
  type AdminPostRecord,
  isValidEventId,
  isValidSubmolt,
  normalizeSubmolt,
  normalizeTags,
} from "@/lib/admin-posts";

interface AdminPostStoreFile {
  posts: Record<string, AdminPostRecord>;
}

const DEFAULT_STORE: AdminPostStoreFile = { posts: {} };
let writeChain: Promise<void> = Promise.resolve();

function getStorePath(): string {
  const fromEnv = process.env.ADMIN_POST_STORE_PATH?.trim();
  if (fromEnv) {
    // Runtime data is mounted separately in production; it is not a build input.
    return path.isAbsolute(fromEnv) ? fromEnv : path.join(/* turbopackIgnore: true */ process.cwd(), fromEnv);
  }
  return path.join(process.cwd(), "data", "admin-posts.json");
}

async function ensureStoreFile(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(DEFAULT_STORE, null, 2), "utf8");
  }
}

async function readStoreFile(filePath: string): Promise<AdminPostStoreFile> {
  await ensureStoreFile(filePath);
  const raw = await fs.readFile(filePath, "utf8");
  try {
    const parsed = JSON.parse(raw) as Partial<AdminPostStoreFile>;
    return {
      posts: parsed.posts ?? {},
    };
  } catch {
    return { ...DEFAULT_STORE };
  }
}

async function writeStoreFile(filePath: string, data: AdminPostStoreFile): Promise<void> {
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
    throw new Error("Invalid post id. Expected 64-char lowercase hex.");
  }
}

function normalizePatch(patch: AdminPostPatch): AdminPostPatch {
  const normalized: AdminPostPatch = {};
  if (patch.content !== undefined) normalized.content = patch.content.trim();
  if (patch.submolt !== undefined) normalized.submolt = normalizeSubmolt(patch.submolt);
  if (patch.tags !== undefined) normalized.tags = normalizeTags(patch.tags);
  if (patch.deleted !== undefined) normalized.deleted = Boolean(patch.deleted);
  return normalized;
}

function validatePatch(patch: AdminPostPatch) {
  if (patch.content !== undefined && !patch.content) {
    throw new Error("content cannot be empty.");
  }
  if (patch.submolt !== undefined && patch.submolt && !isValidSubmolt(patch.submolt)) {
    throw new Error("Invalid submolt. Use lowercase letters, numbers, and hyphens.");
  }
}

export async function listAdminPosts(options?: { includeDeleted?: boolean }): Promise<AdminPostRecord[]> {
  const filePath = getStorePath();
  const store = await readStoreFile(filePath);
  const includeDeleted = Boolean(options?.includeDeleted);
  return Object.values(store.posts)
    .filter((post) => includeDeleted || !post.deleted)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getAdminPost(id: string): Promise<AdminPostRecord | null> {
  validateId(id);
  const filePath = getStorePath();
  const store = await readStoreFile(filePath);
  const key = id.trim().toLowerCase();
  return store.posts[key] ?? null;
}

export async function upsertAdminPost(input: AdminPostInput): Promise<AdminPostRecord> {
  const id = input.id.trim().toLowerCase();
  validateId(id);
  const patch = normalizePatch(input);
  validatePatch(patch);

  return withStoreWrite(async () => {
    const filePath = getStorePath();
    const store = await readStoreFile(filePath);
    const existing = store.posts[id];
    const now = new Date().toISOString();
    const updated: AdminPostRecord = {
      ...(existing ?? {}),
      id,
      ...patch,
      deleted: patch.deleted ?? existing?.deleted ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (!existing && updated.content === undefined && updated.submolt === undefined && updated.tags === undefined && !updated.deleted) {
      throw new Error("No moderation changes provided.");
    }

    store.posts[id] = updated;
    await writeStoreFile(filePath, store);
    return updated;
  });
}

export async function updateAdminPost(id: string, patch: AdminPostPatch): Promise<AdminPostRecord> {
  return upsertAdminPost({ id, ...patch });
}

/**
 * Drop this post's moderation record entirely.
 *
 * For use once the event itself is gone from the relay. A hide record left
 * behind would go on suppressing an id that no longer exists.
 */
export async function forgetAdminPost(id: string): Promise<void> {
  const key = id.trim().toLowerCase();
  validateId(key);

  return withStoreWrite(async () => {
    const filePath = getStorePath();
    const store = await readStoreFile(filePath);
    if (!store.posts[key]) return;
    delete store.posts[key];
    await writeStoreFile(filePath, store);
  });
}

export async function deleteAdminPost(id: string): Promise<AdminPostRecord> {
  const key = id.trim().toLowerCase();
  validateId(key);

  return withStoreWrite(async () => {
    const filePath = getStorePath();
    const store = await readStoreFile(filePath);
    const existing = store.posts[key];
    const now = new Date().toISOString();
    const updated: AdminPostRecord = {
      ...(existing ?? {}),
      id: key,
      deleted: true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    store.posts[key] = updated;
    await writeStoreFile(filePath, store);
    return updated;
  });
}
