import assert from "node:assert/strict";
import test from "node:test";
import {
  getLiveDataVersion,
  resetLiveData,
  subscribeLiveData,
} from "./live-data";

test("a failing live-data listener does not interrupt later listeners", () => {
  const calls: string[] = [];
  const originalError = console.error;
  console.error = () => {};

  const unsubscribeFailing = subscribeLiveData(() => {
    calls.push("failing");
    throw new Error("listener failure");
  });
  const unsubscribeHealthy = subscribeLiveData(() => {
    calls.push("healthy");
  });
  const previousVersion = getLiveDataVersion();

  try {
    assert.doesNotThrow(() => resetLiveData());
    assert.deepEqual(calls, ["failing", "healthy"]);
    assert.equal(getLiveDataVersion(), previousVersion + 1);
  } finally {
    unsubscribeFailing();
    unsubscribeHealthy();
    console.error = originalError;
  }
});

test("listeners added during notification wait for the next change", () => {
  const calls: string[] = [];
  let unsubscribeLate: (() => void) | undefined;
  const unsubscribeFirst = subscribeLiveData(() => {
    calls.push("first");
    unsubscribeLate ??= subscribeLiveData(() => calls.push("late"));
  });

  try {
    resetLiveData();
    assert.deepEqual(calls, ["first"]);

    resetLiveData();
    assert.deepEqual(calls, ["first", "first", "late"]);
  } finally {
    unsubscribeFirst();
    unsubscribeLate?.();
  }
});
