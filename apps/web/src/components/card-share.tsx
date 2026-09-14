import { useEffect, useRef, useState } from 'react';
import { Check, Share2 } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';

export function CardShare({ title, path }: { title: string; path: string }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  const [fallback, setFallback] = useState('');
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <>
      <Button
        ref={trigger}
        variant="ghost"
        size="sm"
        className="card-share"
        title={copied ? 'Link copied' : 'Copy napplet link'}
        aria-label={`Share ${title}`}
        onClick={async () => {
          const url = location.origin + path;
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          } catch {
            setFallback(url);
          }
        }}
      >
        {copied ? <Check size={15} /> : <Share2 size={15} />}
      </Button>
      <span role="status" className="sr-only">
        {copied ? 'Link copied' : ''}
      </span>
      <Dialog
        open={!!fallback}
        onOpenChange={(open) => {
          if (!open) setFallback('');
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Share {title}</DialogTitle>
            <DialogDescription>Copy this link to share the napplet.</DialogDescription>
          </DialogHeader>
          <input
            className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Napplet link"
            value={fallback}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
