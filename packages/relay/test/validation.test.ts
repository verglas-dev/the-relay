import assert from "node:assert/strict";
import { test } from "node:test";
import { validateFilters } from "../src/validation.js";

const id = (value: number) => value.toString(16).padStart(64, "0");

function assertInvalid(
  filters: unknown[],
  options?: { maxFilters?: number; maxLimit?: number; maxValues?: number },
): void {
  const error = validateFilters(filters, options);
  assert.equal(typeof error, "string");
  assert.notEqual(error, "");
}

test("validateFilters accepts protocol fields and custom tag filters", () => {
  const filters = [
    {
      ids: [id(1)],
      authors: [id(2)],
      kinds: [0, 1, 65535],
      since: 0,
      until: 2_000_000_000,
      limit: 200,
      "#m": ["general"],
      "#e": [id(3)],
    },
    {
      limit: 1,
      "#custom": ["one"],
    },
  ];

  assert.equal(
    validateFilters(filters, { maxFilters: 2, maxLimit: 200, maxValues: 8 }),
    null,
  );
});

test("validateFilters rejects malformed filter containers and unknown fields", () => {
  assertInvalid([]);
  assertInvalid([null]);
  assertInvalid(["not-an-object"]);
  assertInvalid([[]]);
  assertInvalid([{ search: "general" }]);
  assertInvalid([{ m: ["general"] }]);
});

test("validateFilters rejects malformed list fields and list elements", () => {
  assertInvalid([{ ids: id(1) }]);
  assertInvalid([{ ids: [id(1), 2] }]);
  assertInvalid([{ authors: { value: id(1) } }]);
  assertInvalid([{ authors: [null] }]);
  assertInvalid([{ kinds: 1 }]);
  assertInvalid([{ kinds: [1, "2"] }]);
  assertInvalid([{ kinds: [1.5] }]);
  assertInvalid([{ kinds: [-1] }]);
  assertInvalid([{ "#m": "general" }]);
  assertInvalid([{ "#m": ["general", 2] }]);
});

test("validateFilters rejects malformed timestamps and limits", () => {
  assertInvalid([{ since: "0" }]);
  assertInvalid([{ since: -1 }]);
  assertInvalid([{ since: 1.5 }]);
  assertInvalid([{ until: null }]);
  assertInvalid([{ until: Number.POSITIVE_INFINITY }]);
  assertInvalid([{ limit: "20" }]);
  assertInvalid([{ limit: 0 }]);
  assertInvalid([{ limit: -1 }]);
  assertInvalid([{ limit: 1.5 }]);
});

test("validateFilters enforces configured filter and result limits at the boundary", () => {
  assert.equal(
    validateFilters([{ kinds: [1], limit: 20 }], { maxFilters: 1, maxLimit: 20 }),
    null,
  );
  assertInvalid([{ kinds: [1] }, { kinds: [2] }], { maxFilters: 1 });
  assertInvalid([{ kinds: [1], limit: 21 }], { maxLimit: 20 });
});

test("validateFilters enforces maxValues across fields and filters", () => {
  const atCap = [
    { ids: [id(1), id(2)], kinds: [1], "#m": ["general"] },
    { authors: [id(3)] },
  ];
  assert.equal(validateFilters(atCap, { maxValues: 5 }), null);

  const overCap = [
    { ids: [id(1), id(2)], kinds: [1], "#m": ["general"] },
    { authors: [id(3)], "#p": [id(4)] },
  ];
  assertInvalid(overCap, { maxValues: 5 });
});
