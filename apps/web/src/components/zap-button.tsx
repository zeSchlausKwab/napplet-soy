import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Zap } from 'lucide-react';
import { Button } from './ui/button';
import { useNostr } from './nostr-provider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import { jsonResponse, signForAccount, signAnonymousZap } from '@/lib/community-client';
import type { SignedEvent } from '../../../../packages/protocol/src';
import type { SocialScope } from '../../../../packages/protocol/src/social';
import type { ZapEndpoint } from '../../../../packages/backend/src/zaps';
import { LightningCode } from './lightning-code';
const short = (pubkey: string) => `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
export function ZapButton({
  data,
  reference,
  commentTarget,
  trigger,
}: {
  data: { manifest: SignedEvent; scope: SocialScope; relays: string[] };
  reference: string;
  commentTarget?: SignedEvent;
  trigger?: ReactElement;
}) {
  const { pubkey } = useNostr();
  const keyRef = useRef(pubkey);
  keyRef.current = pubkey;
  const [open, setOpen] = useState(false),
    [endpoint, setEndpoint] = useState<ZapEndpoint | null>(null),
    [sats, setSats] = useState('21'),
    [comment, setComment] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [invoice, setInvoice] = useState<{ invoice: string; msats: number; expiresAt: number } | null>(
      null,
    ),
    [total, setTotal] = useState<number | null>(null),
    [webln, setWebln] = useState(false),
    [relayHints, setRelayHints] = useState(data.relays),
    [anonymous, setAnonymous] = useState(!pubkey);
  const asAnonymous = !pubkey || anonymous;
  const target = commentTarget ?? data.manifest;
  const url = `/api/zaps?reference=${encodeURIComponent(reference)}${commentTarget ? `&comment=${commentTarget.id}` : ''}`;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setMessage('');
    setEndpoint(null);
    setInvoice(null);
    setAnonymous(!pubkey);
    setWebln(!!(window as any).webln);
    fetch(url, { signal: controller.signal })
      .then(jsonResponse)
      .then((value) => {
        if (controller.signal.aborted) return;
        setEndpoint(value.endpoint);
        setRelayHints(value.relays ?? data.relays);
        setTotal(value.msats);
        setSats(
          String(
            Math.min(
              Math.floor(value.endpoint.maxSendable / 1000),
              Math.max(21, Math.ceil(value.endpoint.minSendable / 1000)),
            ),
          ),
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted) setMessage(error.message);
      });
    return () => controller.abort();
  }, [open, url]);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button
            variant={commentTarget ? 'ghost' : 'outline'}
            size={commentTarget ? 'xs' : 'default'}
            aria-label={commentTarget ? 'Zap comment' : undefined}
          >
            <Zap size={16} />
            {total === null ? 'Zap' : `${(total / 1000).toLocaleString()} sats zapped`}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="zap-dialog">
        <DialogHeader>
          <DialogTitle>
            {commentTarget
              ? 'A little lightning for the commenter'
              : 'A little lightning for the creator'}
          </DialogTitle>
          <DialogDescription>
            Send sats directly to the author’s Lightning service. Choose and confirm payment in your
            wallet.
          </DialogDescription>
        </DialogHeader>
        {endpoint && !invoice && (
          <form
            className="community-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setMessage('');
              try {
                const msats = Number(sats) * 1000;
                if (
                  !Number.isSafeInteger(msats) ||
                  msats < endpoint.minSendable ||
                  msats > endpoint.maxSendable
                )
                  throw new Error('Choose an amount within the displayed range.');
                const relays = relayHints.filter((r) => r.startsWith('wss:')).slice(0, 6);
                if (!relays.length)
                  throw new Error(
                    'Zaps need public relays. Local-only development does not send Lightning requests.',
                  );
                const template = {
                  kind: 9734,
                  created_at: Math.floor(Date.now() / 1000),
                  content: comment,
                  tags: [
                    ['p', endpoint.pubkey],
                    ['e', target.id],
                    ['k', String(target.kind)],
                    ...(!commentTarget && data.scope.address ? [['a', data.scope.address]] : []),
                    ['amount', String(msats)],
                    ['lnurl', endpoint.lnurl],
                    ['relays', ...relays],
                  ],
                };
                const event = asAnonymous
                  ? await signAnonymousZap(template)
                  : await signForAccount(pubkey!, template);
                if (!asAnonymous && keyRef.current !== pubkey)
                  throw new Error('Your account changed.');
                setInvoice(
                  await jsonResponse(
                    await fetch(url, {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify(event),
                    }),
                  ),
                );
              } catch (error) {
                setMessage((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {pubkey && (
              <label className="anonymous-choice">
                <input
                  type="checkbox"
                  checked={anonymous}
                  disabled={busy}
                  onChange={(event) => setAnonymous(event.target.checked)}
                />
                Zap anonymously
              </label>
            )}
            {asAnonymous && (
              <p className="muted">
                A fresh one-time key signs this zap. Your Nostr profile is not attached; the payment
                and receipt remain public.
              </p>
            )}
            <label>
              Satoshis
              <input
                type="number"
                min={Math.ceil(endpoint.minSendable / 1000)}
                max={Math.floor(endpoint.maxSendable / 1000)}
                step="1"
                value={sats}
                onChange={(e) => setSats(e.target.value)}
                required
                disabled={busy}
              />
            </label>
            <p className="muted">
              {Math.ceil(endpoint.minSendable / 1000).toLocaleString()}–
              {Math.floor(endpoint.maxSendable / 1000).toLocaleString()} sats ·{' '}
              {new URL(endpoint.callback).hostname}
            </p>
            {endpoint.commentAllowed > 0 && (
              <label>
                Note (optional)
                <input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  maxLength={endpoint.commentAllowed}
                  disabled={busy}
                />
              </label>
            )}
            <Button disabled={busy}>
              {busy
                ? 'Preparing invoice…'
                : asAnonymous
                  ? 'Create anonymous zap invoice'
                  : 'Create zap invoice'}
            </Button>
          </form>
        )}
        {invoice && (
          <div className="zap-invoice">
            <strong>
              {(invoice.msats / 1000).toLocaleString()} sats to {short(target.pubkey)}
            </strong>
            <p>Invoice ready. Choose your wallet to pay.</p>
            <LightningCode value={invoice.invoice} label="Zap invoice QR code" />
            <textarea aria-label="Lightning invoice" readOnly value={invoice.invoice} />
            <div className="social-actions">
              <Button asChild>
                <a href={`lightning:${invoice.invoice}`}>Open Lightning wallet</a>
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  navigator.clipboard
                    .writeText(invoice.invoice)
                    .then(() => setMessage('Invoice copied.'))
                    .catch(() => setMessage('Select and copy the invoice above.'))
                }
              >
                Copy invoice
              </Button>
              {webln && (
                <Button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setMessage('');
                    try {
                      if (invoice.expiresAt <= Date.now() / 1000)
                        throw new Error('This invoice has expired. Create another.');
                      const wallet = (window as any).webln;
                      await wallet.enable();
                      await wallet.sendPayment(invoice.invoice);
                      setMessage(
                        'Your wallet reports payment sent. The public zap count updates when a verified receipt arrives.',
                      );
                    } catch (error) {
                      setMessage((error as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Pay with browser wallet
                </Button>
              )}
            </div>
            <p className="muted">
              Expires {new Date(invoice.expiresAt * 1000).toLocaleTimeString()}. Keep this invoice
              until your wallet confirms its status.
            </p>
          </div>
        )}
        {!endpoint && !message && <p role="status">Looking up the creator’s Lightning address…</p>}
        {message && <p role="status">{message}</p>}
      </DialogContent>
    </Dialog>
  );
}
