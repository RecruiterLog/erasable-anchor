import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLeaf,
  makeSalt,
  sortLeaves,
  buildMerkleTree,
  merkleRoot,
  merkleProof,
  verifyProof,
} from "../dist/index.js";

function leaves(n) {
  return sortLeaves(
    Array.from({ length: n }, (_, i) => buildLeaf({ recordId: `r${i}` }, makeSalt()))
  );
}

test("a single leaf is its own root", () => {
  const [only] = leaves(1);
  assert.equal(merkleRoot([only]), only);
  assert.deepEqual(merkleProof(buildMerkleTree([only]), 0), []);
});

test("refuses to build a tree with no leaves", () => {
  // An empty root would be a fixed constant, and publishing it would assert
  // that a batch was anchored when nothing was.
  assert.throws(() => buildMerkleTree([]), /no leaves/);
  assert.throws(() => merkleRoot([]), /no leaves/);
});

test("every leaf verifies, at every tree size from 1 to 33", () => {
  // 33 is deliberate: it exercises odd counts at several levels at once,
  // which is where the duplicate-last rule actually bites.
  for (let n = 1; n <= 33; n++) {
    const ls = leaves(n);
    const levels = buildMerkleTree(ls);
    const root = levels[levels.length - 1][0];
    for (let i = 0; i < n; i++) {
      const proof = merkleProof(levels, i);
      assert.equal(verifyProof(ls[i], proof, root), true, `size ${n}, leaf ${i}`);
    }
  }
});

test("a tampered leaf fails against a real proof", () => {
  const ls = leaves(8);
  const levels = buildMerkleTree(ls);
  const root = levels[levels.length - 1][0];
  const proof = merkleProof(levels, 3);

  const tampered = buildLeaf({ recordId: "r3", tampered: true }, makeSalt());
  assert.equal(verifyProof(tampered, proof, root), false);
});

test("a proof from the wrong leaf fails", () => {
  const ls = leaves(8);
  const levels = buildMerkleTree(ls);
  const root = levels[levels.length - 1][0];
  assert.equal(verifyProof(ls[2], merkleProof(levels, 5), root), false);
});

test("flipping a step's position breaks the proof", () => {
  // The failure mode this guards: a proof that is structurally well formed and
  // never verifies, because the sibling side was derived rather than recorded.
  const ls = leaves(8);
  const levels = buildMerkleTree(ls);
  const root = levels[levels.length - 1][0];
  const proof = merkleProof(levels, 1);
  const flipped = proof.map((s) => ({ ...s, position: s.position === "left" ? "right" : "left" }));
  assert.equal(verifyProof(ls[1], flipped, root), false);
});

test("the root depends on the whole set, not just its size", () => {
  assert.notEqual(merkleRoot(leaves(4)), merkleRoot(leaves(4)));
});

test("sortLeaves is stable, total, and does not mutate its input", () => {
  const input = ["c", "a", "b"];
  const copy = [...input];
  assert.deepEqual(sortLeaves(input), ["a", "b", "c"]);
  assert.deepEqual(input, copy);
  // Order must be a property of the set alone, so any permutation sorts the
  // same and therefore yields the same root.
  assert.equal(merkleRoot(sortLeaves(["c", "a", "b"].map((x) => x.repeat(64)))),
               merkleRoot(sortLeaves(["b", "c", "a"].map((x) => x.repeat(64)))));
});

test("an out of range leaf index throws", () => {
  const levels = buildMerkleTree(leaves(4));
  assert.throws(() => merkleProof(levels, -1), /out of range/);
  assert.throws(() => merkleProof(levels, 4), /out of range/);
});

test("proof length grows logarithmically", () => {
  assert.equal(merkleProof(buildMerkleTree(leaves(8)), 0).length, 3);
  assert.equal(merkleProof(buildMerkleTree(leaves(16)), 0).length, 4);
  assert.equal(merkleProof(buildMerkleTree(leaves(1024)), 0).length, 10);
});
