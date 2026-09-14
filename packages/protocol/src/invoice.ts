import { bech32 } from '@scure/base';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
const integer = (words: number[]) => words.reduce((n, w) => n * 32n + BigInt(w), 0n);
/** Inspect the signed BOLT-11 offer before handing it to a wallet. The wallet handles routing/features. */
export function inspectInvoice(invoice: string) {
  if (invoice.length > 12000) throw new Error('Invoice too long');
  const { prefix, words } = bech32.decode(invoice as `${string}1${string}`, 12000);
  const amount = /^lnbc([1-9][0-9]*)([munp]?)$/.exec(prefix);
  if (!amount || words.length < 111)
    throw new Error('Expected an amount-bearing Bitcoin Lightning invoice');
  const raw = BigInt(amount[1]);
  const msats =
    amount[2] === 'p'
      ? raw % 10n === 0n
        ? raw / 10n
        : 0n
      : raw * ({ '': 100000000000n, m: 100000000n, u: 100000n, n: 100n }[amount[2]] ?? 0n);
  if (msats <= 0n || msats > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('Invalid invoice amount');
  const data = words.slice(0, -104),
    signature = bech32.fromWords(words.slice(-104));
  if (signature.length !== 65 || signature[64] > 3) throw new Error('Invalid invoice signature');
  // BOLT-11 signing pads the 5-bit data words to a byte boundary.
  const padded = [...data];
  while (padded.length % 8) padded.push(0);
  const dataBytes = bech32.fromWords(padded).slice(0, Math.ceil((data.length * 5) / 8));
  const prefixBytes = new TextEncoder().encode(prefix),
    preimage = new Uint8Array(prefixBytes.length + dataBytes.length);
  preimage.set(prefixBytes);
  preimage.set(dataBytes, prefixBytes.length);
  const digest = sha256(preimage),
    fields = new Map<number, number[]>();
  for (let i = 7; i < data.length;) {
    if (i + 3 > data.length) throw new Error('Truncated invoice tag');
    const type = data[i++],
      length = data[i++] * 32 + data[i++];
    if (i + length > data.length) throw new Error('Truncated invoice field');
    if ([1, 16, 19, 23, 13, 6].includes(type)) {
      if (fields.has(type)) throw new Error('Ambiguous invoice field');
      fields.set(type, data.slice(i, i + length));
    }
    i += length;
  }
  const bytes = (tag: number, length: number) => {
    const w = fields.get(tag);
    if (!w || w.length !== Math.ceil((length * 8) / 5))
      throw new Error('Missing or invalid invoice field');
    const b = bech32.fromWords(w);
    if (b.length !== length) throw new Error('Invalid invoice field');
    return b;
  };
  const paymentHash = bytesToHex(bytes(1, 32));
  bytes(16, 32);
  if (fields.has(13) === fields.has(23)) throw new Error('Ambiguous invoice description');
  const descriptionHash = fields.has(23) ? bytesToHex(bytes(23, 32)) : null;
  const payee = fields.has(19)
    ? bytes(19, 33)
    : secp256k1.recoverPublicKey(
        new Uint8Array([signature[64], ...signature.slice(0, 64)]),
        digest,
        { prehash: false },
      );
  if (
    !secp256k1.verify(signature.slice(0, 64), digest, payee, {
      prehash: false,
      lowS: fields.has(19),
    })
  )
    throw new Error('Invalid invoice signature');
  const expiry = integer(fields.get(6) ?? [3, 16, 16]); // 3600 seconds default
  const timestamp = Number(integer(data.slice(0, 7)));
  if (expiry > BigInt(Number.MAX_SAFE_INTEGER - timestamp)) throw new Error('Invalid expiry');
  return {
    msats: Number(msats),
    paymentHash,
    descriptionHash,
    expiresAt: timestamp + Number(expiry),
  };
}
