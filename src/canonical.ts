// Canonical serialisation.
//
// This is the part that has to be boring and exact. A proof is worthless if
// two correct implementations can disagree about what a record serialises to,
// so every rule here exists to remove a degree of freedom rather than to be
// clever.

/**
 * Serialise a value to a canonical string: object keys sorted, no whitespace,
 * `undefined` collapsed to `null`.
 *
 * `JSON.stringify` is not sufficient on its own. It preserves insertion order,
 * so two objects with identical contents built in different orders serialise
 * differently and therefore hash differently. That is a latent failure: it
 * works until the day someone reorders a field assignment.
 *
 * Non-finite numbers throw rather than serialise. `JSON.stringify(NaN)` yields
 * the string `null`, which would silently collapse a broken value into a
 * legitimate absent one and produce a proof that verifies against the wrong
 * fact.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";

  const t = typeof value;
  if (t === "boolean" || t === "string") return JSON.stringify(value);
  if (t === "number") {
    if (!Number.isFinite(value as number)) {
      throw new Error("canonicalJson: NaN and Infinity are not representable");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
  }

  // Reached by functions, symbols and bigints. Refusing is deliberate: any
  // fallback would be a guess, and a guess in this function is a hash nobody
  // else can reproduce.
  throw new Error(`canonicalJson: unsupported type ${t}`);
}
