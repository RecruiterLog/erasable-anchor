import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLeaf, hashPair, makeSalt, LEAF_PREFIX, NODE_PREFIX } from "../dist/index.js";

const FACTS = { recordId: "r1", status: "Closed/Resolved", responseTimeDays: 4 };
const SALT = "a".repeat(64);

test("a leaf is 64 lowercase hex characters", () => {
  assert.match(buildLeaf(FACTS, SALT), /^[0-9a-f]{64}$/);
});

test("the same facts and salt always give the same leaf", () => {
  assert.equal(buildLeaf(FACTS, SALT), buildLeaf({ ...FACTS }, SALT));
});

test("fact key order does not change the leaf", () => {
  const reordered = { responseTimeDays: 4, status: "Closed/Resolved", recordId: "r1" };
  assert.equal(buildLeaf(FACTS, SALT), buildLeaf(reordered, SALT));
});

test("changing any fact changes the leaf", () => {
  const base = buildLeaf(FACTS, SALT);
  assert.notEqual(base, buildLeaf({ ...FACTS, responseTimeDays: 5 }, SALT));
  assert.notEqual(base, buildLeaf({ ...FACTS, status: "Ghosted" }, SALT));
  assert.notEqual(base, buildLeaf({ ...FACTS, extra: null }, SALT));
});

test("changing the salt changes the leaf", () => {
  assert.notEqual(buildLeaf(FACTS, SALT), buildLeaf(FACTS, "b".repeat(64)));
});

test("facts carrying their own salt key are rejected, not silently overwritten", () => {
  assert.throws(() => buildLeaf({ ...FACTS, salt: "mine" }, SALT), /must not contain/);
});

test("facts must be a plain object", () => {
  assert.throws(() => buildLeaf(null, SALT), /plain object/);
  assert.throws(() => buildLeaf([1, 2], SALT), /plain object/);
  assert.throws(() => buildLeaf("x", SALT), /plain object/);
});

test("an empty or missing salt is rejected", () => {
  // A silently empty salt would produce a leaf with no erasure property at
  // all, and it would still look like a valid hash.
  assert.throws(() => buildLeaf(FACTS, ""), /non-empty string/);
  assert.throws(() => buildLeaf(FACTS, undefined), /non-empty string/);
});

test("salts are 32 bytes and do not repeat", () => {
  const salts = new Set();
  for (let i = 0; i < 500; i++) {
    const s = makeSalt();
    assert.match(s, /^[0-9a-f]{64}$/);
    salts.add(s);
  }
  assert.equal(salts.size, 500);
});

test("domain separation: leaves and nodes are hashed under different prefixes", () => {
  assert.notEqual(LEAF_PREFIX, NODE_PREFIX);

  // The attack this prevents: presenting an internal node as though it were an
  // anchored record. If both were hashed the same way, a holder of a valid
  // proof could claim an intermediate hash was itself a record.
  const l = "1".repeat(64);
  const r = "2".repeat(64);
  const node = hashPair(l, r);
  assert.match(node, /^[0-9a-f]{64}$/);
  assert.notEqual(node, buildLeaf({ a: l, b: r }, SALT));
});

test("hashPair is order sensitive", () => {
  const l = "1".repeat(64);
  const r = "2".repeat(64);
  assert.notEqual(hashPair(l, r), hashPair(r, l));
});
