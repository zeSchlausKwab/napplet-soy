import { z } from 'zod';
import { audioUrl, AUDIO_MAX_MS, openAudioStream, type AudioStream } from './audio-stream';
import { publicLookup } from './blossom';

const inputSchema = z
  .object({ manifest: z.string().regex(/^[a-f0-9]{64}$/), url: z.string().max(4096) })
  .strict();
const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
type Ticket = {
  manifest: string;
  url: URL;
  expires: number;
  active: number;
  abort: Set<AbortController>;
};

/** Same admission, DNS and stream policy for the website and local authoring host. */
export function createAudioResponder(
  admit: (manifest: string) => Promise<unknown>,
  transport: (url: URL, signal: AbortSignal) => Promise<AudioStream> = openAudioStream,
  lookup: typeof publicLookup = publicLookup,
  hostOrigin?: () => string,
) {
  const tickets = new Map<string, Ticket>();
  const budgets = new Map<string, { start: number; count: number }>();
  const starts = new Map<string, { start: number; count: number }>();
  const pending = new Map<string, number>();
  let active = 0;
  return async (request: Request) => {
    const url = new URL(request.url);
    const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
    const hostRequest =
      request.headers.get('Origin') === (hostOrigin?.() ?? url.origin) &&
      request.headers.get('X-Space-Host') === '1';
    const now = Date.now();
    for (const [key, ticket] of tickets)
      if (ticket.expires < now) {
        ticket.abort.forEach((c) => c.abort());
        tickets.delete(key);
      }
    for (const [key, budget] of budgets) if (now - budget.start >= 60000) budgets.delete(key);
    for (const [key, budget] of starts) if (now - budget.start >= 60000) starts.delete(key);
    if (request.method === 'POST') {
      if (!hostRequest) return fail('source blocked', 403);
      let input: z.infer<typeof inputSchema>;
      try {
        const reader = request.body?.getReader();
        if (!reader) throw new Error();
        let text = '';
        try {
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            text += new TextDecoder().decode(next.value);
            if (text.length > 8192) throw new Error();
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        input = inputSchema.parse(JSON.parse(text));
      } catch {
        return fail('invalid media request', 400);
      }
      if (!(await admit(input.manifest))) return fail('napplet unavailable', 404);
      const budget = budgets.get(input.manifest) ?? { start: now, count: 0 };
      budgets.set(input.manifest, budget);
      if (
        ++budget.count > 24 ||
        tickets.size + [...pending.values()].reduce((a, b) => a + b, 0) >= 256 ||
        [...tickets.values()].filter((t) => t.manifest === input.manifest).length +
          (pending.get(input.manifest) ?? 0) >=
          8
      )
        return fail('audio session limit reached', 429);
      pending.set(input.manifest, (pending.get(input.manifest) ?? 0) + 1);
      let source: URL;
      try {
        source = audioUrl(input.url);
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('DNS timed out')), 5000);
          lookup(source.hostname, {}, (error) => {
            clearTimeout(timeout);
            error ? reject(error) : resolve();
          });
        });
      } catch {
        return fail('source blocked', 403);
      } finally {
        const count = pending.get(input.manifest)! - 1;
        if (count) pending.set(input.manifest, count);
        else pending.delete(input.manifest);
      }
      if (request.signal.aborted) return fail('request cancelled', 400);
      const token = crypto.randomUUID();
      tickets.set(token, {
        manifest: input.manifest,
        url: source,
        expires: now + AUDIO_MAX_MS,
        active: 0,
        abort: new Set(),
      });
      return Response.json({ url: `/api/media?token=${token}` }, { headers });
    }
    const token = url.searchParams.get('token') ?? '';
    const ticket = tickets.get(token);
    if (request.method === 'DELETE') {
      if (!hostRequest) return fail('source blocked', 403);
      ticket?.abort.forEach((c) => c.abort());
      tickets.delete(token);
      return new Response(null, { status: 204, headers });
    }
    // Native <audio> requests cannot carry a custom header; an opaque frame cannot
    // obtain the ticket or forge browser-controlled same-origin fetch metadata.
    if (
      request.method !== 'GET' ||
      request.headers.get('Sec-Fetch-Site') !== 'same-origin' ||
      !['audio', 'empty'].includes(request.headers.get('Sec-Fetch-Dest') ?? '')
    )
      return fail('source blocked', 403);
    if (!ticket || !(await admit(ticket.manifest))) return fail('audio session expired', 404);
    const start = starts.get(ticket.manifest) ?? { start: now, count: 0 };
    starts.set(ticket.manifest, start);
    if (++start.count > 24) return fail('audio start limit reached', 429);
    if (
      active >= 16 ||
      [...tickets.values()]
        .filter((t) => t.manifest === ticket.manifest)
        .reduce((n, t) => n + t.active, 0) >= 4
    )
      return fail('audio stream limit reached', 429);
    const controller = new AbortController();
    ticket.abort.add(controller);
    active++;
    ticket.active++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active--;
      ticket.active--;
      ticket.abort.delete(controller);
      request.signal.removeEventListener('abort', release);
      controller.abort();
    };
    request.signal.addEventListener('abort', release, { once: true });
    if (request.signal.aborted) release();
    try {
      const stream = await transport(
        ticket.url,
        AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(AUDIO_MAX_MS)]),
      );
      const reader = stream.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(output) {
          try {
            const next = await reader.read();
            if (next.done) {
              release();
              output.close();
            } else output.enqueue(next.value);
          } catch (error) {
            const cancelled = controller.signal.aborted || request.signal.aborted;
            release();
            if (cancelled) output.close();
            else output.error(error);
          }
        },
        cancel: async () => {
          release();
          await reader.cancel().catch(() => {});
        },
      });
      return new Response(body, {
        headers: {
          ...headers,
          'Content-Type': stream.mime,
          'Content-Security-Policy': "default-src 'none'; sandbox",
          'Accept-Ranges': 'none',
        },
      });
    } catch {
      release();
      return fail('audio source unavailable', 502);
    }
  };
}
