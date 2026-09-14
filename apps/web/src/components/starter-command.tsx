import { useEffect, useState } from 'react';
import { Check, Copy, Terminal } from 'lucide-react';
import { Button } from './ui/button';
import { createCommand } from '@/lib/creator-commands';

export function StarterCommand({ template }: { template?: string }) {
  const command = createCommand(template);
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
        <div>
          <Terminal size={14} aria-hidden="true" />
          <span>ONE COMMAND. YOUR NEXT IDEA.</span>
          <Button
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
        <code tabIndex={0}>{command}</code>
      </div>
      <span className="command-feedback" role="status">
        {feedback}
      </span>
    </div>
  );
}
