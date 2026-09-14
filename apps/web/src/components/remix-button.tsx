import { useEffect, useState } from 'react';
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
  const [copied, setCopied] = useState(''),
    [error, setError] = useState('');
  const [origin, setOrigin] = useState('https://napplet.soy');
  useEffect(() => setOrigin(location.origin), []);
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const source = quote(`${origin}/r/${revision}`);
  const commands = [
    {
      id: 'install',
      label: 'Install and remix',
      command: `curl -fsSL https://napplet.soy/install.sh | sh -s -- remix ${source} my-remix`,
    },
    {
      id: 'installed',
      label: 'Already have the CLI?',
      command: `napplet-space remix ${source} my-remix`,
    },
  ];
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
        {commands.map(({ id, label, command }) => (
          <div key={id}>
            <p className="muted">{label}</p>
            <div className="remix-command">
              <code>{command}</code>
              <Button
                variant="outline"
                size="icon"
                aria-label={`Copy ${id === 'install' ? 'install and remix' : 'remix'} command`}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(command);
                    setCopied(id);
                    setError('');
                  } catch {
                    setError('Select the command to copy it.');
                  }
                }}
              >
                {copied === id ? <Check size={16} /> : <Copy size={16} />}
              </Button>
            </div>
          </div>
        ))}
        <p className="muted">
          No Bun or Node installation needed. Run a command in your terminal, then open the new
          folder in your coding agent. Source and license files are preserved when the author
          provides an archive; otherwise the verified HTML is your starting point.
        </p>
        <a href="/cli">Install the CLI ↗</a>
        {error && <p role="status">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
