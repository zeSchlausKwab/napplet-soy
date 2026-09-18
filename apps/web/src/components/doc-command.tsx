import { useEffect, useState } from 'react';
import { Check, Copy, Terminal } from 'lucide-react';
import { Button } from './ui/button';

export function DocCommand({ label, children }: { label: string; children: string }) {
  const [feedback, setFeedback] = useState<'copied' | 'error' | null>(null);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 5000);
    return () => clearTimeout(timer);
  }, [feedback]);
  return (
    <div className="doc-command">
      <div className="doc-command-heading">
        <span>
          <Terminal size={14} aria-hidden="true" /> {label}
        </span>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(children);
              setFeedback('copied');
            } catch {
              setFeedback('error');
            }
          }}
        >
          {feedback === 'copied' ? <Check size={14} /> : <Copy size={14} />}
          <span role="status">
            {feedback === 'copied' ? 'Copied' : feedback === 'error' ? 'Select & copy' : 'Copy'}
          </span>
        </Button>
      </div>
      <pre tabIndex={0} aria-label={label}>
        <code>{children}</code>
      </pre>
    </div>
  );
}
