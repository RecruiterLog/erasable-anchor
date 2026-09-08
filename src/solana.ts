// Publishing a root to Solana.
//
// Kept out of the package's main entry point on purpose. Everything exported
// from `erasable-anchor` is a pure function with no dependencies, and that is
// worth protecting: a verifier should be able to depend on the hashing rules
// without pulling in a chain client. This module is reached at
// `erasable-anchor/solana` instead.
//
// The instruction builders here are still dependency free. A Solana
// instruction is a program address, an optional account list and a byte
// array, so building one requires nothing. Only `submitRoot`, which has to
// talk to a cluster and sign, needs @solana/kit, and it imports it lazily so
// that merely importing this module does not require it to be installed.

import { formatMemo, type Memo } from "./memo.js";

/** SPL Memo v2. */
export const MEMO_PROGRAM_ADDRESS = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

export const COMPUTE_BUDGET_PROGRAM_ADDRESS = "ComputeBudget111111111111111111111111111111";

/** A Solana instruction, in the shape @solana/kit and web3.js both accept. */
export interface Instruction {
  programAddress: string;
  accounts?: { address: string; role: number }[];
  data: Uint8Array;
}

/**
 * The instruction that publishes a memo.
 *
 * SPL Memo was chosen over a custom program deliberately, and the reasoning is
 * worth repeating because it is the main design question here: a root is inert
 * data. Nothing needs to execute against it, and nothing needs to read it back
 * on chain. A memo is legible on any explorer with no IDL, which is precisely
 * the property you want in something published so that outsiders can check it.
 * A custom program would be more to audit, more to maintain, and would make
 * the anchor harder for a third party to inspect: the opposite of the point.
 *
 * Note the empty account list. The memo program signs nothing and touches no
 * state, so this instruction reads and writes no accounts at all.
 */
export function memoInstruction(memo: string): Instruction {
  return {
    programAddress: MEMO_PROGRAM_ADDRESS,
    accounts: [],
    data: new TextEncoder().encode(memo),
  };
}

/**
 * SetComputeUnitPrice, built by hand rather than pulled from
 * `@solana-program/compute-budget`, which would be a dependency for nine bytes
 * of stable, documented instruction data.
 *
 * Layout: a u8 discriminator of 3, then microLamports as u64 little endian.
 */
export function setComputeUnitPriceInstruction(microLamports: number | bigint): Instruction {
  const data = new Uint8Array(9);
  data[0] = 3;
  new DataView(data.buffer).setBigUint64(1, BigInt(microLamports), true);
  return { programAddress: COMPUTE_BUDGET_PROGRAM_ADDRESS, accounts: [], data };
}

export interface SubmitOptions {
  /** Cluster RPC endpoint. */
  rpcUrl: string;
  /**
   * The websocket endpoint, for confirmation. Derived from `rpcUrl` when
   * omitted, which is almost always right: public providers serve both on the
   * same host. A local `solana-test-validator` is the exception, serving RPC
   * on 8899 and PubSub on 8900, which is handled.
   */
  wsUrl?: string;
  /**
   * The signing keypair: 64 bytes as a Uint8Array, a JSON array string (what
   * `solana-keygen new` writes), or those bytes base64 encoded.
   */
  secretKey: Uint8Array | string;
  /**
   * Priority fee. 10,000 microLamports per compute unit is about 0.000002 SOL
   * on a 200k CU transaction, well under the base fee, and enough to clear the
   * queue for something published once a day. Pass 0 to omit the instruction.
   */
  priorityFeeMicroLamports?: number;
}

export interface SubmitResult {
  signature: string;
  memo: string;
}

function toWebsocketUrl(rpcUrl: string): string {
  const ws = rpcUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  try {
    const url = new URL(ws);
    if (url.port === "8899") {
      // A local validator serves PubSub on 8900. Without this, confirmation
      // hangs forever against a port nothing is listening on, with no error.
      url.port = "8900";
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    // Not parseable. Let the RPC client complain rather than swallowing it.
  }
  return ws;
}

function toKeyBytes(secretKey: Uint8Array | string): Uint8Array {
  let bytes: Uint8Array;

  if (secretKey instanceof Uint8Array) {
    bytes = secretKey;
  } else {
    const raw = secretKey.trim();
    bytes = raw.startsWith("[")
      ? Uint8Array.from(JSON.parse(raw) as number[])
      : Uint8Array.from(Buffer.from(raw, "base64"));
  }

  // Checked for every input shape, not just the parsed ones. Passing raw bytes
  // of the wrong length is the easiest mistake to make here, and leaving it to
  // the signing library means the caller gets an error phrased in terms of key
  // pairs rather than one that says what to do about it.
  if (bytes.length !== 64) {
    throw new Error(
      `secretKey is ${bytes.length} bytes, expected 64. It should be the full ` +
        "keypair (secret and public), as written by `solana-keygen new`, not " +
        "just the 32 byte seed."
    );
  }
  return bytes;
}

/**
 * Publish a root and wait for confirmation.
 *
 * Confirmed, not merely submitted. An unconfirmed signature can still be
 * dropped, and recording a batch as anchored on the strength of one would
 * leave your database asserting a proof that no chain actually carries. That
 * is worse than not anchoring, because it fails closed for everyone except the
 * person checking.
 *
 * Requires `@solana/kit` to be installed. It is an optional peer dependency
 * and is imported lazily, so the rest of this package works without it.
 */
export async function submitRoot(memo: Memo, options: SubmitOptions): Promise<SubmitResult> {
  let kit: typeof import("@solana/kit");
  try {
    kit = await import("@solana/kit");
  } catch {
    throw new Error(
      "submitRoot requires @solana/kit, which is an optional peer dependency. " +
        "Install it, or build the instructions yourself with memoInstruction() " +
        "and submit them with whichever client you already use."
    );
  }

  const memoString = formatMemo(memo);
  const signer = await kit.createKeyPairSignerFromBytes(toKeyBytes(options.secretKey));

  const rpc = kit.createSolanaRpc(options.rpcUrl);
  const rpcSubscriptions = kit.createSolanaRpcSubscriptions(
    options.wsUrl || toWebsocketUrl(options.rpcUrl)
  );

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const priority = options.priorityFeeMicroLamports ?? 10_000;
  const instructions = [
    ...(priority > 0 ? [setComputeUnitPriceInstruction(priority)] : []),
    memoInstruction(memoString),
  ];

  const message = kit.pipe(
    kit.createTransactionMessage({ version: 0 }),
    (m) => kit.setTransactionMessageFeePayerSigner(signer, m),
    (m) => kit.setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    // The plural append, deliberately. Kit tracks a message's size limit in
    // its type, so folding instructions in one at a time with reduce produces
    // a type the next step no longer accepts.
    (m) => kit.appendTransactionMessageInstructions(instructions as never, m)
  );

  const signed = await kit.signTransactionMessageWithSigners(message);
  kit.assertIsTransactionWithBlockhashLifetime(signed);

  await kit.sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(signed, {
    commitment: "confirmed",
  });

  return { signature: kit.getSignatureFromTransaction(signed), memo: memoString };
}
