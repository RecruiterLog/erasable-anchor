// The submission layer, checked against a transaction that is actually on
// mainnet.
//
// The constants below are not invented. They were read off
// 56X4CroiKnFwz4QdwTKkzqHNAcHGiPQ8sDkUynUyvPMJ6QzyJ2SFgEM96Uz8MgAZVjf8rs2pzmgRWAQbPbMjDpZ,
// the RecruiterLog anchor for 2026-09-07, so a change to this module that
// would have produced a different transaction fails here rather than in
// production. No network access: the bytes are frozen.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MEMO_PROGRAM_ADDRESS,
  COMPUTE_BUDGET_PROGRAM_ADDRESS,
  memoInstruction,
  setComputeUnitPriceInstruction,
  submitRoot,
} from "../dist/solana.js";
import { formatMemo } from "../dist/index.js";

// Observed on chain.
const LIVE = {
  memoProgram: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  computeBudgetProgram: "ComputeBudget111111111111111111111111111111",
  memo: "rl:v1:2026-09-07:ee0885119c798d763c2930ba6df749aecbb19d25cb69c3c9e9ddbf2afd48ed4f",
  root: "ee0885119c798d763c2930ba6df749aecbb19d25cb69c3c9e9ddbf2afd48ed4f",
  period: "2026-09-07",
  // base58 "3GAG5eogvTjV" from the transaction, decoded.
  computeBudgetData: "031027000000000000",
};

const hex = (bytes) => Buffer.from(bytes).toString("hex");

test("the program addresses match the ones in the live transaction", () => {
  assert.equal(MEMO_PROGRAM_ADDRESS, LIVE.memoProgram);
  assert.equal(COMPUTE_BUDGET_PROGRAM_ADDRESS, LIVE.computeBudgetProgram);
});

test("formatMemo reproduces the string published on chain", () => {
  assert.equal(
    formatMemo({ prefix: "rl", version: 1, period: LIVE.period, root: LIVE.root }),
    LIVE.memo
  );
});

test("memoInstruction reproduces the live memo instruction exactly", () => {
  const ix = memoInstruction(LIVE.memo);
  assert.equal(ix.programAddress, LIVE.memoProgram);
  assert.equal(new TextDecoder().decode(ix.data), LIVE.memo);
  assert.equal(ix.data.length, LIVE.memo.length, "the memo is ASCII, so bytes equal characters");
});

test("the memo instruction touches no accounts", () => {
  // Confirmed against the live transaction, whose memo instruction carries an
  // empty account list. The memo program signs nothing and reads no state, so
  // adding accounts here would change the transaction for no reason.
  assert.deepEqual(memoInstruction("anything").accounts, []);
});

test("setComputeUnitPriceInstruction reproduces the live instruction data", () => {
  const ix = setComputeUnitPriceInstruction(10_000);
  assert.equal(ix.programAddress, LIVE.computeBudgetProgram);
  assert.equal(hex(ix.data), LIVE.computeBudgetData);
  assert.equal(ix.data.length, 9, "u8 discriminator plus u64");
  assert.equal(ix.data[0], 3, "SetComputeUnitPrice");
});

test("the priority fee is encoded little endian", () => {
  // Big endian would be a silent, expensive bug: 1 would become 2^56.
  assert.equal(hex(setComputeUnitPriceInstruction(1).data), "030100000000000000");
  assert.equal(hex(setComputeUnitPriceInstruction(0).data), "030000000000000000");
});

test("a bigint priority fee is accepted, for callers who already have one", () => {
  assert.equal(hex(setComputeUnitPriceInstruction(10_000n).data), LIVE.computeBudgetData);
});

test("a memo with multibyte characters is encoded as UTF-8, not truncated", () => {
  const ix = memoInstruction("rl:v1:2026-09-07:ü");
  assert.equal(new TextDecoder().decode(ix.data), "rl:v1:2026-09-07:ü");
  // 18 characters, of which 17 are ASCII and "ü" is two bytes, so 19 bytes.
  // This is exactly the off-by-one that a length prefix computed from
  // String.length rather than byte length would produce.
  assert.equal("rl:v1:2026-09-07:ü".length, 18);
  assert.equal(ix.data.length, 19);
});

test("submitRoot rejects a malformed key before touching the network", () => {
  // The rpcUrl below is deliberately unreachable. If this ever starts timing
  // out instead of throwing, the validation has moved after the first RPC
  // call, which would mean a bad key costs a round trip to find.
  return assert.rejects(
    () =>
      submitRoot(
        { prefix: "rl", version: 1, period: LIVE.period, root: LIVE.root },
        { rpcUrl: "http://127.0.0.1:1/", secretKey: new Uint8Array(32) }
      ),
    /expected 64/
  );
});

test("submitRoot rejects a malformed memo before touching the network", () => {
  return assert.rejects(
    () =>
      submitRoot(
        { prefix: "rl", version: 1, period: LIVE.period, root: "not-a-root" },
        { rpcUrl: "http://127.0.0.1:1/", secretKey: new Uint8Array(64) }
      ),
    /root must be 64 lowercase hex/
  );
});
