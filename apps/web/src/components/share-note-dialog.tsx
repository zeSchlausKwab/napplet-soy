import { useEffect, useId, useRef, useState } from 'react';
import { Check, Send, Type, Film, Image, Expand, Hash } from 'lucide-react';
import { browserIdentity } from '@/lib/browser-identity';
import { signForAccount } from '@/lib/community-client';
import { protocolClient } from '@/lib/network';
import type { SignedEvent } from '../../../../packages/protocol/src';
import {
  createShareDraft,
  editShareDraft,
  toggleSharePart,
  shareNoteTemplate,
  MAX_SHARE_CHARACTERS,
  type ShareDraft,
  type ShareNoteSource,
} from '../../../../packages/client/src/share-note';
import { useNostr } from './nostr-provider';
import { CreatorLink } from './creator-link';
import { ActionButton } from './action-button';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';

export function ShareNoteDialog({
  source,
  path,
  open,
  onOpenChange,
  returnFocus,
}: {
  source: ShareNoteSource;
  path: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus: () => void;
}) {
  const { pubkey, ready, connect } = useNostr();
  const inputId = useId();
  const [draft, setDraft] = useState<ShareDraft | null>(null);
  const [media, setMedia] = useState(source.media);
  const [pending, setPending] = useState<SignedEvent | null>(null);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const [posted, setPosted] = useState(false);
  const locked = useRef(false);
  const generation = useRef(0);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current && (!draft || posted)) {
      setDraft(createShareDraft(source, new URL(`${path}/play`, location.origin).href));
      setMedia(source.media);
      setError('');
      setPending(null);
      setPosted(false);
    }
    wasOpen.current = open;
    if (!open) generation.current++;
  }, [open, source, path, posted, draft]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useEffect(() => {
    if (!posted || !open) return;
    const timer = setTimeout(() => onOpenChange(false), 1200);
    return () => clearTimeout(timer);
  }, [posted, open, onOpenChange]);

  async function post() {
    if (!draft || !pubkey || locked.current || posted) return;
    if (pending && pending.pubkey !== pubkey) return;
    locked.current = true;
    const run = ++generation.current;
    const author = pubkey;
    setError('');
    setPhase(pending ? 'Publishing…' : 'Signing…');
    try {
      const event =
        pending ?? (await signForAccount(author, shareNoteTemplate(draft.content, media)));
      if (run !== generation.current) return;
      if (browserIdentity().state.pubkey !== author)
        throw new Error(
          'Your account changed. Review the draft and post with your selected account.',
        );
      setPending(event);
      setPhase('Publishing…');
      await protocolClient().publish(event);
      // Acknowledgement is final even if the dialog was closed while relays replied.
      setPending(null);
      setPosted(true);
    } catch (cause) {
      if (run === generation.current)
        setError(cause instanceof Error ? cause.message : 'Could not post. Please retry.');
    } finally {
      locked.current = false;
      setPhase('');
    }
  }
  const frozen = !!phase || !!pending || posted;
  const postingAs = pending?.pubkey ?? pubkey;
  const accountChanged = !!pending && pending.pubkey !== pubkey;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="share-note-dialog"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
      >
        <DialogHeader>
          <span className="eyebrow">PASS IT AROUND</span>
          <DialogTitle>Put a napplet in someone’s feed.</DialogTitle>
          <DialogDescription>Make the note yours, then post it to Nostr.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void post();
          }}
        >
          <fieldset className="share-note-parts" disabled={frozen}>
            <legend>Include in your note</legend>
            <div>
              {draft?.parts.map((part) => {
                const Icon =
                  part.id === 'media'
                    ? media?.type === 'video'
                      ? Film
                      : Image
                    : part.id === 'player'
                      ? Expand
                      : ['soy', 'topics'].includes(part.id)
                        ? Hash
                        : Type;
                return (
                  <Button
                    key={part.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    data-tone="blue"
                    aria-pressed={part.start !== null}
                    onClick={() => setDraft((value) => value && toggleSharePart(value, part.id))}
                  >
                    {part.start !== null ? <Check size={14} /> : <Icon size={14} />}
                    {part.label}
                  </Button>
                );
              })}
            </div>
          </fieldset>
          <label className="share-note-label" htmlFor={inputId}>
            Your note
          </label>
          <textarea
            id={inputId}
            value={draft?.content ?? ''}
            rows={9}
            disabled={frozen}
            maxLength={MAX_SHARE_CHARACTERS}
            onChange={(event) => {
              setDraft((value) => value && editShareDraft(value, event.target.value));
              setError('');
            }}
          />
          <div className="share-note-footer">
            <div className="share-note-author">
              <span>{postingAs ? 'Posting publicly as' : 'Sign in to post this note'}</span>
              {postingAs && <CreatorLink pubkey={postingAs} linked={false} />}
            </div>
            {pubkey ? (
              <ActionButton
                type="submit"
                data-tone="blue"
                data-effect="share"
                icon={<Send size={16} />}
                working={phase}
                error={
                  accountChanged
                    ? 'Switch back to the signing account to retry this note, or stop retrying to edit it.'
                    : error
                }
                retryLabel="Retry post"
                success={posted ? 'Posted to Nostr' : ''}
                onCancel={
                  pending
                    ? () => {
                        setPending(null);
                        setError('');
                      }
                    : undefined
                }
                disabled={!ready || !draft?.content.trim() || posted || accountChanged}
              >
                Post to Nostr
              </ActionButton>
            ) : (
              <Button
                type="button"
                disabled={!ready}
                onClick={() => {
                  onOpenChange(false);
                  void connect();
                }}
              >
                Sign in to post
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
