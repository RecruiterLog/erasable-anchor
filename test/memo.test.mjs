import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMemo, parseMemo } from "../dist/index.js";

const ROOT = "f".repeat(64);

test("formats and parses back to the same values", () => {
  const memo = formatMemo({ prefix: "rl", version: 1, period: "2026-09-08", root: ROOT });
  assert.equal(memo, `rl:v1:2026-09-08:${ROOT}`);
  assert.deepEqual(parseMemo(memo), {
    prefix: "rl",
    version: 1,
    period: "2026-09-08",
    root: ROOT,
  });
});

test("rejects malformed inputs at format time", () => {
  const ok = { prefix: "rl", version: 1, period: "2026-09-08", root: ROOT };
  assert.throws(() => formatMemo({ ...ok, prefix: "RL" }), /prefix/);
  assert.throws(() => formatMemo({ ...ok, prefix: "" }), /prefix/);
  assert.throws(() => formatMemo({ ...ok, version: 0 }), /version/);
  assert.throws(() => formatMemo({ ...ok, version: 1.5 }), /version/);
  assert.throws(() => formatMemo({ ...ok, period: "2026/09/08" }), /period/);
  assert.throws(() => formatMemo({ ...ok, root: "abc" }), /root/);
  assert.throws(() => formatMemo({ ...ok, root: ROOT.toUpperCase() }), /root/);
});

test("returns null for anything that is not a memo", () => {
  // The normal use is sifting a transaction's logs, where most lines
  // legitimately are not anchors, so this must not throw.
  assert.equal(parseMemo("Program log: hello"), null);
  assert.equal(parseMemo(""), null);
  assert.equal(parseMemo(`rl:v1:2026-09-08:${ROOT}extra`), null);
  assert.equal(parseMemo(`rl:1:2026-09-08:${ROOT}`), null);
});

test("an expected prefix excludes another system's memo", () => {
  const mine = formatMemo({ prefix: "rl", version: 1, period: "2026-09-08", root: ROOT });
  const theirs = formatMemo({ prefix: "other", version: 1, period: "2026-09-08", root: ROOT });

  assert.ok(parseMemo(mine, "rl"));
  assert.equal(parseMemo(theirs, "rl"), null);
  // Without the filter, a memo from an unrelated system that happens to share
  // this format parses perfectly well.
  assert.ok(parseMemo(theirs));
});

test("a prefix containing regex metacharacters is treated literally", () => {
  assert.equal(parseMemo(`rl:v1:2026-09-08:${ROOT}`, "r."), null);
});

test("carries a version so a format change is distinguishable from tampering", () => {
  const v2 = formatMemo({ prefix: "rl", version: 2, period: "2026-09-08", root: ROOT });
  assert.equal(parseMemo(v2).version, 2);
});
