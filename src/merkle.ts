// Tree construction, proof extraction, proof verification.

import { hashPair } from "./hash.js";

export interface ProofStep {
  hash: string;
  /**
   * Which side the sibling sits on, so a verifier concatenates in the same
   * order the tree did. This is explicit rather than derived from an index
   * because getting it backwards yields a proof that looks structurally valid
   * and never verifies, which is an expensive bug to find.
   */
  position: "left" | "right";
}

/**
 * Order leaves so that every implementation agrees.
 *
 * Sorting by leaf hash makes the order a property of the set itself, which
 * means a verifier can rebuild the tree from the leaves alone without being
 * told the original insertion order. The alternative, preserving insertion
 * order, requires publishing that order as part of the proof.
 */
export function sortLeaves(leaves: string[]): string[] {
  return [...leaves].sort();
}

/**
 * Build every level of the tree, leaves first, root last.
 *
 * Odd levels duplicate the final node rather than promoting it. This is
 * documented prominently because it is the single most common reason two
 * Merkle implementations disagree, and because promotion is equally
 * defensible. What matters is not which rule you pick but that both sides
 * picked the same one.
 */
export function buildMerkleTree(leaves: string[]): string[][] {
  if (leaves.length === 0) {
    throw new Error("buildMerkleTree: refusing to build a tree with no leaves");
  }

  const levels: string[][] = [[...leaves]];
  while (levels[levels.length - 1].length > 1) {
    const prev = levels[levels.length - 1];
    const next: string[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      const left = prev[i];
      const right = i + 1 < prev.length ? prev[i + 1] : prev[i];
      next.push(hashPair(left, right));
    }
    levels.push(next);
  }
  return levels;
}

export function merkleRoot(leaves: string[]): string {
  const levels = buildMerkleTree(leaves);
  return levels[levels.length - 1][0];
}

/** The sibling path from one leaf up to the root. */
export function merkleProof(levels: string[][], leafIndex: number): ProofStep[] {
  if (levels.length === 0) {
    throw new Error("merkleProof: empty tree");
  }
  if (leafIndex < 0 || leafIndex >= levels[0].length) {
    throw new Error(`merkleProof: leaf index ${leafIndex} out of range`);
  }

  const proof: ProofStep[] = [];
  let index = leafIndex;

  // The last level is the root and has no siblings, hence length - 1.
  for (let level = 0; level < levels.length - 1; level++) {
    const nodes = levels[level];
    const isRightChild = index % 2 === 1;
    const siblingIndex = isRightChild ? index - 1 : index + 1;

    // Mirrors the duplicate-last rule in buildMerkleTree: a final odd node is
    // paired with itself, so it is its own sibling.
    const sibling = siblingIndex < nodes.length ? nodes[siblingIndex] : nodes[index];

    proof.push({ hash: sibling, position: isRightChild ? "left" : "right" });
    index = Math.floor(index / 2);
  }

  return proof;
}

/**
 * Recompute the root from a leaf and its sibling path.
 *
 * This is the function the whole design exists to make possible, and the one
 * a third party runs without trusting, or even contacting, whoever published
 * the anchor.
 */
export function verifyProof(leaf: string, proof: ProofStep[], expectedRoot: string): boolean {
  let acc = leaf;
  for (const step of proof) {
    acc = step.position === "left" ? hashPair(step.hash, acc) : hashPair(acc, step.hash);
  }
  return acc === expectedRoot;
}
