import { expect, spyOn, test } from 'bun:test';
import { NativeVault } from './accounts';
import { diagnose } from '../../diagnostics/src';

test('credential failures expose the operation and OS code without logging vault exception contents', async () => {
  const get = spyOn(Bun.secrets, 'get').mockRejectedValueOnce(
    Object.assign(new Error('This could contain an arbitrary private credential value'), {
      code: 'ERR_AUTH_FAILED',
      errno: -25293,
    }),
  );
  try {
    let error: unknown;
    try {
      await new NativeVault('test-only').get('fake-id');
    } catch (cause) {
      error = cause;
    }
    expect(get).toHaveBeenCalledTimes(1);
    const result = diagnose(error, 'soyli account');
    expect(result.code).toBe('KEYSTORE_UNAVAILABLE');
    expect(result.message).toContain('read failed');
    expect(result.message).toContain('ERR_AUTH_FAILED');
    expect(result.message).toContain('-25293');
    expect(JSON.stringify(result)).not.toContain('arbitrary private credential');
  } finally {
    get.mockRestore();
  }
});
