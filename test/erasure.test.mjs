// The property the library exists for.
//
// An anchor is supposed to be permanent, and an erasure request is supposed to
// be honoured. Those sound mutually exclusive, and the usual reading is that
// publishing a hash of personal data to an immutable ledger is itself the
// processing you can no longer undo.
//
// The way out is that the leaf commits to facts AND to a high entropy salt
// held only beside the record. Delete the record and the salt goes with it.
// The leaf stays on chain, but it is now a 32 byte number that cannot be
// connected to a person, or even shown to relate to a record that once
// existed. The tree is untouched, so every other proof still verifies.
//
// These tests exercise both halves of that claim.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLeaf,
  makeSalt,
  sortLeaves,
  buildMerkleTree,
  merkleProof,
  verifyProof,
} from "../dist/index.js";

/** A batch as it would exist in a database: facts and a salt, per record. */
function makeBatch(n) {
  const records = Array.from({ length: n }, (_, i) => ({
    facts: { recordId: `r${i}`, companyId: `c${i % 3}`, status: "Closed/Resolved" },
    salt: makeSalt(),
  }));
  for (const r of records) r.leaf = buildLeaf(r.facts, r.salt);

  const leaves = sortLeaves(records.map((r) => r.leaf));
  const levels = buildMerkleTree(leaves);
  return { records, leaves, levels, root: levels[levels.length - 1][0] };
}

test("erasing one record leaves every other proof intact", () => {
  const batch = makeBatch(10);
  const erased = batch.records[4];

  // The erasure itself: the row and its salt are gone. Nothing else changes,
  // and in particular the published root is not recomputed or reissued.
  delete erased.facts;
  delete erased.salt;

  for (const r of batch.records) {
    if (!r.salt) continue;
    const index = batch.leaves.indexOf(r.leaf);
    const proof = merkleProof(batch.levels, index);
    assert.equal(
      verifyProof(buildLeaf(r.facts, r.salt), proof, batch.root),
      true,
      `record ${r.facts.recordId} should still verify after an unrelated erasure`
    );
  }
});

test("the erased leaf is still in the tree, and now means nothing", () => {
  const batch = makeBatch(10);
  const erased = batch.records[4];
  const orphanedLeaf = erased.leaf;
  const factsWeSomehowStillKnow = { ...erased.facts };

  delete erased.facts;
  delete erased.salt;

  // The tree is genuinely unchanged: the leaf is still there and still proves
  // its membership. That is what keeps the anchor honest.
  assert.ok(batch.leaves.includes(orphanedLeaf));
  const proof = merkleProof(batch.levels, batch.leaves.indexOf(orphanedLeaf));
  assert.equal(verifyProof(orphanedLeaf, proof, batch.root), true);

  // But knowing the facts is no longer enough to tie them to that leaf. An
  // adversary who kept a copy of the record cannot demonstrate it was the one
  // anchored, because they cannot produce the salt.
  for (let attempt = 0; attempt < 1000; attempt++) {
    assert.notEqual(buildLeaf(factsWeSomehowStillKnow, makeSalt()), orphanedLeaf);
  }
  // 1000 attempts is not a proof of impossibility; it is a demonstration of
  // the shape. The real argument is the search space: the salt is 32 bytes,
  // so there are 2^256 candidates and no way to test one without the leaf.
});

test("erasing most of a batch does not disturb the survivors", () => {
  const batch = makeBatch(16);
  for (const i of [0, 1, 3, 5, 8, 9, 11, 12, 13, 15]) {
    delete batch.records[i].facts;
    delete batch.records[i].salt;
  }

  const survivors = batch.records.filter((r) => r.salt);
  assert.equal(survivors.length, 6);
  for (const r of survivors) {
    const proof = merkleProof(batch.levels, batch.leaves.indexOf(r.leaf));
    assert.equal(verifyProof(buildLeaf(r.facts, r.salt), proof, batch.root), true);
  }
});

test("two records with identical facts still get distinct leaves", () => {
  // Without a per record salt these would collide, and one erasure would take
  // both records' proofs with it.
  const facts = { recordId: "same", companyId: "c1", status: "Ghosted" };
  assert.notEqual(buildLeaf(facts, makeSalt()), buildLeaf(facts, makeSalt()));
});

test("a salt is not a secret from the verifier, only from the future", () => {
  // The salt is published with the proof, because a verifier cannot recompute
  // the leaf without it. This test states that plainly so nobody later
  // "fixes" the API by hiding it.
  const facts = { recordId: "r1" };
  const salt = makeSalt();
  const leaf = buildLeaf(facts, salt);

  // Anyone holding both can verify. That is the intended state before erasure.
  assert.equal(buildLeaf(facts, salt), leaf);
});
