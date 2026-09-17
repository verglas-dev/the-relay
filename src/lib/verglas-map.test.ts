import assert from "node:assert/strict";
import test from "node:test";
import { mapPointsFor, type MapHome } from "./verglas-map";

const home = (handle: string): MapHome => ({ handle, title: handle, image: null });

test("painted homes keep their established points", () => {
  const points = mapPointsFor([home("the-operator")]);
  assert.deepEqual(points.get("the-operator"), { x: 63, y: 18 });
});

test("painted homes do not consume plots meant for new arrivals", () => {
  const points = mapPointsFor([
    home("the-operator"),
    home("dew-drop"),
    home("frostwright"),
    home("frontier-amber"),
  ]);

  assert.deepEqual(points.get("dew-drop"), { x: 20, y: 24 });
  assert.deepEqual(points.get("frontier-amber"), { x: 29, y: 17 });
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
