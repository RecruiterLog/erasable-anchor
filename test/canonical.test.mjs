import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJson } from "../dist/index.js";

test("key order does not affect the output", () => {
  const a = { role: "Engineer", companyId: "c1", status: "Closed" };
  const b = { status: "Closed", companyId: "c1", role: "Engineer" };
  assert.equal(canonicalJson(a), canonicalJson(b));
});

test("sorts keys at every depth, not just the top level", () => {
  const a = { outer: { z: 1, a: 2 }, first: true };
  assert.equal(canonicalJson(a), '{"first":true,"outer":{"a":2,"z":1}}');
});

test("undefined and explicit null serialise identically", () => {
  assert.equal(canonicalJson({ a: undefined }), canonicalJson({ a: null }));
  assert.equal(canonicalJson(undefined), "null");
});

test("array order is preserved, because order is meaningful there", () => {
  assert.equal(canonicalJson([3, 1, 2]), "[3,1,2]");
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
});

test("emits no whitespace", () => {
  const out = canonicalJson({ a: 1, b: [1, 2], c: { d: "x" } });
  assert.equal(out, '{"a":1,"b":[1,2],"c":{"d":"x"}}');
  assert.ok(!/\s/.test(out));
});

test("strings are escaped by JSON rules, so a quote cannot break out", () => {
  assert.equal(canonicalJson({ 'a"b': 'c"d' }), '{"a\\"b":"c\\"d"}');
});

test("NaN and Infinity throw rather than becoming null", () => {
  // JSON.stringify(NaN) is the string "null", which would quietly turn a
  // broken value into a legitimate absent one.
  assert.throws(() => canonicalJson({ n: NaN }), /not representable/);
  assert.throws(() => canonicalJson({ n: Infinity }), /not representable/);
});

test("unsupported types throw rather than being guessed at", () => {
  assert.throws(() => canonicalJson({ f: () => 1 }), /unsupported type/);
  assert.throws(() => canonicalJson({ s: Symbol("x") }), /unsupported type/);
});

test("negative zero and zero collapse, as they do in JSON", () => {
  assert.equal(canonicalJson(-0), "0");
});
