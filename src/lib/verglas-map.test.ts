import assert from "node:assert/strict";
import test from "node:test";
import {
  hasMapArtwork,
  mapPatchCrop,
  mapPointsFor,
  type MapHome,
  type MapPatch,
} from "./verglas-map";

const home = (handle: string): MapHome => ({ handle, title: handle, image: null });

test("painted homes keep their established points", () => {
  const points = mapPointsFor([home("the-operator")]);
  assert.deepEqual(points.get("the-operator"), { x: 63, y: 18 });
});

test("newly painted homes keep their commissioned points", () => {
  const points = mapPointsFor([
    home("the-operator"),
    home("dew-drop"),
    home("frostwright"),
    home("frontier-amber"),
  ]);

  assert.deepEqual(points.get("dew-drop"), { x: 14.5, y: 26.5 });
  assert.deepEqual(points.get("frontier-amber"), { x: 30.5, y: 19.5 });
});

test("painted homes do not consume plots surveyed for later commissions", () => {
  const points = mapPointsFor([
    home("the-operator"),
    home("dew-drop"),
    home("frontier-amber"),
    home("new-neighbour"),
  ]);

  assert.deepEqual(points.get("new-neighbour"), { x: 78, y: 20 });
});

test("the map keeps placing residents after every surveyed plot is occupied", () => {
  const homes = Array.from({ length: 40 }, (_, index) => home(`new-neighbour-${index}`));
  const first = mapPointsFor(homes);
  const second = mapPointsFor(homes);

  assert.equal(first.size, homes.length);
  assert.deepEqual([...first], [...second]);
  for (const point of first.values()) {
    assert.ok(point.x >= 11 && point.x <= 89);
    assert.ok(point.y >= 15 && point.y <= 86);
  }
});

test("a generated plot is resident-sized and remains inside the base painting", () => {
  assert.deepEqual(mapPatchCrop({ x: 50, y: 50 }), {
    left: 576,
    top: 320,
    width: 384,
    height: 384,
  });
  assert.deepEqual(mapPatchCrop({ x: 99, y: 99 }), {
    left: 1152,
    top: 640,
    width: 384,
    height: 384,
  });
});

test("only baked or completed patch homes count as artwork", () => {
  const patch: MapPatch = {
    handle: "new-neighbour",
    title: "A New Home",
    point: { x: 78, y: 20 },
    crop: mapPatchCrop({ x: 78, y: 20 }),
    builtAt: "2026-09-18T00:00:00.000Z",
    revision: "123456789abc",
    url: "/api/verglas/map/new-neighbour?v=123456789abc",
  };
  assert.equal(hasMapArtwork("the-operator", []), true);
  assert.equal(hasMapArtwork("new-neighbour", []), false);
  assert.equal(hasMapArtwork("new-neighbour", [patch]), true);
});
