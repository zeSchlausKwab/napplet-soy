import { useEffect, useRef, useState } from 'react';
import { Heart, MessageCircle, Reply, Trash2, RefreshCw, Zap } from 'lucide-react';
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
import { jsonResponse, signForAccount, type Template } from '@/lib/community-client';
import {
  commentTemplate,
  likeTemplate,
  commentLikeTemplate,
  deletionTemplate,
  type SocialScope,
} from '../../../../packages/protocol/src/social';
import type { SignedEvent } from '../../../../packages/protocol/src';
import type { ZapEndpoint } from '../../../../packages/backend/src/zaps';
type Comment = SignedEvent & {
  deleted: boolean;
  parent: string | null;
  likes: SignedEvent[];
  likeCount: number;
};
type SocialData = {
  scope: SocialScope;
  manifest: SignedEvent;
  relays: string[];
  comments: Comment[];
  likes: SignedEvent[];
  likeCount: number;
  profiles: Record<string, { name: string }>;
  lastActions: Record<string, number>;
};
const short = (pubkey: string) => `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
export function SocialPanel({ reference }: { reference: string }) {
  const { pubkey, connect } = useNostr();
  const currentKey = useRef(pubkey);
  currentKey.current = pubkey;
  const [data, setData] = useState<SocialData | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [content, setContent] = useState(''),
    [parent, setParent] = useState<Comment | null>(null),
    [pending, setPending] = useState<SignedEvent | null>(null);
  const endpoint = `/api/social?reference=${encodeURIComponent(reference)}`;
  const refresh = async (signal?: AbortSignal) => {
    const value = await jsonResponse(await fetch(endpoint, { signal }));
    setData(value);
  };
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setPending(null);
    setParent(null);
    setContent('');
    setMessage('');
    refresh(controller.signal).catch((error) => {
      if (!controller.signal.aborted) setMessage(error.message);
    });
    return () => controller.abort();
  }, [reference]);
  const deliver = async (event: SignedEvent) => {
    if (currentKey.current !== event.pubkey)
      throw new Error('Connect the signing account again before sending.');
    await jsonResponse(
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(event),
      }),
    );
    setPending(null);
    if (event.kind === 1111) {
      setContent('');
      setParent(null);
    }
    setMessage('Published to Nostr.');
    await refresh().catch(() =>
      setMessage(
        'Published to Nostr. The conversation could not refresh; try Refresh before posting again.',
      ),
    );
  };
  const write = async (template: Template) => {
    if (!pubkey) {
      try {
        await connect();
      } catch (error) {
        setMessage((error as Error).message);
      }
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const event = await signForAccount(pubkey, {
        ...template,
        created_at: Math.max(template.created_at, (data?.lastActions[pubkey] ?? 0) + 1),
      });
      if (currentKey.current !== pubkey) throw new Error('Your connected account changed.');
      setPending(event);
      await deliver(event);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const ownLikes = data?.likes.filter((e) => e.pubkey === pubkey) ?? [];
  return (
    <section className="social-panel" aria-labelledby="conversation-title">
      <div className="social-heading">
        <div>
          <span className="eyebrow">PASS IT AROUND</span>
          <h2 id="conversation-title">Small creation, open conversation.</h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await refresh();
              setMessage('Conversation refreshed.');
            } catch (error) {
              setMessage((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <RefreshCw size={15} />
          Refresh
        </Button>
      </div>
      {data && (
        <>
          <div className="social-actions">
            <Button
              variant={ownLikes.length ? 'default' : 'outline'}
              aria-pressed={!!ownLikes.length}
              disabled={busy || !!pending}
              onClick={() =>
                write(
                  ownLikes.length
                    ? deletionTemplate(ownLikes)
                    : likeTemplate(data.scope, data.manifest),
                )
              }
            >
              <Heart size={16} fill={ownLikes.length ? 'currentColor' : 'none'} />
              {data.likeCount} {data.likeCount === 1 ? 'like' : 'likes'}
            </Button>
            <ZapButton data={data} reference={reference} />
            <span className="comment-count">
              <MessageCircle size={16} />
              {data.comments.filter((e) => !e.deleted).length}{' '}
              {data.comments.filter((e) => !e.deleted).length === 1 ? 'comment' : 'comments'}
            </span>
          </div>
          {pubkey ? (
            <form
              className="community-form comment-form"
              onSubmit={(e) => {
                e.preventDefault();
                void write(commentTemplate(data.scope, content, parent ?? undefined));
              }}
            >
              {parent && (
                <div className="reply-context">
                  Replying to {data.profiles[parent.pubkey]?.name ?? short(parent.pubkey)}
                  <Button size="xs" variant="ghost" type="button" onClick={() => setParent(null)}>
                    Cancel reply
                  </Button>
                </div>
              )}
              <label htmlFor="napplet-comment">
                {parent ? 'Your reply' : 'Leave a little note'}
                <textarea
                  id="napplet-comment"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  maxLength={4000}
                  placeholder="What did you make of this one?"
                  required
                  disabled={busy || !!pending}
                />
              </label>
              <div className="comment-submit">
                <span className="muted">
                  Signed by {data.profiles[pubkey]?.name ?? short(pubkey)} · posted publicly on
                  Nostr
                </span>
                <Button disabled={busy || !!pending || !content.trim()}>
                  {busy ? 'Sending…' : parent ? 'Post reply' : 'Post comment'}
                </Button>
              </div>
            </form>
          ) : (
            <div className="social-connect">
              <p>Bring your Nostr identity to the conversation.</p>
              <Button
                variant="outline"
                onClick={() => connect().catch((error) => setMessage(error.message))}
              >
                Connect to comment or like
              </Button>
            </div>
          )}
          <div className="comment-list">
            {data.comments.length === 0 ? (
              <p className="muted">No comments found yet. Be the first to leave one.</p>
            ) : (
              data.comments.map((comment) => {
                const repliedTo = comment.parent
                  ? data.comments.find((e) => e.id === comment.parent)
                  : null;
                const commentLikes = comment.likes?.filter((e) => e.pubkey === pubkey) ?? [];
                return (
                  <article key={comment.id} className="comment" id={`comment-${comment.id}`}>
                    <div className="comment-avatar" aria-hidden>
                      {(data.profiles[comment.pubkey]?.name ?? comment.pubkey)
                        .slice(0, 1)
                        .toUpperCase()}
                    </div>
                    <div className="comment-body">
                      <div className="comment-meta">
                        <span title={comment.pubkey}>
                          {data.profiles[comment.pubkey]?.name ?? short(comment.pubkey)}
                        </span>
                        <time dateTime={new Date(comment.created_at * 1000).toISOString()}>
                          {new Date(comment.created_at * 1000).toLocaleDateString()}
                        </time>
                      </div>
                      {comment.parent && (
                        <a className="reply-reference" href={`#comment-${comment.parent}`}>
                          ↳ Reply to{' '}
                          {repliedTo
                            ? (data.profiles[repliedTo.pubkey]?.name ?? short(repliedTo.pubkey))
                            : 'an earlier comment'}
                        </a>
                      )}
                      <p className={comment.deleted ? 'muted' : ''}>
                        {comment.deleted ? 'Comment deleted by its author.' : comment.content}
                      </p>
                      <div className="comment-tools">
                        {!comment.deleted && (
                          <>
                            <Button
                              size="xs"
                              variant="ghost"
                              aria-label={`Like comment by ${data.profiles[comment.pubkey]?.name ?? short(comment.pubkey)}`}
                              aria-pressed={commentLikes.length > 0}
                              disabled={busy || !!pending}
                              onClick={() =>
                                write(
                                  commentLikes.length
                                    ? deletionTemplate(commentLikes)
                                    : commentLikeTemplate(comment),
                                )
                              }
                            >
                              <Heart
                                size={13}
                                fill={commentLikes.length ? 'currentColor' : 'none'}
                              />{' '}
                              {comment.likeCount ?? 0}
                            </Button>
                            <ZapButton data={data} reference={reference} commentTarget={comment} />
                          </>
                        )}

                        {!comment.deleted && (
                          <Button
                            size="xs"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => {
                              setParent(comment);
                              document.getElementById('napplet-comment')?.focus();
                            }}
                          >
                            <Reply size={13} />
                            Reply
                          </Button>
                        )}
                        {pubkey === comment.pubkey && !comment.deleted && (
                          <Button
                            size="xs"
                            variant="ghost"
                            disabled={busy || !!pending}
                            onClick={() => write(deletionTemplate([comment]))}
                          >
                            <Trash2 size={13} />
                            Delete
                          </Button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
          <p className="social-footnote">
            Showing recent events available from this client’s relays. Counts may differ across
            clients. Updates appear on refresh; deletion requests cannot recall copies held
            elsewhere.
          </p>
        </>
      )}
      {!data && !message && <p role="status">Finding the conversation…</p>}
      {message && (
        <p role="status" className="community-status">
          {message}
        </p>
      )}
      {pending && (
        <div className="pending-action">
          <p>
            Your signed action is ready. Retry sends the same event, so it won’t create a duplicate.
          </p>
          <Button
            disabled={busy || pubkey !== pending.pubkey}
            variant="outline"
            onClick={async () => {
              setBusy(true);
              try {
                await deliver(pending);
              } catch (error) {
                setMessage((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Retry signed action
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setPending(null);
              setMessage(
                'Stopped retrying. The event may still have reached a relay; refresh before posting again.',
              );
            }}
          >
            Dismiss
          </Button>
        </div>
      )}
    </section>
  );
}
function ZapButton({
  data,
  reference,
  commentTarget,
}: {
  data: SocialData;
  reference: string;
  commentTarget?: Comment;
}) {
  const { pubkey, connect } = useNostr();
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
    [webln, setWebln] = useState(false);
  const target = commentTarget ?? data.manifest;
  const url = `/api/zaps?reference=${encodeURIComponent(reference)}${commentTarget ? `&comment=${commentTarget.id}` : ''}`;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setMessage('');
    setEndpoint(null);
    setInvoice(null);
    setWebln(!!(window as any).webln);
    fetch(url, { signal: controller.signal })
      .then(jsonResponse)
      .then((value) => {
        setEndpoint(value.endpoint);
        setTotal(value.msats);
        setSats(String(Math.max(21, Math.ceil(value.endpoint.minSendable / 1000))));
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
        <Button
          variant={commentTarget ? 'ghost' : 'outline'}
          size={commentTarget ? 'xs' : 'default'}
          aria-label={commentTarget ? 'Zap comment' : undefined}
        >
          <Zap size={16} />
          {total === null ? 'Zap' : `${(total / 1000).toLocaleString()} sats zapped`}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {commentTarget
              ? 'A little lightning for the commenter'
              : 'A little lightning for the creator'}
          </DialogTitle>
          <DialogDescription>
            Send sats directly to the author’s Lightning service. A zap request is public; your
            wallet confirms the payment.
          </DialogDescription>
        </DialogHeader>
        {endpoint && !invoice && (
          <form
            className="community-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!pubkey) {
                try {
                  await connect();
                } catch (error) {
                  setMessage((error as Error).message);
                }
                return;
              }
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
                const relays = data.relays.filter((r) => r.startsWith('wss:')).slice(0, 6);
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
                const event = await signForAccount(pubkey, template);
                if (keyRef.current !== pubkey) throw new Error('Your account changed.');
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
              {busy ? 'Preparing invoice…' : pubkey ? 'Create zap invoice' : 'Connect to zap'}
            </Button>
          </form>
        )}
        {invoice && (
          <div className="zap-invoice">
            <strong>
              {(invoice.msats / 1000).toLocaleString()} sats to {short(target.pubkey)}
            </strong>
            <p>Invoice ready. Choose your wallet to pay.</p>
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
