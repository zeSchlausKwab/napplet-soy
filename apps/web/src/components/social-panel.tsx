import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Heart, MessageCircle, Reply, Trash2, RefreshCw, Zap } from 'lucide-react';
import { Button } from './ui/button';
import { useNostr } from './nostr-provider';
import { useLocation } from '@tanstack/react-router';
import { ZapButton } from './zap-button';
import { CardShare } from './card-share';
import { jsonResponse, signForAccount, type Template } from '@/lib/community-client';
import {
  commentTemplate,
  socialScope,
  likeTemplate,
  commentLikeTemplate,
  deletionTemplate,
  type SocialScope,
} from '../../../../packages/protocol/src/social';
import type { SignedEvent } from '../../../../packages/protocol/src';
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
/** One conversation owner supplies the page toolbar and discussion without duplicate requests. */
export function NappletSocial({
  reference,
  title,
  manifest,
  relays,
  children,
}: {
  reference: string;
  title: string;
  manifest: SignedEvent;
  relays: string[];
  children: (slots: {
    actions: ReactNode;
    feedback: ReactNode;
    discussion: ReactNode;
  }) => ReactNode;
}) {
  const hash = useLocation({ select: (location) => location.hash });
  const { pubkey, connect, ready } = useNostr();
  const currentKey = useRef(pubkey);
  currentKey.current = pubkey;
  const [data, setData] = useState<SocialData | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [content, setContent] = useState(''),
    [parent, setParent] = useState<Comment | null>(null),
    [pending, setPending] = useState<SignedEvent | null>(null);
  const [headerAction, setHeaderAction] = useState(false);
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
    setHeaderAction(false);
    refresh(controller.signal).catch((error) => {
      if (!controller.signal.aborted) setMessage(error.message);
    });
    return () => controller.abort();
  }, [reference]);
  useEffect(() => {
    if (hash !== 'comments' || !data) return;
    const target = document.getElementById(pubkey ? 'napplet-comment' : 'comment-connect');
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }, [hash, !!data, pubkey]);
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
  const write = async (template: Template, fromHeader = false) => {
    setHeaderAction(fromHeader);
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
  const feedback = (
    <>
      {message && (
        <p
          role="status"
          className={
            headerAction && message === 'Published to Nostr.' ? 'sr-only' : 'community-status'
          }
        >
          {message}
        </p>
      )}
      {pending && (!headerAction || !busy) && (
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
    </>
  );
  const actions = (
    <div className="napplet-social-actions" role="group" aria-label={`Social actions for ${title}`}>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`${ownLikes.length ? 'Unlike' : 'Like'} ${title}: ${data?.likeCount ?? 'unknown'} likes${!pubkey ? ' — sign in required' : ''}`}
        title={
          !pubkey
            ? 'Sign in to like'
            : !data
              ? 'Social actions are unavailable until the conversation loads'
              : ownLikes.length
                ? 'Remove your like'
                : 'Like this napplet'
        }
        aria-pressed={!!ownLikes.length}
        disabled={!pubkey || !data || busy || !!pending}
        onClick={() => {
          if (data)
            void write(
              ownLikes.length
                ? deletionTemplate(ownLikes)
                : likeTemplate(data.scope, data.manifest),
              true,
            );
        }}
      >
        <Heart size={17} fill={ownLikes.length ? 'currentColor' : 'none'} />
        {data?.likeCount.toLocaleString() ?? '—'}
      </Button>
      <CardShare
        title={title}
        path={reference.startsWith('naddr1') ? `/n/${reference}` : `/r/${reference}`}
      />
      <ZapButton
        reference={reference}
        data={data ?? { manifest, scope: socialScope(manifest), relays }}
        trigger={
          <Button
            variant="ghost"
            size="sm"
            disabled={!ready}
            title="Zap this napplet"
            aria-label={`Zap ${title}`}
          >
            <Zap size={17} />
          </Button>
        }
      />
    </div>
  );
  const discussion = (
    <section id="comments" className="social-panel" aria-labelledby="conversation-title">
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
            setHeaderAction(false);
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
              disabled={!pubkey || busy || !!pending}
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
                  disabled={!pubkey || busy || !!pending}
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
                id="comment-connect"
                variant="outline"
                onClick={() => {
                  setHeaderAction(false);
                  void connect().catch((error) => setMessage(error.message));
                }}
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
                    <div className="comment-body">
                      <div className="comment-meta">
                        <CreatorLink pubkey={comment.pubkey} />
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
                              disabled={!pubkey || busy || !!pending}
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
                            disabled={!pubkey || busy}
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
                            disabled={!pubkey || busy || !!pending}
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
      {!headerAction && feedback}
    </section>
  );
  return children({
    actions,
    feedback: headerAction ? <div className="detail-social-feedback">{feedback}</div> : null,
    discussion,
  });
}
import { CreatorLink } from './creator-link';
