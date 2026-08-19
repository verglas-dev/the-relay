import { promises as fs } from "fs";
import path from "path";
import {
  type AdminProfileInput,
  type AdminProfilePatch,
  type AdminProfileRecord,
  isValidPubkey,
  normalizeBadges,
} from "@/lib/admin-profiles";

interface AdminStoreFile {
  profiles: Record<string, AdminProfileRecord>;
}

const DEFAULT_STORE: AdminStoreFile = { profiles: {} };
let writeChain: Promise<void> = Promise.resolve();

function getStorePath(): string {
  const fromEnv = process.env.ADMIN_PROFILE_STORE_PATH?.trim();
  if (fromEnv) {
    // Runtime data is mounted separately in production; it is not a build input.
    return path.isAbsolute(fromEnv) ? fromEnv : path.join(/* turbopackIgnore: true */ process.cwd(), fromEnv);
  }
  return path.join(process.cwd(), "data", "admin-profiles.json");
}

async function ensureStoreFile(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(DEFAULT_STORE, null, 2), "utf8");
  }
}

async function readStoreFile(filePath: string): Promise<AdminStoreFile> {
  await ensureStoreFile(filePath);
  const raw = await fs.readFile(filePath, "utf8");
  try {
    const parsed = JSON.parse(raw) as Partial<AdminStoreFile>;
    return {
      profiles: parsed.profiles ?? {},
    };
  } catch {
    return { ...DEFAULT_STORE };
  }
}

async function writeStoreFile(filePath: string, data: AdminStoreFile): Promise<void> {
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

function normalizeInput(input: AdminProfileInput): AdminProfileInput {
  return {
    pubkey: input.pubkey.trim().toLowerCase(),
    displayName: input.displayName.trim(),
    bio: (input.bio ?? "").trim(),
    model: (input.model ?? "").trim(),
    verified: Boolean(input.verified),
    badges: normalizeBadges(input.badges),
    themeDisabled: Boolean(input.themeDisabled),
  };
}

function normalizePatch(patch: AdminProfilePatch): AdminProfilePatch {
  const normalized: AdminProfilePatch = {};
  if (patch.displayName !== undefined) normalized.displayName = patch.displayName.trim();
  if (patch.bio !== undefined) normalized.bio = patch.bio.trim();
  if (patch.model !== undefined) normalized.model = patch.model.trim();
  if (patch.verified !== undefined) normalized.verified = Boolean(patch.verified);
  if (patch.deleted !== undefined) normalized.deleted = Boolean(patch.deleted);
  if (patch.themeDisabled !== undefined) normalized.themeDisabled = Boolean(patch.themeDisabled);
  if (patch.badges !== undefined) normalized.badges = normalizeBadges(patch.badges);
  return normalized;
}

function validateCreate(input: AdminProfileInput) {
  if (!isValidPubkey(input.pubkey)) {
    throw new Error("Invalid pubkey. Expected 64-char lowercase hex.");
  }
  if (!input.displayName) {
    throw new Error("displayName is required.");
  }
}

function validatePubkey(pubkey: string) {
  if (!isValidPubkey(pubkey.trim().toLowerCase())) {
    throw new Error("Invalid pubkey. Expected 64-char lowercase hex.");
  }
}

function validatePatch(patch: AdminProfilePatch) {
  if (patch.displayName !== undefined && !patch.displayName) {
    throw new Error("displayName cannot be empty.");
  }
}

export async function listAdminProfiles(options?: { includeDeleted?: boolean }): Promise<AdminProfileRecord[]> {
  const filePath = getStorePath();
  const store = await readStoreFile(filePath);
  const includeDeleted = Boolean(options?.includeDeleted);
  return Object.values(store.profiles)
    .filter((profile) => includeDeleted || !profile.deleted)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getAdminProfile(pubkey: string): Promise<AdminProfileRecord | null> {
  validatePubkey(pubkey);
  const filePath = getStorePath();
  const store = await readStoreFile(filePath);
  const normalizedPubkey = pubkey.trim().toLowerCase();
  return store.profiles[normalizedPubkey] ?? null;
}

export async function createAdminProfile(input: AdminProfileInput): Promise<AdminProfileRecord> {
  const normalized = normalizeInput(input);
  validateCreate(normalized);

  return withStoreWrite(async () => {
    const filePath = getStorePath();
    const store = await readStoreFile(filePath);
    if (store.profiles[normalized.pubkey] && !store.profiles[normalized.pubkey].deleted) {
      throw new Error("Profile already exists.");
    }

    const now = new Date().toISOString();
    const record: AdminProfileRecord = {
      pubkey: normalized.pubkey,
      displayName: normalized.displayName,
      bio: normalized.bio ?? "",
      model: normalized.model ?? "",
      verified: Boolean(normalized.verified),
      badges: normalized.badges ?? [],
      deleted: false,
      themeDisabled: Boolean(normalized.themeDisabled),
      createdAt: store.profiles[normalized.pubkey]?.createdAt ?? now,
      updatedAt: now,
    };

    store.profiles[normalized.pubkey] = record;
    await writeStoreFile(filePath, store);
    return record;
  });
}

export async function updateAdminProfile(pubkey: string, patch: AdminProfilePatch): Promise<AdminProfileRecord> {
  validatePubkey(pubkey);
  const normalizedPatch = normalizePatch(patch);
  validatePatch(normalizedPatch);

  return withStoreWrite(async () => {
    const filePath = getStorePath();
    const store = await readStoreFile(filePath);
    const key = pubkey.trim().toLowerCase();
    const existing = store.profiles[key];

    // Allow creating an override on the fly (for relay-native profiles that
    // were never admin-managed before) as long as a displayName is given,
    // and allow patching a previously-hidden profile (e.g. to restore it
    // via { deleted: false }).
    if (!existing && normalizedPatch.displayName === undefined) {
      throw new Error("Profile not found.");
    }

    const now = new Date().toISOString();
    const updated: AdminProfileRecord = {
      pubkey: key,
      displayName: normalizedPatch.displayName ?? existing?.displayName ?? "",
      bio: normalizedPatch.bio ?? existing?.bio ?? "",
      model: normalizedPatch.model ?? existing?.model ?? "",
      verified: normalizedPatch.verified ?? existing?.verified ?? false,
      badges: normalizedPatch.badges ?? existing?.badges ?? [],
      deleted: normalizedPatch.deleted ?? existing?.deleted ?? false,
      themeDisabled: normalizedPatch.themeDisabled ?? existing?.themeDisabled ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    store.profiles[key] = updated;
    await writeStoreFile(filePath, store);
    return updated;
  });
}

/**
 * Drop a profile's record from this store entirely.
 *
 * For use once the underlying events are gone from the relay. The tombstone
 * `deleteAdminProfile` writes exists to hide a profile that still exists;
 * leaving one behind for a profile that has genuinely been removed would keep
 * a "Deleted profile" entry in the member list forever, naming a key with
 * nothing left behind it.
 */
export async function forgetAdminProfile(pubkey: string): Promise<void> {
  validatePubkey(pubkey);
  return withStoreWrite(async () => {
    const filePath = getStorePath();
    const store = await readStoreFile(filePath);
    const key = pubkey.trim().toLowerCase();
    if (!store.profiles[key]) return;
    delete store.profiles[key];
    await writeStoreFile(filePath, store);
  });
}

export async function deleteAdminProfile(pubkey: string): Promise<AdminProfileRecord> {
  validatePubkey(pubkey);
  return withStoreWrite(async () => {
    const filePath = getStorePath();
    const store = await readStoreFile(filePath);
    const key = pubkey.trim().toLowerCase();
    const existing = store.profiles[key];

    // Allow deleting any valid pubkey, even if it was never admin-managed.
    // This lets admins hide relay-native profiles (for example duplicates)
    // without creating an override first.
    if (!existing) {
      const now = new Date().toISOString();
      const tombstone: AdminProfileRecord = {
        pubkey: key,
        displayName: "Deleted profile",
        bio: "",
        model: "",
        verified: false,
        badges: [],
        deleted: true,
        themeDisabled: false,
        createdAt: now,
        updatedAt: now,
      };
      store.profiles[key] = tombstone;
      await writeStoreFile(filePath, store);
      return tombstone;
    }

    if (existing.deleted) {
      return existing;
    }

    const updated: AdminProfileRecord = {
      ...existing,
      deleted: true,
      updatedAt: new Date().toISOString(),
    };

    store.profiles[key] = updated;
    await writeStoreFile(filePath, store);
    return updated;
  });
}
