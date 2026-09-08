# erasable-anchor

Merkle anchoring where deleting a record permanently severs its leaf, without
invalidating any other proof in the same tree.

```
npm install erasable-anchor
```

## The problem this solves

Publishing a hash of a record to a public ledger gives you tamper evidence:
anyone can later check that the record has not been altered, without trusting
you. That is genuinely useful, and it is why anchoring is common.

It also looks incompatible with data protection law. A hash of personal data
is still personal data under both GDPR and POPIA, and a ledger is exactly the
place you cannot delete from. So an erasure request arrives and there is
nothing you can honestly do: the commitment is out there permanently. The
usual answers are to anchor nothing sensitive, to keep a mutable side table
and undermine the point, or to quietly hope nobody asks.

This library takes a third route. The leaf commits to the record's facts **and
to a 32 byte salt held only beside the record**. Deleting the record deletes
the salt with it. The leaf stays on the ledger forever, but it is now a number
nobody can reverse, connect to a person, or even show relates to a record that
once existed. The tree is untouched, so every other proof in it still
verifies.

This is crypto shredding, which is well established for encrypted data, applied
to a commitment scheme instead.

## Usage

Anchoring a batch:

```js
import {
  buildLeaf, makeSalt, sortLeaves, buildMerkleTree, merkleProof, formatMemo,
} from "erasable-anchor";

// One salt per record, generated once and stored next to it. This is the
// only copy: when the record goes, so does the ability to reproduce its leaf.
const records = rows.map((row) => ({
  id: row.id,
  facts: { v: 1, recordId: row.id, status: row.status, closedAt: row.closed_at },
  salt: makeSalt(),
}));

const leaves = sortLeaves(records.map((r) => buildLeaf(r.facts, r.salt)));
const levels = buildMerkleTree(leaves);
const root = levels[levels.length - 1][0];

// Publish this string. On Solana it goes in an SPL Memo instruction.
const memo = formatMemo({ prefix: "rl", version: 1, period: "2026-09-08", root });
// => "rl:v1:2026-09-08:8f2c..."
```

Publishing it, from `erasable-anchor/solana`:

```js
import { submitRoot } from "erasable-anchor/solana";

const { signature } = await submitRoot(
  { prefix: "rl", version: 1, period: "2026-09-08", root },
  { rpcUrl: "https://api.mainnet-beta.solana.com", secretKey: process.env.ANCHOR_KEY }
);
```

That waits for confirmation rather than returning on submission, because an
unconfirmed signature can still be dropped and recording the batch as anchored
on the strength of one would leave you asserting a proof no chain carries.

A complete anchor transaction costs about 7,030 lamports. No account is
created, so there is no rent, and the cost does not grow with the number of
records in a batch.

If you already have a Solana client you would rather use, `memoInstruction()`
and `setComputeUnitPriceInstruction()` from the same module build the
instructions and require nothing at all.

Serving a proof for one record:

```js
const leaf = buildLeaf(record.facts, record.salt);
const proof = merkleProof(levels, leaves.indexOf(leaf));
// Send the caller: facts, salt, leaf, proof, root, and the transaction id.
// The salt has to be published. Without it nobody can verify anything.
```

Verifying, as a third party:

```js
import { buildLeaf, verifyProof } from "erasable-anchor";

const leaf = buildLeaf(facts, salt);
const ok = verifyProof(leaf, proof, rootReadFromTheChain);
```

The root you check against should be read from the ledger, not from whoever
served you the proof. Otherwise you have verified that a party's data matches
its own claim, which is not a useful statement.

## What a passing proof does and does not establish

**Does:** this exact content was included in a tree whose root was published
at the stated time, by whoever controls the publishing key. Nothing has been
edited since.

**Does not:** that the batch was complete. Nothing on a ledger can show that
records were never withheld before publication. Anchoring proves the absence of
later tampering, never the presence of everything that should have been there.

Saying so plainly matters. A system that oversells what its proofs mean is
worse than one with no proofs, because people stop reading the failures.

## The erasure argument

The salt is 32 bytes from a cryptographically secure source, so there are
2^256 candidates. Given an orphaned leaf, and even given a leaked copy of the
original facts, an adversary cannot show the two are related: they would have
to find the salt, and the only copy was deleted with the record.

Three consequences worth being explicit about:

1. **Erasure is real, not a promise.** It does not depend on anyone honouring a
   deletion request in the future. Once the salt is gone the link is gone.
2. **Other people's proofs survive.** The root is never recomputed or reissued,
   so an erasure by one person cannot be used to invalidate anyone else's
   evidence. `test/erasure.test.mjs` exercises this directly.
3. **You must not keep the salt anywhere else.** Backups, audit logs, replicas
   and analytics snapshots all defeat the property. This is an operational
   commitment, and the library cannot enforce it for you.

## Reviewing this

`THREAT-MODEL.md` states, in falsifiable form, exactly what this construction
claims (seven numbered claims) and what it does not (six numbered non-claims),
along with the attacks already considered and the three places we would most
like a reviewer to push.

It is written to be attacked rather than admired. If you find a claim that does
not hold, that is the most useful thing you can send us, and an adverse finding
will be published.

The shortest version of the weakest link: every erasure claim collapses if a
salt survives in a backup, a replica or an analytics export. That is
operational, the code cannot enforce it, and we think it is a likelier failure
than anything cryptographic.

## Interoperability

`SPEC.md` defines the wire format at byte level so the scheme can be
reimplemented in another language. `test/vectors.json` holds fixed vectors to
check a reimplementation against, including trees at the sizes where the
duplicate last node rule bites.

Two conventions that are the usual cause of two Merkle implementations
disagreeing, both settled here and both arbitrary in themselves:

- Leaves are sorted by hash, so ordering is a property of the set and a
  verifier does not need to be told the insertion order.
- An odd node at any level is paired **with itself**, not promoted.

## Status

Used in production by [RecruiterLog](https://recruiterlog.com), which anchors
a daily root of settled employer conduct records to Solana. This package was
extracted from that codebase and reproduces its hashes byte for byte, verified
against both the implementation that produced the live anchors and an
independent reimplementation.

Zero runtime dependencies in the main entry point, which is worth protecting:
a verifier should be able to depend on the hashing rules without pulling in a
chain client. `erasable-anchor/solana` needs `@solana/kit` for `submitRoot`
only, as an optional peer dependency imported lazily, so the instruction
builders in that module work without it too.

Node 18 or later, for `node:crypto`; CI runs the suite on 20, 22 and 24.
Browser
verification lives in
[erasable-anchor-verify](https://github.com/RecruiterLog/erasable-anchor-verify),
which uses Web Crypto and is deliberately a separate implementation: a
verifier that imported this library would be checking its arithmetic with its
own code.

## Licence

**Code: Apache 2.0** (`LICENSE`). Chosen over MIT for the express patent grant,
because the intended adopters of this pattern are regulated businesses whose
legal teams treat a missing patent grant as a reason to decline.

**The specification, `SPEC.md`: CC BY 4.0** (`LICENSE-SPEC`). A software licence
on a prose document is a category error, and a specification nobody may quote or
adapt is not much of a specification. Reimplement it in any language, for any
purpose including commercially, with attribution and without asking us.

See also `NOTICE`.
