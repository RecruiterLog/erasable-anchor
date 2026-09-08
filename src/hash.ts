// Leaf and node hashing.

import { createHash, randomBytes } from "node:crypto";
import { canonicalJson } from "./canonical.js";

/**
 * Domain separation, following RFC 6962's convention. Leaves and internal
 * nodes are hashed under different one byte prefixes so that an internal node
 * can never be presented as a leaf.
 *
 * Without this, someone holding a valid proof could claim an intermediate
 * hash was itself an anchored record, because there would be nothing in the
 * hash to distinguish the two.
 */
export const LEAF_PREFIX = 0x00;
export const NODE_PREFIX = 0x01;

/** The key `buildLeaf` writes the salt to. Facts may not use it themselves. */
export const SALT_KEY = "salt";

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * A fresh 32 byte salt, hex encoded.
 *
 * Uses `randomBytes`, which is cryptographically secure. A predictable salt
 * would defeat the entire erasure property: the point is that a salt nobody
 * holds cannot be guessed, and a counter or a timestamp can be.
 */
export function makeSalt(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Hash a record's facts and its salt into a leaf.
 *
 * On the salt, which looks alarming and is not. It is published alongside the
 * proof, and it has to be, or nobody outside the system that produced the
 * anchor could verify anything and the whole exercise would be pointless. It
 * is not hiding the facts either, which are generally public already.
 *
 * Its job is erasure. The salt is stored only beside the record it belongs to,
 * so deleting the record deletes the salt with it, and the on chain leaf
 * becomes permanently unreproducible: a 32 byte number that nobody can
 * reverse, connect to a person, or even prove relates to a record that once
 * existed. Every other proof in the same tree continues to verify, because
 * nothing about the tree changed.
 *
 * That is what makes an immutable anchor compatible with a GDPR Article 17 or
 * POPIA Section 24 erasure request. See SPEC.md for the argument in full.
 *
 * @param facts A plain object of the fields being committed to. Serialised
 *   canonically, so key order does not matter. Must not contain a `salt` key
 *   of its own, which would be silently overwritten.
 * @param salt A per record salt, normally from `makeSalt()`.
 */
export function buildLeaf(facts: Record<string, unknown>, salt: string): string {
  if (facts === null || typeof facts !== "object" || Array.isArray(facts)) {
    throw new Error("buildLeaf: facts must be a plain object");
  }
  if (Object.prototype.hasOwnProperty.call(facts, SALT_KEY)) {
    // Overwriting it silently would produce a leaf that hashes something other
    // than what the caller passed, which is the worst possible failure here.
    throw new Error(`buildLeaf: facts must not contain a "${SALT_KEY}" key`);
  }
  if (typeof salt !== "string" || salt.length === 0) {
    throw new Error("buildLeaf: salt must be a non-empty string");
  }

  const payload = canonicalJson({ ...facts, [SALT_KEY]: salt });
  return sha256Hex(Buffer.concat([Buffer.from([LEAF_PREFIX]), Buffer.from(payload, "utf8")]));
}

/**
 * Hash two child hashes into their parent. Order matters and is the caller's
 * responsibility; see `merkleProof` for how the side is recorded.
 */
export function hashPair(left: string, right: string): string {
  return sha256Hex(
    Buffer.concat([Buffer.from([NODE_PREFIX]), Buffer.from(left, "hex"), Buffer.from(right, "hex")])
  );
}
