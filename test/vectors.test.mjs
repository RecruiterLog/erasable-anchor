// Fixed vectors.
//
// The other test files check that the library is internally consistent, which
// a subtly wrong implementation can also be. These check it against values
// frozen on disk, so a change to the hashing rules fails loudly instead of
// passing a self consistent suite.
//
// That distinction matters here more than usual: the roots are already
// published on Solana and cannot be reissued. If these assertions start
// failing, the correct response is almost never to regenerate the file.
//
// The same vectors are what a reimplementation in another language should
// check itself against. See scripts/make-vectors.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  canonicalJson,
  buildLeaf,
  hashPair,
  buildMerkleTree,
  merkleProof,
  verifyProof,
  formatMemo,
  parseMemo,
  LEAF_PREFIX,
  NODE_PREFIX,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(join(here, "vectors.json"), "utf8"));

test("the domain separation prefixes have not moved", () => {
  assert.equal(LEAF_PREFIX, vectors.prefixes.leaf);
  assert.equal(NODE_PREFIX, vectors.prefixes.node);
});

test("canonicalJson matches every recorded vector", () => {
  for (const c of vectors.canonicalJson) {
    assert.equal(canonicalJson(c.value), c.canonical, c.note);
  }
});

test("hashPair matches every recorded vector", () => {
  for (const c of vectors.hashPair) {
    assert.equal(hashPair(c.left, c.right), c.hash);
  }
});

test("buildLeaf matches every recorded vector", () => {
  for (const c of vectors.buildLeaf) {
    assert.equal(buildLeaf(c.facts, c.salt), c.leaf, c.note);
  }
});

test("reordering a fact's keys reaches the recorded leaf", () => {
  // Two vectors carry the same facts in different key orders and the same
  // salt, so they must share a leaf. If canonicalisation regressed, these
  // would diverge while every other assertion still passed.
  const [a, b] = vectors.buildLeaf.filter((c) => c.salt === "a".repeat(64));
  assert.equal(a.leaf, b.leaf);
  assert.equal(buildLeaf(a.facts, a.salt), buildLeaf(b.facts, b.salt));
});

test("every recorded tree rebuilds to its recorded root and shape", () => {
  for (const t of vectors.trees) {
    const levels = buildMerkleTree(t.leaves);
    assert.deepEqual(levels.map((l) => l.length), t.levelSizes, `size ${t.size} shape`);
    assert.equal(levels[levels.length - 1][0], t.root, `size ${t.size} root`);
  }
});

test("every recorded proof is reproduced and verifies", () => {
  for (const t of vectors.trees) {
    const levels = buildMerkleTree(t.leaves);
    for (let i = 0; i < t.leaves.length; i++) {
      assert.deepEqual(merkleProof(levels, i), t.proofs[i], `size ${t.size} leaf ${i}`);
      assert.equal(verifyProof(t.leaves[i], t.proofs[i], t.root), true, `size ${t.size} leaf ${i}`);
    }
  }
});

test("recorded memos round trip", () => {
  for (const memo of vectors.memos) {
    const parsed = parseMemo(memo);
    assert.ok(parsed, memo);
    assert.equal(formatMemo(parsed), memo);
  }
});
