import type { Page } from '@playwright/test';
import { bech32 } from '@scure/base';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { verifiedEvent, type SignedEvent } from '../../packages/protocol/src';

/** Test-only signed invoice. No real wallet/provider is contacted. */
export function invoice(msats: number, description: string) {
  const encoder = new TextEncoder(),
    key = new Uint8Array(32).fill(3);
  const words = (n: number) => {
    const values: number[] = [];
    do {
      values.unshift(n % 32);
      n = Math.floor(n / 32);
    } while (n);
    return values;
  };
  const field = (tag: number, bytes: Uint8Array) => {
    const values = bech32.toWords(bytes);
    return [tag, Math.floor(values.length / 32), values.length % 32, ...values];
  };
  const timestamp = words(Math.floor(Date.now() / 1000));
  while (timestamp.length < 7) timestamp.unshift(0);
  const expiry = words(3600);
  const data = [
    ...timestamp,
    ...field(1, sha256(encoder.encode(description))),
    ...field(16, new Uint8Array(32).fill(9)),
    ...field(23, sha256(encoder.encode(description))),
    6,
    0,
    expiry.length,
    ...expiry,
  ];
  const padded = [...data];
  while (padded.length % 8) padded.push(0);
  const bytes = bech32.fromWords(padded).slice(0, Math.ceil((data.length * 5) / 8));
  const prefix = `lnbc${msats * 10}p`;
  const signed = secp256k1.sign(
    sha256(new Uint8Array([...encoder.encode(prefix), ...bytes])),
    key,
    { prehash: false, format: 'recovered' },
  );
  return bech32.encode(
    prefix,
    [...data, ...bech32.toWords(new Uint8Array([...signed.slice(1), signed[0]]))],
    12000,
  );
}
export async function directWallet(
  page: Page,
  events: Map<string, SignedEvent>,
  key: Uint8Array,
  relay: string,
) {
  const pubkey = getPublicKey(key),
    requests: SignedEvent[] = [],
    invoices: string[] = [];
  const profile = finalizeEvent(
    {
      kind: 0,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify({ name: 'Fixture creator', lud16: 'fixture@wallet.example' }),
    },
    key,
  );
  events.set(profile.id, profile);
  // Keep the public zap hint while routing its WebSocket to our independent fixture relay.
  await page.addInitScript(
    ({ relay }) => {
      if (window !== window.top) return;
      const Original = window.WebSocket;
      window.WebSocket = class extends Original {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(String(url).startsWith('wss://relay.example') ? relay : url, protocols);
        }
      };
      localStorage.setItem(
        'napplet:network',
        JSON.stringify({ relays: ['wss://relay.example'], blossom: ['http://localhost:19348'] }),
      );
    },
    { relay },
  );
  await page.route('https://wallet.example/**', async (route) => {
    const url = new URL(route.request().url());
    const headers = { 'access-control-allow-origin': '*' };
    if (url.pathname.startsWith('/.well-known/lnurlp/'))
      return route.fulfill({
        headers,
        json: {
          tag: 'payRequest',
          allowsNostr: true,
          nostrPubkey: pubkey,
          callback: 'https://wallet.example/callback',
          minSendable: 1000,
          maxSendable: 1000000,
          commentAllowed: 100,
        },
      });
    const serialized = url.searchParams.get('nostr')!;
    const request = verifiedEvent(JSON.parse(serialized));
    requests.push(request);
    const pr = invoice(Number(url.searchParams.get('amount')), serialized);
    invoices.push(pr);
    return route.fulfill({ headers, json: { pr } });
  });
  return { requests, invoices };
}
