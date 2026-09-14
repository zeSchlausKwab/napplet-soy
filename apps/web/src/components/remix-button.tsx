import { useState } from 'react';
import { GitFork, Copy, Check } from 'lucide-react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';

export function RemixButton({ revision, title }: { revision: string; title: string }) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState('');
  const origin = typeof location === 'undefined' ? '' : location.origin;
  const command = `napplet-space remix ${origin}/r/${revision} my-remix`;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <GitFork size={16} /> Remix this
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Make {title} your own</DialogTitle>
          <DialogDescription>
            Start from this exact version. Your remix gets its own identity and keeps credit for the
            original.
          </DialogDescription>
        </DialogHeader>
        <div className="remix-command">
          <code>{command}</code>
          <Button
            variant="outline"
            size="icon"
            aria-label="Copy remix command"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(command);
                setCopied(true);
              } catch {
                setError('Select the command to copy it.');
              }
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </Button>
        </div>
        <p className="muted">
          Run this in your terminal, then open the new folder in your coding agent. Source and
          license files are preserved when the author provides an archive; otherwise the verified
          HTML is your starting point.
        </p>
        <a href="/cli">Install the CLI ↗</a>
        {error && <p role="status">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
