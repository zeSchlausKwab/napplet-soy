import { z } from 'zod';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { matchFilters } from 'nostr-tools';
import { ProtocolClient } from '../../client/src/nostr';
import { verifiedEvent, type SignedEvent } from '../../protocol/src';
import { readRelayUrl } from '../../nostr/src/relay-policy';
import { redactDiagnostic } from '../../diagnostics/src';
import {
  APP_DATA_PROFILE,
  APP_DATA_KIND,
  APP_DATA_MAX_BYTES,
  decodeDataRecord,
  type DataPolicy,
} from '../../app-data/src/app-data-contract';
import { signExact, type ActionConsent, type ActionIO } from './action-session';
import type { HostSign } from './action-contracts';

export function appDataPolicy(identity: string, relays: string[]): DataPolicy {
  // Verified author + stable napplet identifier; content upgrades do not change ownership.
  const stable = identity.replace(/:[a-f0-9]{64}$/, '');
  return {
    profile: APP_DATA_PROFILE,
    scope: bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([APP_DATA_PROFILE, stable])))),
    maxContentBytes: APP_DATA_MAX_BYTES,
    relays: [...relays],
    defaultRelays: relays.slice(0, 1),
  };
}
const templateSchema = z
  .object({
    kind: z.literal(APP_DATA_KIND),
    content: z.string().max(APP_DATA_MAX_BYTES),
    tags: z.array(z.array(z.string().max(256)).min(2).max(3)).length(6),
    created_at: z.number().int().nonnegative(),
  })
  .strict();
const locks = new Set<string>();

/** Constrained public records, never arbitrary event signing. Same host in preview/web. */
export class NappletAppData {
  private pending = new Map<string, SignedEvent>();
  private clients = new Set<ProtocolClient>();
  private busy = false;
  constructor(
    private options: {
      policy: DataPolicy;
      pubkey: string | null;
      sign?: HostSign;
      signal: AbortSignal;
      consent: ActionConsent;
      io?: ActionIO;
    },
  ) {}
  close() {
    for (const client of this.clients) client.close();
    this.clients.clear();
    this.pending.clear();
  }
  async handle(message: Record<string, unknown>) {
    if (!this.options.pubkey || !this.options.sign)
      return { ok: false, error: 'not-signed-in: connect a viewer identity to publish app data.' };
    if (this.busy)
      return { ok: false, error: 'app-data-busy: finish the pending publication first.' };
    this.busy = true;
    const signal = AbortSignal.any([this.options.signal, AbortSignal.timeout(28000)]);
    try {
      return await new Promise<Record<string, unknown>>((resolve) => {
        const abort = () =>
          resolve({
            ok: false,
            error:
              'app-data-cancelled: identity, player or request lifetime changed. Check the record before retrying.',
          });
        signal.addEventListener('abort', abort, { once: true });
        void this.perform(message, signal)
          .then(resolve, (error) =>
            resolve({
              ok: false,
              error:
                error instanceof z.ZodError
                  ? 'app-data-invalid-request: only documented kind-30078 records and configured relay destinations can be published.'
                  : redactDiagnostic(
                      error instanceof Error
                        ? error.message
                        : 'app-data-failed: retry the operation.',
                      700,
                    ),
            }),
          )
          .finally(() => signal.removeEventListener('abort', abort));
        if (signal.aborted) abort();
      });
    } finally {
      this.busy = false;
    }
  }
  private async perform(message: Record<string, unknown>, signal: AbortSignal) {
    signal.throwIfAborted();
    const template = templateSchema.parse(message.event);
    const record = decodeDataRecord(template);
    if (record.scope !== this.options.policy.scope)
      throw new Error(
        'app-data-scope-mismatch: this napplet can only publish in its own namespace. Copy foreign records to a new local ID.',
      );
    const now = Math.floor(Date.now() / 1000);
    if (template.created_at > now + 60 || template.created_at < now - 86400)
      throw new Error('app-data-invalid-time: check your clock and prepare the change again.');
    const settings = z
      .object({
        relays: z.array(z.string().max(256)).min(1).max(8).optional(),
        toOutbox: z.boolean().optional(),
        toInboxes: z.array(z.string()).max(0).optional(),
      })
      .strict()
      .parse(message.options ?? {});
    const configured = [
      ...new Set(
        this.options.policy.relays.map((r) => readRelayUrl(r, this.options.policy.relays, true)),
      ),
    ];
    const requested = settings.relays?.map((r) => readRelayUrl(r, configured, true));
    if (requested?.some((r) => !configured.includes(r)))
      throw new Error(
        'app-data-relay-not-configured: add this relay in host Network settings before publishing there.',
      );
    const relays =
      settings.toOutbox === false
        ? (requested ?? [])
        : [...new Set([...configured, ...(requested ?? [])])];
    if (!relays.length)
      throw new Error(
        'app-data-no-relays: choose at least one public app-data relay in Network settings.',
      );
    const pubkey = this.options.pubkey!;
    const lock = `${pubkey}:${record.identifier}`;
    const edit = async () => {
      if (locks.has(lock))
        throw new Error('app-data-busy: this record is being edited in another player.');
      locks.add(lock);
      const client = new ProtocolClient(() => relays);
      this.clients.add(client);
      const io =
        this.options.io ??
        ({
          query: (filters, s, complete) => client.query(filters, [], s, undefined, complete),
          publish: (event, s) => client.publish(event, [], s),
        } satisfies ActionIO);
      const key = JSON.stringify(template);
      try {
        const read = async () => {
          const filters = [
            { kinds: [APP_DATA_KIND], authors: [pubkey], '#d': [record.identifier], limit: 1 },
          ];
          let events: SignedEvent[];
          try {
            events = await io.query(filters, signal, true);
          } catch {
            signal.throwIfAborted();
            throw new Error(
              'app-data-read-incomplete: a selected relay did not complete the current-record lookup. Check Network settings and retry; no further write was sent.',
            );
          }
          signal.throwIfAborted();
          return events
            .map(verifiedEvent)
            .filter((e) => matchFilters(filters, e))
            .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0];
        };
        let pending = this.pending.get(key);
        const check = async () => {
          const current = await read();
          // A relay may have stored our event even when its acknowledgement was lost.
          if (pending && current?.id === pending.id) return;
          if ((current?.id ?? null) !== record.body.previous)
            throw new Error(
              'app-data-conflict: the record changed. Reload it and prepare your edit against its current revision.',
            );
          if (current) {
            decodeDataRecord(current);
            if (template.created_at <= current.created_at)
              throw new Error(
                'app-data-invalid-time: the edit must be newer than the current record. Prepare it again.',
              );
          }
        };
        await check();
        if (
          !(await this.options.consent(
            `${record.body.deleted ? 'Unpublish' : 'Publish'} ${record.collection}: ${record.body.title}\nSchema: ${record.body.schema} v${record.body.version}\n${new TextEncoder().encode(template.content).length} bytes of public app data.\n${record.body.deleted ? 'This hides the current record. Old copies and linked Blossom files are not erased.' : 'Anyone with access to these relays can read and copy this data. Do not include secrets.'}\n\nSigned by ${pubkey}. Public on:\n${relays.join('\n')}`,
            signal,
          ))
        )
          throw new Error('user-denied: app data was not published.');
        signal.throwIfAborted();
        await check();
        if (!pending) {
          pending = await signExact(this.options.sign!, pubkey, template, signal);
          if (this.pending.size >= 16) this.pending.delete(this.pending.keys().next().value!);
          this.pending.set(key, pending);
        }
        await check();
        signal.throwIfAborted();
        let accepted: unknown;
        try {
          accepted = await io.publish(pending, signal);
        } catch (error) {
          signal.throwIfAborted();
          throw new Error(
            `app-data-publish-failed: ${redactDiagnostic(error instanceof Error ? error.message : 'No relay acknowledged the event.', 400)} Retry this same prepared change; keep your local draft.`,
          );
        }
        signal.throwIfAborted();
        // Keep a bounded retry entry so a repeat click does not conflict with its own success.
        return {
          ok: true,
          event: pending,
          eventId: pending.id,
          ...(Array.isArray(accepted)
            ? {
                relays: Object.fromEntries(
                  relays.map((relay) => [relay, accepted.includes(relay)]),
                ),
              }
            : {}),
        };
      } finally {
        locks.delete(lock);
        client.close();
        this.clients.delete(client);
      }
    };
    if (typeof navigator !== 'undefined' && navigator.locks)
      return navigator.locks.request(`napplet-data:${lock}`, { ifAvailable: true }, (held) => {
        if (!held) throw new Error('app-data-busy: this record is being edited in another tab.');
        return edit();
      });
    return edit();
  }
}
