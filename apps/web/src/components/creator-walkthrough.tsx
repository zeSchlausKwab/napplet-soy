import { useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { walkthrough } from '@/lib/creator-walkthrough';

export function WalkthroughVideo() {
  return (
    <div className="creator-walkthrough">
      <video
        controls
        playsInline
        preload="none"
        width={1280}
        height={800}
        poster={walkthrough.poster}
        aria-label="From idea to remix: a 30-second creator walkthrough"
      >
        <source src={walkthrough.video} type="video/mp4" />
        <track kind="captions" src={walkthrough.captions} srcLang="en" label="English" default />
        <a href={walkthrough.video}>Download the walkthrough</a>
      </video>
      <p className="walkthrough-note">
        A silent, illustrated tour · Your actual setup and creation time will vary.
      </p>
      <details className="walkthrough-transcript">
        <summary>Read the walkthrough</summary>
        <ol>
          {walkthrough.scenes.map(({ title, detail }) => (
            <li key={title}>
              <strong>{title}.</strong> {detail}
            </li>
          ))}
        </ol>
        <a href={walkthrough.video} download>
          Download the video ↗
        </a>
      </details>
    </div>
  );
}

export function WalkthroughDialog() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLAnchorElement>(null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <a
        ref={trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="walkthrough-link"
        href="/create#walkthrough"
        onClick={(event) => {
          // Preserve the ordinary route for no-JS browsing and new-tab gestures.
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        <Play size={14} fill="currentColor" aria-hidden="true" />
        Watch the flow <span>30 sec</span>
      </a>
      <DialogContent
        className="walkthrough-dialog"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          trigger.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>From “what if” to “your turn.”</DialogTitle>
          <DialogDescription>
            Create, remix and publish. No website account needed.
          </DialogDescription>
        </DialogHeader>
        {open && <WalkthroughVideo />}
      </DialogContent>
    </Dialog>
  );
}
