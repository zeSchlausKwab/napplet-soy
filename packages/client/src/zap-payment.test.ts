import { test, expect } from 'bun:test';
import { checkZapPayment, validPaymentPreimage, type ZapInvoice } from './zaps';
import { sha256 } from '../../protocol/src';

test('payment status binds settled provider responses and wallet preimages to the exact invoice', async () => {
  const preimage = '07'.repeat(32);
  const paymentHash = await sha256(new Uint8Array(32).fill(7));
  const invoice = {
    invoice: 'lnbc-test-only',
    verify: 'https://wallet.example/verify/123',
    paymentHash,
  } as ZapInvoice;
  expect(validPaymentPreimage(preimage, paymentHash)).toBe(true);
  expect(validPaymentPreimage('08'.repeat(32), paymentHash)).toBe(false);
  expect(validPaymentPreimage(undefined, paymentHash)).toBe(false);
  const response = { status: 'OK', settled: true, pr: invoice.invoice, preimage };
  expect(await checkZapPayment(invoice, undefined, async () => response)).toBe(true);
  expect(
    await checkZapPayment(invoice, undefined, async () => ({ ...response, preimage: null })),
  ).toBe(true);
  for (const change of [
    { settled: false },
    { settled: 'true' },
    { status: 'ERROR' },
    { pr: 'another invoice' },
    { preimage: '00'.repeat(32) },
  ])
    expect(
      await checkZapPayment(invoice, undefined, async () => ({ ...response, ...change })),
    ).toBe(false);
  let calls = 0;
  expect(
    await checkZapPayment({ ...invoice, verify: undefined }, undefined, async () => {
      calls++;
    }),
  ).toBe(false);
  await expect(
    checkZapPayment({ ...invoice, verify: 'http://127.0.0.1/private' }, undefined, async () => {
      calls++;
    }),
  ).rejects.toThrow();
  expect(calls).toBe(0);
});
