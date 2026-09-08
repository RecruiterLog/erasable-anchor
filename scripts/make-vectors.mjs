#!/usr/bin/env node
//
// Regenerate test/vectors.json.
//
//   node scripts/make-vectors.mjs           print to stdout
//   node scripts/make-vectors.mjs --write   overwrite test/vectors.json
//
// The vectors exist so that a reimplementation in another language can check
// itself against fixed, known values without having to run this one. Every
// salt below is a fixed constant rather than a fresh random one, because a
// vector that changes on each run is not a vector.
//
// Regenerating these deliberately changes what the test suite asserts. If a
// diff to vectors.json was not intended, the hashing rules have moved and
// every anchor already published under the old rules is now unverifiable.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  canonicalJson,
  buildLeaf,
  hashPair,
  sortLeaves,
  buildMerkleTree,
  merkleProof,
  formatMemo,
} from "../dist/index.js";

const salt = (byte) => byte.repeat(64);

const canonicalCases = [
  { note: "key order is irrelevant", value: { b: 1, a: 2 } },
  { note: "nested sorting", value: { outer: { z: 1, a: 2 }, first: true } },
  // No `undefined` case here: JSON.stringify drops undefined properties, so a
  // vector containing one would be stored as a different object than the one
  // whose canonical form was recorded, and could never reproduce it. That
  // behaviour is covered in test/canonical.test.mjs instead, where the input
  // never leaves the process.
  { note: "explicit null, and falsy values that are not null", value: { a: null, b: 0, c: false, d: "" } },
  { note: "array order is preserved", value: [3, 1, 2] },
  { note: "escaping", value: { 'a"b': 'c\\d' } },
  { note: "a realistic conduct record", value: {
      v: 1,
      recordId: "9f1c2e40-0000-4000-8000-000000000001",
      companyId: "c-0001",
      recruiterRef: null,
      role: "Backend Engineer",
      status: "Closed/Resolved",
      responseTimeDays: 4,
      isGhosted: false,
      everBreached: false,
      createdAt: "2026-08-01T09:15:00.000Z",
    } },
];

const leafCases = [
  { note: "minimal", facts: { recordId: "r1" }, salt: salt("0") },
  { note: "same facts, different salt", facts: { recordId: "r1" }, salt: salt("1") },
  { note: "reordered keys must match the sorted case above", facts: { b: 2, a: 1 }, salt: salt("a") },
  { note: "sorted keys", facts: { a: 1, b: 2 }, salt: salt("a") },
  {
    note: "a realistic conduct record",
    facts: {
      v: 1,
      recordId: "9f1c2e40-0000-4000-8000-000000000001",
      companyId: "c-0001",
      recruiterRef: null,
      role: "Backend Engineer",
      status: "Closed/Resolved",
      responseTimeDays: 4,
      isGhosted: false,
      everBreached: false,
      createdAt: "2026-08-01T09:15:00.000Z",
    },
    salt: "3b1f8d2c4a6e908172635445362718091a2b3c4d5e6f708192a3b4c5d6e7f809",
  },
];

// Fixed leaves, so the trees are reproducible. These are not real hashes of
// anything; they are hex strings chosen to exercise ordering and odd counts.
const treeSizes = [1, 2, 3, 4, 5, 8, 9, 33];
const syntheticLeaf = (i) => i.toString(16).padStart(2, "0").repeat(32);

const vectors = {
  note:
    "Fixed vectors for erasable-anchor. Regenerate with scripts/make-vectors.mjs. " +
    "A change here means the hashing rules changed and previously published anchors " +
    "can no longer be verified.",
  prefixes: { leaf: 0, node: 1 },
  canonicalJson: canonicalCases.map((c) => ({ ...c, canonical: canonicalJson(c.value) })),
  hashPair: [
    { left: syntheticLeaf(1), right: syntheticLeaf(2), hash: hashPair(syntheticLeaf(1), syntheticLeaf(2)) },
    { left: syntheticLeaf(2), right: syntheticLeaf(1), hash: hashPair(syntheticLeaf(2), syntheticLeaf(1)) },
  ],
  buildLeaf: leafCases.map((c) => ({ ...c, leaf: buildLeaf(c.facts, c.salt) })),
  trees: treeSizes.map((n) => {
    const leaves = sortLeaves(Array.from({ length: n }, (_, i) => syntheticLeaf(i + 1)));
    const levels = buildMerkleTree(leaves);
    return {
      size: n,
      leaves,
      root: levels[levels.length - 1][0],
      levelSizes: levels.map((l) => l.length),
      proofs: leaves.map((_, i) => merkleProof(levels, i)),
    };
  }),
  memos: [
    formatMemo({ prefix: "rl", version: 1, period: "2026-09-08", root: "f".repeat(64) }),
    formatMemo({ prefix: "rl", version: 2, period: "2026-09", root: "0".repeat(64) }),
  ],
};

const json = JSON.stringify(vectors, null, 2) + "\n";

if (process.argv.includes("--write")) {
  const out = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "vectors.json");
  writeFileSync(out, json);
  console.error(`wrote ${out}`);
} else {
  process.stdout.write(json);
}
