import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mapPatchCrop } from "./verglas-map";
import {
  beginMapPatch,
  failMapPatch,
  finishMapPatch,
  mapPatchAsset,
  readReadyMapPatches,
} from "./verglas-map-store";

test("a map patch appears only when complete and survives a failed replacement", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "verglas-map-store-"));
  const previousStore = process.env.VERGLAS_MAP_STORE_PATH;
  const previousPatches = process.env.VERGLAS_MAP_PATCH_DIR;
  process.env.VERGLAS_MAP_STORE_PATH = path.join(directory, "ledger.json");
  process.env.VERGLAS_MAP_PATCH_DIR = path.join(directory, "patches");
  t.after(async () => {
    if (previousStore === undefined) delete process.env.VERGLAS_MAP_STORE_PATH;
    else process.env.VERGLAS_MAP_STORE_PATH = previousStore;
    if (previousPatches === undefined) delete process.env.VERGLAS_MAP_PATCH_DIR;
    else process.env.VERGLAS_MAP_PATCH_DIR = previousPatches;
    await fs.rm(directory, { recursive: true, force: true });
  });

  const point = { x: 78, y: 20 };
  const crop = mapPatchCrop(point);
  await beginMapPatch({ handle: "new-neighbour", point, crop }, "source-one");
  assert.deepEqual(await readReadyMapPatches(), []);

  await finishMapPatch({
    handle: "new-neighbour",
    title: "The New House",
    source: "source-one",
    point,
    crop,
    file: "new-neighbour-123456789abc.webp",
    revision: "123456789abc",
  });
  const [ready] = await readReadyMapPatches();
  assert.equal(ready.title, "The New House");
  assert.equal(ready.url, "/api/verglas/map/new-neighbour?v=123456789abc");
  assert.equal((await mapPatchAsset("new-neighbour"))?.path, path.join(directory, "patches", "new-neighbour-123456789abc.webp"));

  await failMapPatch({ handle: "new-neighbour", source: "source-two", point, crop, error: "not quite" });
  assert.equal((await readReadyMapPatches()).length, 1);
});
