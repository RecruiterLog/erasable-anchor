# erasable-anchor wire format, version 1

This document defines the format precisely enough to reimplement in another
language. Every value below is taken from a passing test, not written by hand.
Check any reimplementation against `test/vectors.json`.

Where a rule is arbitrary, that is said so. Arbitrary is fine. Undocumented is
not, because two implementations that each picked a reasonable convention will
disagree, and the failure surfaces as a proof that never verifies with no
indication of why.

## 1. Canonical serialisation

A value is serialised to a string by these rules:

| Type | Rule |
| --- | --- |
| `null`, `undefined` | the four characters `null` |
| boolean | `true` or `false` |
| string | as JSON, with JSON's escaping |
| number | as JSON. Non-finite values are an error, never `null` |
| array | `[` elements, comma separated, in order `]` |
| object | `{` `"key":value` pairs, comma separated, **keys sorted** `}` |

No whitespace anywhere. Object keys are sorted by code unit, which is
JavaScript's default string sort, applied at every depth. Arrays keep their
order, because order is meaningful in an array and not in an object.

`undefined` collapsing to `null` means an absent field and an explicitly null
one serialise identically. This is deliberate: the two are the same fact.

Non-finite numbers must raise an error. `JSON.stringify(NaN)` produces the
string `null`, which would silently turn a broken value into a legitimate
absent one and yield a proof that verifies against the wrong fact.

Serialising a function, symbol or bigint is an error. There is no sensible
default and a guess here is a hash nobody else can reproduce.

## 2. Leaf hashing

```
leaf = SHA256( 0x00 || UTF8( canonical( facts ∪ { "salt": salt } ) ) )
```

- `0x00` is a single byte prefix, present so that a leaf can never collide with
  an internal node. See section 3.
- `salt` is inserted as an ordinary member of the object and therefore takes
  part in key sorting. It is hashed as **the JSON string of its text**, not as
  the bytes it may encode. A hex salt is 64 characters of UTF-8, not 32 bytes.
- `facts` must not already contain a `salt` key. Implementations should raise
  an error rather than overwrite it.
- The salt should be 32 bytes from a cryptographically secure source, hex
  encoded lowercase. The format does not require that length, but the erasure
  argument in section 6 depends on it.
- Output is 64 lowercase hex characters.

Worked example:

```
facts = {"recordId":"r1"}
salt  = "0000000000000000000000000000000000000000000000000000000000000000"

canonical = {"recordId":"r1","salt":"00000000000000000000000000000000000000
             0000000000000000000000000000"}          (one line, no wrapping)

leaf  = de7467562d2bfff5f892ddf6df21b970d16127e1eb25ca897d2827062c676cea
```

Changing only the salt to `1111...11` gives
`f8020a00e3d269dcdcb32a082f4dc390a4538c99894e1b58064459358a7059cb`.

Key order is not significant. Both `{"a":1,"b":2}` and `{"b":2,"a":1}` with
salt `aaaa...aa` give
`b88caf3af2f3a9a83c63094724898c99b254b4056275482648987697210c03f5`.

## 3. Node hashing

```
node = SHA256( 0x01 || BYTES(left) || BYTES(right) )
```

`BYTES` decodes a 64 character hex hash to its 32 raw bytes. The two children
are hashed as bytes, not as their hex text.

The `0x01` prefix follows the domain separation convention of RFC 6962. Without
it, a holder of a valid proof could present an intermediate hash as though it
were an anchored record, since nothing in the hash would distinguish the two.

Node hashing is order sensitive:

```
H(0101..01, 0202..02) = b331da6ec49d4547d9942a6727e5123f69bed5a0b97ac171cfbfd6201431fcfa
H(0202..02, 0101..01) = 82d09fe099e083bee91749bc978e413e50ccbcddcedb81a1983b5249bfe266be
```

## 4. Tree construction

1. **Sort the leaves** ascending as hex strings. Arbitrary, but it makes the
   ordering a property of the set, so a verifier can rebuild the tree from the
   leaves alone without being told the insertion order.
2. Level 0 is the sorted leaves.
3. To build the next level, take the current level in pairs left to right and
   hash each pair per section 3. **If the level has an odd length, the final
   node is paired with itself.** Arbitrary, and the single most common reason
   two Merkle implementations disagree. Promotion is equally defensible; what
   matters is that both sides chose the same rule.
4. Repeat until a level has one node. That node is the root.
5. A tree with zero leaves is an error. An empty root would be a fixed
   constant, and publishing it would assert that a batch was anchored when
   nothing was.

A single leaf is its own root, and its proof is the empty list.

Worked example, three leaves:

```
level 0: 0101..01  0202..02  0303..03            (3 nodes)
level 1: H(L1,L2)  H(L3,L3)                      (2 nodes)
level 2: H(level1[0], level1[1])                 (1 node, the root)

root = d4d5f06e1ed593a914bc1baed212d3c6976a8a2d809172dc60894bb6b4d41fd9
```

## 5. Proofs

A proof is the ordered list of siblings from a leaf up to the root. Each step
is:

```
{ "hash": "<64 hex>", "position": "left" | "right" }
```

`position` is **the side the sibling sits on**, not the side of the node being
proved. It is recorded rather than derived from an index because deriving it
is easy to get backwards, and the result is a proof that looks well formed and
never verifies.

Extraction, starting at the leaf's index in level 0 and walking up:

- if the index is odd, the sibling is at `index - 1`, position `left`
- if the index is even, the sibling is at `index + 1`, position `right`
- if `index + 1` is past the end of the level, the node is its own sibling,
  mirroring the duplicate last rule
- move to the parent by `index = floor(index / 2)`

Verification:

```
acc = leaf
for step in proof:
    acc = step.position == "left"
            ? H(step.hash, acc)
            : H(acc, step.hash)
return acc == expectedRoot
```

Proof length is `ceil(log2(n))` steps for `n` leaves.

The root compared against should be read from the ledger, not from the party
that served the proof.

## 6. Erasure

Leaves commit to a per record salt whose only copy is stored beside that
record. Deleting the record deletes the salt.

The leaf remains on the ledger and continues to prove its own membership in
the tree. What is gone is any way to connect it to content. An adversary
holding both the orphaned leaf and a leaked copy of the original facts still
cannot demonstrate a relationship, because doing so requires the salt, and
with 32 bytes of entropy there are 2^256 candidates and no way to test one
without it.

The root is never recomputed or reissued, so an erasure cannot disturb anyone
else's proof. This is a property of the scheme, and `test/erasure.test.mjs`
asserts it directly.

The scheme's guarantee is conditional on one operational commitment it cannot
enforce: **the salt must not exist anywhere else.** Backups, replicas, audit
logs, analytics snapshots and warehouse exports all defeat it. Anyone adopting
this should be able to say where salts live and what deletes them.

## 7. On chain payload

```
<prefix>:v<version>:<period>:<root>
```

- `prefix` identifies the publisher, 1 to 16 lowercase alphanumerics
- `version` is this format's version, currently `1`
- `period` is the batch label, digits and hyphens only, for example a date
- `root` is 64 lowercase hex characters

Example: `rl:v1:2026-09-08:ffff...ff`

The string is self describing so that someone who encounters the transaction
on an explorer can tell what it is without this repository.

The version is present so that a change to the hashed field set is
distinguishable from tampering. Without it, a schema change looks exactly like
an attack.

A parser should reject a memo whose prefix is not the one expected. A memo
published by an unrelated system that happens to share this format will
otherwise parse successfully.

On Solana this goes in an SPL Memo instruction. Nothing about the format is
Solana specific.

## 8. What a proof establishes

**Established:** the content was included in a tree whose root was published at
the stated time by whoever controls the publishing key, and has not been
altered since.

**Not established:** that the batch was complete. No ledger can show that
records were never withheld before publication.

State both. A system that oversells its proofs is worse than one with none,
because people stop reading the failures.
