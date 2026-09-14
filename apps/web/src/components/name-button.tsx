import { useEffect, useState } from 'react';
import { Link2 } from 'lucide-react';
import { useNostr } from './nostr-provider';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import { claimName, jsonResponse } from '@/lib/community-client';
export function NameButton({ naddr, author }: { naddr: string; author: string }) {
  const { pubkey } = useNostr();
  const [open, setOpen] = useState(false),
    [handle, setHandle] = useState(''),
    [slug, setSlug] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [paths, setPaths] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    fetch(`/api/names?naddr=${encodeURIComponent(naddr)}`)
      .then(jsonResponse)
      .then((v) => {
        if (active)
          setPaths(
            v.aliases.map((a: { handle: string; slug: string }) => `/@${a.handle}/${a.slug}`),
          );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [naddr]);
  if (pubkey !== author && !paths.length) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Link2 size={16} />
          Named link
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>A home for this napplet</DialogTitle>
          <DialogDescription>
            A permanent readable link that follows new releases. Its Nostr address stays the same.
          </DialogDescription>
        </DialogHeader>
        {paths.map((path) => (
          <a key={path} className="named-link" href={path}>
            {path}
          </a>
        ))}
        {pubkey === author && (
          <form
            className="community-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setMessage('');
              try {
                const { alias } = await claimName(pubkey, { handle, slug, naddr });
                setPaths((p) => [...new Set([...p, `/@${alias.handle}/${alias.slug}`])]);
                setMessage('Your named link is ready.');
              } catch (error) {
                setMessage((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Creator handle
              <input
                value={handle}
                onChange={(e) => setHandle(e.target.value.toLowerCase())}
                placeholder="alice"
                minLength={3}
                maxLength={32}
                pattern="[a-z0-9-]+"
                required
                disabled={busy}
              />
            </label>
            <label>
              Napplet slug
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                placeholder="pixel-rain"
                maxLength={64}
                pattern="[a-z0-9-]+"
                required
                disabled={busy}
              />
            </label>
            <p className="muted">
              One handle per account. Each link stays attached to this creation permanently.
            </p>
            <Button disabled={busy}>{busy ? 'Signing claim…' : 'Claim /@handle/slug'}</Button>
          </form>
        )}
        {message && <p role="status">{message}</p>}
      </DialogContent>
    </Dialog>
  );
}
