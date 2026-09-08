# Threat model and security claims

> Licensed CC BY 4.0, like `SPEC.md`. Quote it, adapt it, argue with it.

This document exists to be attacked. It states, in falsifiable form, exactly
what the construction in this repository claims and what it does not, so that a
reviewer can try to break specific sentences rather than form a general
impression.

If you are reviewing this: **the claims in section 3 are the deliverable.**
Breaking one of them is the most useful thing you can do. Section 6 lists the
attacks we already thought of, which is where we are least likely to be
surprised and therefore where you should probably not spend your time.

## 1. What is in scope

The construction: salted leaf commitments, canonical serialisation, Merkle tree
building, proof generation and verification, and the on-chain payload format.
That is `src/` in this repository, `SPEC.md`, and the verifiers in
[erasable-anchor-verify](https://github.com/RecruiterLog/erasable-anchor-verify).

**Out of scope**: the RecruiterLog application, its database, its access
control, its key management, and whether the facts it anchors are true. Those
matter enormously and are somebody else's review. A record can be a lie and
still be correctly anchored; this construction claims only that the lie has not
changed since it was published.

## 2. The construction in one paragraph

Each record is committed as `leaf = SHA-256(0x00 ‖ canonical(facts ∪ {salt}))`
where `salt` is 32 bytes from a CSPRNG stored only beside that record. Leaves
are sorted, built into a Merkle tree with `node = SHA-256(0x01 ‖ left ‖ right)`
and odd nodes paired with themselves, and the root is published in an SPL Memo
transaction on Solana mainnet. A proof is the sibling path. Deleting a record
deletes its salt, after which its leaf cannot be linked to any content, while
every other proof in the same tree still verifies.

## 3. Claims

Each is meant to be falsifiable. Numbered so a review can answer them
individually.

**C1. Tamper evidence.** Given a leaf, its proof and a root read from the
chain, `verifyProof` returns true only if that exact leaf was in the tree whose
root was published. Finding a `(facts, salt)` pair different from the original
that verifies against the same published root would break this.

**C2. Domain separation.** No internal node can be presented as a leaf, or vice
versa. The `0x00` / `0x01` prefixes are the only mechanism. A second-preimage
that crosses the two would break this.

**C3. Canonical determinism.** Two correct implementations always agree on the
serialisation of the same value. Any pair of inputs that a conforming
implementation could serialise two ways, or two distinct values that serialise
identically, breaks this. Note especially: key ordering, `undefined` versus
`null`, number formatting, and non-BMP or lone-surrogate strings.

**C4. Erasure.** After a record and its salt are deleted, an adversary holding
the published root, the full tree, every other record, and a copy of the
deleted record's facts cannot demonstrate that the orphaned leaf corresponds to
those facts, except with probability negligible in 256 bits. Breaking this is
the most valuable result a review could produce.

**C5. Erasure does not disturb others.** Deleting any subset of records leaves
every remaining proof valid against the unchanged published root. The root is
never recomputed or reissued.

**C6. Independent verifiability.** A third party can check a record using only
the proof, a public RPC endpoint and the specification, with no cooperation
from us and no trust in us beyond the facts we served. Any step that secretly
requires trusting the publisher breaks this.

**C7. Salt secrecy is not required before erasure.** The salt is published with
the proof and this is intended. Its confidentiality is required only in the
sense that after deletion no copy exists anywhere.

## 4. Non-claims

Stated as plainly as the claims, because a construction that oversells itself
is worse than one with no proofs: people stop reading the failures.

**N1. Completeness.** Nothing here shows a batch contained every record it
should have. A publisher can withhold records before publication and no proof
will reveal it. This is the single largest limitation.

**N2. Truth.** Anchoring says nothing about whether the committed facts are
accurate. It binds the publisher to what they said, not to reality.

**N3. Timeliness.** A root proves publication no earlier than its block time.
It does not prove the records were settled when claimed.

**N4. Privacy of the facts themselves.** In RecruiterLog's deployment the
committed facts are already public. The salt provides erasure, not
confidentiality; do not deploy this expecting it to hide anything before
deletion.

**N5. Key compromise.** If the publishing key is stolen, an attacker can
publish arbitrary roots. Nothing here detects that.

**N6. Availability.** Losing the salts, the proofs, or the database makes
records unverifiable. Erasure and data loss are indistinguishable from outside,
by design.

## 5. Assumptions

- SHA-256 is collision and second-preimage resistant.
- `crypto.randomBytes` is a CSPRNG.
- Solana mainnet does not reorganise a confirmed transaction, and public RPC
  nodes do not lie about transaction contents. A verifier reading a root from a
  single RPC endpoint trusts that endpoint; checking two independent providers
  removes that.
- Salts genuinely exist in one place. This is operational and the code cannot
  enforce it. See section 7.

## 6. Attacks we have considered

Listed so a reviewer can skip them or, better, tell us where our reasoning is
wrong.

- **Second preimage across leaf and node domains.** Addressed by C2's prefixes,
  following RFC 6962's convention.
- **The classic Merkle forgery via duplicated odd nodes.** We pair a final odd
  node with itself. We believe sorting leaves by hash and fixing the tree shape
  from the leaf set makes the standard "internal node reinterpreted as a pair
  of leaves" attack inapplicable, **and this is the argument we would most like
  checked**, because it is the one where a subtle mistake is easiest to make
  and hardest to notice.
- **Canonicalisation ambiguity.** Sorted keys, no whitespace, `undefined`
  collapsed to `null`, non-finite numbers refused rather than serialised.
  Unicode is where we are least confident: see C3.
- **Salt reuse.** Fresh per record. Two records with identical facts still get
  distinct leaves, so one erasure cannot orphan another record's proof.
- **Replaying a proof from another tree.** The root is read from the chain, and
  the memo carries a period and a format version.
- **A memo from an unrelated system that happens to share the format.**
  Verifiers may pin an expected prefix.

## 7. The weakest link, stated plainly

**Salt custody.** Every erasure claim collapses if a salt survives in a backup,
a read replica, an audit log, an analytics export or a warehouse table. The
code cannot enforce this and does not pretend to.

An adopter should be able to answer, concretely: where do salts live, what
deletes them, and what would a restore from a six-month-old backup resurrect?
We consider this the most likely way a real deployment of this pattern fails,
ahead of anything cryptographic.

## 8. What we would like a review to answer

1. Is C4 sound as stated, and is 32 bytes the right margin?
2. Is the sorted-leaves plus duplicate-last tree construction free of the known
   Merkle forgery classes, or have we missed one?
3. Does the canonicalisation admit any ambiguity, particularly around Unicode?
4. Are the claims and non-claims honestly drawn, or does anything in the README
   or SPEC overstate what is proven?
5. Is there a simpler construction with the same properties? We would rather
   publish a smaller idea that is right.

An adverse finding is publishable and will be published. The commitment is to
publish the review whatever it concludes, and this document is written on that
basis.

## 9. Running everything

```bash
npm install && npm test          # 59 tests, no network
node scripts/make-vectors.mjs    # regenerate the fixed vectors
```

`test/vectors.json` holds fixed vectors for checking a reimplementation.
`test/erasure.test.mjs` exercises C4 and C5 directly.

To verify a live record end to end, against Solana rather than against us,
without installing anything or cloning either repository:

```bash
curl -sO https://raw.githubusercontent.com/RecruiterLog/erasable-anchor-verify/main/bin/verify-anchor.mjs
node verify-anchor.mjs f9ab4eff-01d5-49ef-a682-9b457b9e6d94
```

That is one file, about 12 kB, with no dependencies beyond Node's built-in
`crypto` and `fetch`. Read it before you run it; it is short enough to read in
full, which is the point.
