import { request } from 'node:https';
import { lookup } from 'node:dns';
import ipaddr from 'ipaddr.js';
import { MAX_ARTIFACT_BYTES, sha256 } from '../../protocol/src';

export function publicIp(address: string) {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}
export function blossomUrl(server: string, hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid blob hash');
  const url = new URL(server);
  if (
    url.protocol !== 'https:' ||
    (url.port && url.port !== '443') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Expected a public HTTPS Blossom server');
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${hash}`;
  return url;
}

/** DNS is checked in the actual connection lookup, avoiding check-then-fetch DNS rebinding. */
export function fetchPublicBlob(
  server: string,
  hash: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const url = blossomUrl(server, hash);
  return fetchPublicBytes(url, signal);
}

export function publicResourceUrl(input: string) {
  const url = new URL(input);
  if (
    url.protocol !== 'https:' ||
    (url.port && url.port !== '443') ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error('blocked-by-policy');
  return url;
}

export function fetchPublicBytes(url: URL, signal: AbortSignal): Promise<Uint8Array> {
  publicResourceUrl(url.href);
  const literal = url.hostname.replace(/^\[|\]$/g, '');
  if (ipaddr.isValid(literal) && !publicIp(literal))
    return Promise.reject(new Error('Private network destination'));
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        signal,
        lookup: (hostname, options, callback) => {
          lookup(hostname, { all: true }, (error, addresses) => {
            if (error) return callback(error, '', 4);
            if (!addresses.length || addresses.some((entry) => !publicIp(entry.address)))
              return callback(new Error('Private network destination'), '', 4);
            if (options.all) callback(null, addresses);
            else callback(null, addresses[0].address, addresses[0].family);
          });
        },
        headers: {
          Accept: '*/*',
          'User-Agent': 'napplet-space-publicdev/0.1',
        },
      },
      (response) => {
        // Redirects are not followed. Try the next signed server hint instead.
        if (
          response.statusCode !== 200 ||
          Number(response.headers['content-length']) > MAX_ARTIFACT_BYTES
        ) {
          response.destroy();
          reject(new Error(`Blossom response refused (${response.statusCode})`));
          return;
        }
        const chunks: Buffer[] = [];
        let length = 0;
        response.on('data', (chunk: Buffer) => {
          length += chunk.length;
          if (length > MAX_ARTIFACT_BYTES) response.destroy(new Error('Artifact exceeds 10 MiB'));
          else chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks, length))));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

export async function downloadArtifact(servers: string[], hash: string, signal: AbortSignal) {
  for (const server of [...new Set(servers)].slice(0, 4)) {
    if (signal.aborted) break;
    try {
      const bytes = await fetchPublicBlob(
        server,
        hash,
        AbortSignal.any([signal, AbortSignal.timeout(3000)]),
      );
      if ((await sha256(bytes)) !== hash) continue;
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return bytes;
    } catch {
      /* A missing or incorrect mirror can be followed by another signed hint. */
    }
  }
  throw new Error('No hash-verified artifact available from the signed server hints');
}
