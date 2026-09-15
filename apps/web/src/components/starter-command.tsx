import { useEffect, useState } from 'react';
import { Check, ChevronDown, Copy, Terminal } from 'lucide-react';
import { WalkthroughVideo } from './creator-walkthrough';
import { Button } from './ui/button';
import { createCommand } from '@/lib/creator-commands';

export function StarterCommand({ template }: { template?: string }) {
  const command = createCommand(template);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState('');
  useEffect(() => {
    setFeedback('');
  }, [command]);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(''), 5000);
    return () => clearTimeout(timer);
  }, [feedback]);
  return (
    <div className="starter-command">
      <div className="terminal-box">
        <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
          <summary aria-label="How to create a napplet">
            <div className="terminal-heading">
              <Terminal size={14} aria-hidden="true" />
              <span>napplet soyLI</span>
              <ChevronDown className="terminal-chevron" size={15} aria-hidden="true" />
            </div>
            <code
              tabIndex={0}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              {command}
            </code>
            <span className="terminal-hint">
              How it works <span>30 sec</span>
            </span>
          </summary>
          {expanded && <WalkthroughVideo autoPlay />}
          {!hydrated && (
            <noscript>
              <WalkthroughVideo />
            </noscript>
          )}
        </details>
        <Button
          className="terminal-copy"
          variant="ghost"
          size="icon"
          aria-label="Copy starter command"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(command);
              setFeedback('Copied. Paste it into your terminal.');
            } catch {
              setFeedback('Select the command and copy it manually.');
            }
          }}
        >
          {feedback.startsWith('Copied') ? <Check size={16} /> : <Copy size={16} />}
        </Button>
      </div>
      <span className="command-feedback" role="status">
        {feedback}
      </span>
    </div>
  );
}
