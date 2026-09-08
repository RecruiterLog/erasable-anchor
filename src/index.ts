// erasable-anchor
//
// Merkle anchoring where deleting a record permanently severs its leaf,
// without invalidating any other proof in the same tree.
//
// Everything exported here is a deterministic function of its inputs. There is
// no I/O, no database and no network, because determinism is the product: a
// proof is worthless if two correct implementations can disagree about what a
// record hashes to. Keeping this layer free of side effects is what lets an
// independent verifier reproduce it exactly.
//
// See SPEC.md for the wire format and the erasure argument.

export { canonicalJson } from "./canonical.js";
export { makeSalt, buildLeaf, hashPair, LEAF_PREFIX, NODE_PREFIX, SALT_KEY } from "./hash.js";
export {
  sortLeaves,
  buildMerkleTree,
  merkleRoot,
  merkleProof,
  verifyProof,
  type ProofStep,
} from "./merkle.js";
export { formatMemo, parseMemo, type Memo } from "./memo.js";
