import { PrivateKeySigner } from '@contextvm/sdk/signer';
import { CvmConnection, validateProvider } from '../packages/multiplayer/src/client';
const relays = (process.env.SPACE_CVM_RELAYS ?? '').split(',').filter(Boolean);
const provider = validateProvider({ pubkey: process.env.SPACE_CVM_PUBKEY, relays }, relays);
for (let attempt = 0; attempt < 3; attempt++) {
  const connection = new CvmConnection(provider, new PrivateKeySigner());
  try {
    const result = await connection.tool('soy_session');
    if (result.version !== 1) throw new Error('Wrong backend contract');
    break;
  } catch (error) {
    if (attempt === 2) throw error;
    await Bun.sleep(500);
  } finally {
    await connection.close();
  }
}
