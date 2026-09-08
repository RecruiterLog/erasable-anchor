// The on chain payload.
//
// A root is only useful if someone who stumbles across the transaction can
// tell what it is. These two functions keep the published string
// self describing, so an explorer view is readable without this repository.

export interface Memo {
  prefix: string;
  version: number;
  period: string;
  root: string;
}

const PERIOD_PATTERN = /^[0-9-]+$/;
const ROOT_PATTERN = /^[0-9a-f]{64}$/;
const PREFIX_PATTERN = /^[a-z0-9]{1,16}$/;

function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Format a root for publication, as `<prefix>:v<version>:<period>:<root>`.
 *
 * The version is the *format* version, bumped when the hashed field set
 * changes. Carrying it means a verifier can tell "this record was anchored
 * under an older rule" apart from "this record has been tampered with".
 * Without it, a schema change looks identical to an attack.
 */
export function formatMemo({ prefix, version, period, root }: Memo): string {
  if (!PREFIX_PATTERN.test(prefix)) {
    throw new Error("formatMemo: prefix must be 1 to 16 lowercase alphanumerics");
  }
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("formatMemo: version must be a positive integer");
  }
  if (!PERIOD_PATTERN.test(period)) {
    throw new Error("formatMemo: period must contain only digits and hyphens");
  }
  if (!ROOT_PATTERN.test(root)) {
    throw new Error("formatMemo: root must be 64 lowercase hex characters");
  }
  return `${prefix}:v${version}:${period}:${root}`;
}

/**
 * Parse a memo, returning `null` for anything that is not one.
 *
 * Returns null rather than throwing because the normal use is sifting a
 * transaction's logs, where most lines are legitimately not anchors.
 *
 * @param expectedPrefix When given, a memo carrying any other prefix returns
 *   null. Worth passing: without it, a memo published by an unrelated system
 *   that happens to share this format would parse successfully.
 */
export function parseMemo(memo: string, expectedPrefix?: string): Memo | null {
  const prefixPart = expectedPrefix ? escapeForRegExp(expectedPrefix) : "[a-z0-9]{1,16}";
  const pattern = new RegExp(`^(${prefixPart}):v(\\d+):([0-9-]+):([0-9a-f]{64})$`);
  const m = memo.match(pattern);
  if (!m) return null;
  return { prefix: m[1], version: Number(m[2]), period: m[3], root: m[4] };
}
