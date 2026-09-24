import { useEffect, useId, useRef, useState } from 'react';
import { Check, Copy, Expand, Share2 } from 'lucide-react';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

export function CardShare({ title, path }: { title: string; path: string }) {
  const label = useId();
  const fallbackInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState('');
  const [fallback, setFallback] = useState('');
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(''), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  useEffect(() => {
    if (fallback) fallbackInput.current?.select();
  }, [fallback]);
  const detailPath = path.replace(/\/play\/?$/, '').replace(/\/$/, '');
  async function copy(player: boolean) {
    const url = location.origin + detailPath + (player ? '/play' : '');
    setCopied('');
    setFallback('');
    try {
      await navigator.clipboard.writeText(url);
      setCopied(player ? 'Player link copied' : 'Detail link copied');
    } catch {
      setFallback(url);
    }
  }
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) {
          setFallback('');
          setCopied('');
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          data-tone="blue"
          data-effect="share"
          variant="ghost"
          size="sm"
          className="card-share"
          title="Share napplet"
          aria-label={`Share ${title}`}
        >
          <Share2 size={15} />
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-labelledby={label} className="w-80 max-w-[calc(100vw-24px)] p-3">
        <p id={label} className="px-2 pb-2 text-sm font-semibold truncate">
          Share {title}
        </p>
        {(
          [
            [false, 'Detail link', 'About, source and conversation', Copy],
            [true, 'Player link', 'Straight to the immersive player', Expand],
          ] as const
        ).map(([player, name, description, Icon]) => (
          <Button
            data-tone="blue"
            key={name}
            variant="ghost"
            className="h-auto w-full justify-start gap-3 px-2 py-3 text-left"
            onClick={() => void copy(player)}
            aria-label={`Copy ${name.toLowerCase()}`}
          >
            {copied.startsWith(name) ? <Check size={18} /> : <Icon size={18} />}
            <span className="min-w-0">
              <span className="block">{copied.startsWith(name) ? copied : name}</span>
              <span className="block text-xs font-normal text-muted-foreground">{description}</span>
            </span>
          </Button>
        ))}
        <span role="status" className="sr-only">
          {copied}
        </span>
        {fallback && (
          <label className="mt-2 block text-xs text-muted-foreground">
            Copy this link:
            <input
              ref={fallbackInput}
              className="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-2 text-sm text-foreground"
              aria-label="Share link"
              value={fallback}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
        )}
      </PopoverContent>
    </Popover>
  );
}
