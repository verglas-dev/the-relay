import { promises as fs } from "fs";
import path from "path";
import type { MapHome, MapPatch, MapPatchRect, MapPoint } from "@/lib/verglas-map";

/**
 * The expanding part of the town map.
 *
 * The first eleven houses live in the immutable base painting. Every later
 * house is a small WebP layer and one record in this ledger. Both live on the
 * persistent /data volume in Docker, so publishing a new application image
 * never bulldozes the town.
 */

export interface ReadyMapPatchRecord {
  source: string;
  file: string;
  builtAt: string;
  revision: string;
  title: string;
}

export interface MapPatchAttempt {
  source: string;
  status: "building" | "failed";
  at: string;
  error?: string;
}

export interface MapPatchRecord {
  handle: string;
  point: MapPoint;
  crop: MapPatchRect;
  ready?: ReadyMapPatchRecord;
  attempt?: MapPatchAttempt;
}

interface MapPatchFile {
  version: 1;
  patches: Record<string, MapPatchRecord>;
}

const HANDLE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ASSET = /^[a-z0-9-]+-[a-f0-9]{12}\.webp$/;
const REVISION = /^[a-f0-9]{12}$/;
let writeChain: Promise<void> = Promise.resolve();

function storePath(): string {
  const configured = process.env.VERGLAS_MAP_STORE_PATH?.trim();
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.join(/* turbopackIgnore: true */ process.cwd(), configured);
  }
  return path.join(process.cwd(), "data", "verglas-map-patches.json");
}

export function mapPatchDirectory(): string {
  const configured = process.env.VERGLAS_MAP_PATCH_DIR?.trim();
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.join(/* turbopackIgnore: true */ process.cwd(), configured);
  }
  return path.join(path.dirname(storePath()), "verglas-map-patches");
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseRecord(value: unknown): MapPatchRecord | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<MapPatchRecord>;
  if (!candidate.handle || !HANDLE.test(candidate.handle)) return null;
  if (!candidate.point || !finite(candidate.point.x) || !finite(candidate.point.y)) return null;
  if (
    !candidate.crop ||
    !finite(candidate.crop.left) ||
    !finite(candidate.crop.top) ||
    !finite(candidate.crop.width) ||
    !finite(candidate.crop.height)
  ) return null;

  const record: MapPatchRecord = {
    handle: candidate.handle,
    point: candidate.point,
    crop: candidate.crop,
  };
  const ready = candidate.ready;
  if (
    ready &&
    typeof ready.source === "string" &&
    typeof ready.file === "string" &&
    ASSET.test(ready.file) &&
    typeof ready.builtAt === "string" &&
    Number.isFinite(Date.parse(ready.builtAt)) &&
    typeof ready.revision === "string" &&
    REVISION.test(ready.revision) &&
    ready.file === `${candidate.handle}-${ready.revision}.webp` &&
    typeof ready.title === "string"
  ) record.ready = ready;

  const attempt = candidate.attempt;
  if (
    attempt &&
    typeof attempt.source === "string" &&
    (attempt.status === "building" || attempt.status === "failed") &&
    typeof attempt.at === "string"
  ) {
    record.attempt = {
      source: attempt.source,
      status: attempt.status,
      at: attempt.at,
      ...(typeof attempt.error === "string" ? { error: attempt.error } : {}),
    };
  }
  return record;
}

async function readFile(): Promise<MapPatchFile> {
  const file = storePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    const parsed = JSON.parse(
      await fs.readFile(/* turbopackIgnore: true */ file, "utf8"),
    ) as Partial<MapPatchFile>;
    const patches: Record<string, MapPatchRecord> = {};
    if (parsed.patches && typeof parsed.patches === "object") {
      for (const value of Object.values(parsed.patches)) {
        const record = parseRecord(value);
        if (record) patches[record.handle] = record;
      }
    }
    return { version: 1, patches };
  } catch {
    return { version: 1, patches: {} };
  }
}

async function writeFile(data: MapPatchFile): Promise<void> {
  const file = storePath();
  const temp = `${file}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(temp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(temp, file);
}

async function withWrite<T>(fn: (data: MapPatchFile) => Promise<T>): Promise<T> {
  const run = writeChain.then(async () => {
    const data = await readFile();
    const result = await fn(data);
    await writeFile(data);
    return result;
  });
  writeChain = run.then(() => undefined, () => undefined);
  return run;
}

function publicPatch(record: MapPatchRecord, title?: string): MapPatch | null {
  if (!record.ready) return null;
  return {
    handle: record.handle,
    title: title ?? record.ready.title,
    point: record.point,
    crop: record.crop,
    builtAt: record.ready.builtAt,
    revision: record.ready.revision,
    url: `/api/verglas/map/${record.handle}?v=${record.ready.revision}`,
  };
}

export async function readMapPatchRecords(): Promise<Record<string, MapPatchRecord>> {
  return (await readFile()).patches;
}

/** Only completed pixels cross this boundary; attempts never become placeholders. */
export async function readReadyMapPatches(homes?: readonly MapHome[]): Promise<MapPatch[]> {
  const records = Object.values((await readFile()).patches);
  const titles = new Map(homes?.map((home) => [home.handle, home.title]));
  const allowed = homes ? new Set(homes.map((home) => home.handle)) : null;
  return records.flatMap((record) => {
    if (allowed && !allowed.has(record.handle)) return [];
    const patch = publicPatch(record, titles.get(record.handle));
    return patch ? [patch] : [];
  });
}

export async function beginMapPatch(
  record: Omit<MapPatchRecord, "ready" | "attempt">,
  source: string,
): Promise<void> {
  await withWrite(async (data) => {
    const previous = data.patches[record.handle];
    data.patches[record.handle] = {
      ...record,
      ...(previous?.ready ? { ready: previous.ready } : {}),
      attempt: { source, status: "building", at: new Date().toISOString() },
    };
  });
}

export async function finishMapPatch(input: {
  handle: string;
  title: string;
  source: string;
  point: MapPoint;
  crop: MapPatchRect;
  file: string;
  revision: string;
}): Promise<void> {
  if (!ASSET.test(input.file)) throw new Error("Refusing an unsafe map patch filename.");
  await withWrite(async (data) => {
    data.patches[input.handle] = {
      handle: input.handle,
      point: input.point,
      crop: input.crop,
      ready: {
        source: input.source,
        file: input.file,
        title: input.title,
        revision: input.revision,
        builtAt: new Date().toISOString(),
      },
    };
  });
}

export async function failMapPatch(input: {
  handle: string;
  source: string;
  point: MapPoint;
  crop: MapPatchRect;
  error: string;
}): Promise<void> {
  await withWrite(async (data) => {
    const previous = data.patches[input.handle];
    data.patches[input.handle] = {
      handle: input.handle,
      point: input.point,
      crop: input.crop,
      ...(previous?.ready ? { ready: previous.ready } : {}),
      attempt: {
        source: input.source,
        status: "failed",
        at: new Date().toISOString(),
        error: input.error.slice(0, 500),
      },
    };
  });
}

export async function mapPatchAsset(handle: string): Promise<{
  path: string;
  revision: string;
  builtAt: string;
} | null> {
  if (!HANDLE.test(handle)) return null;
  const record = (await readFile()).patches[handle];
  if (!record?.ready || !ASSET.test(record.ready.file)) return null;
  return {
    path: path.join(mapPatchDirectory(), record.ready.file),
    revision: record.ready.revision,
    builtAt: record.ready.builtAt,
  };
}

/** Existing layers are folded into later plot crops so neighboring roofs agree. */
export async function readyMapPatchAssets(): Promise<Array<{
  path: string;
  crop: MapPatchRect;
}>> {
  return Object.values((await readFile()).patches).flatMap((record) =>
    record.ready && ASSET.test(record.ready.file)
      ? [{ path: path.join(mapPatchDirectory(), record.ready.file), crop: record.crop }]
      : [],
  );
}
