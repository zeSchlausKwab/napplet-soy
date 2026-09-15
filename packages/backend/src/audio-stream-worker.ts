import { once } from 'node:events';
import { openAudioStreamNative } from './audio-stream';
try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk.toString();
    if (input.length > 8192) throw new Error('Invalid audio input');
  }
  const { url } = JSON.parse(input);
  if (typeof url !== 'string' || url.length > 4096) throw new Error('Invalid audio URL');
  const { mime, body } = await openAudioStreamNative(
    new URL(url),
    AbortSignal.timeout(2 * 60 * 60 * 1000),
  );
  process.stdout.write(mime + '\n');
  for await (const chunk of body)
    if (!process.stdout.write(chunk)) await once(process.stdout, 'drain');
} catch {
  process.exitCode = 1;
}
