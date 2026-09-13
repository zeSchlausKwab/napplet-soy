import { createFileRoute, type SearchSchemaInput } from '@tanstack/react-router';
import { z } from 'zod';
import { Check, Copy, Terminal, WandSparkles, ArrowUpRight } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
export const Route = createFileRoute('/create')({
  validateSearch: (input: SearchSchemaInput & { template?: string }) =>
    z
      .object({
        template: z
          .enum([
            'soft-orbit',
            'tiny-tennis',
            'plasma-garden',
            'blob-friend',
            'very-important',
            'pixel-rain',
          ])
          .catch('soft-orbit'),
      })
      .parse(input),
  component: Create,
});
function Create() {
  const { template } = Route.useSearch();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const command = `bun run napplet new my-napplet --template ${template}`;
  return (
    <section className="create-page">
      <span className="eyebrow">FROM “WHAT IF” TO “LOOK AT THIS”</span>
      <h1>
        Make a little
        <br />
        something<span className="coral">.</span>
      </h1>
      <p className="create-intro">
        An idea is enough. Start with a working creation,
        <br />
        open your favorite coding agent, and follow your curiosity.
      </p>
      <div className="terminal-box">
        <div>
          <Terminal size={15} />
          <span>IN YOUR LOCAL NAPPLET-SPACE CHECKOUT</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Copy starter command"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(command);
                setCopied(true);
              } catch {
                setError('Select the command below and copy it manually.');
              }
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </Button>
        </div>
        <code>
          <span>$</span> {command}
        </code>
      </div>
      {error && <p role="status">{error}</p>}
      <p className="command-note">
        The public one-line installer is still being built. This command works from the platform
        repository today.
      </p>
      <div className="creation-steps">
        <article>
          <span>01</span>
          <h2>Start with a spark</h2>
          <p>
            Get a self-contained HTML project, a Git repository, and instructions for your coding
            agent.
          </p>
        </article>
        <article>
          <span>02</span>
          <h2>Make it your kind of weird</h2>
          <p>
            Run <code>bun run dev</code> in the new project. Edit the HTML with the AI tool you
            already use.
          </p>
        </article>
        <article>
          <span>03</span>
          <h2>Play it. Pass it around.</h2>
          <p>
            Preview in the same restricted sandbox, then use the platform CLI to publish your creation
            to Nostr and get a link to share.
          </p>
        </article>
      </div>
      <div className="creation-footnote">
        <WandSparkles size={22} />
        <p>
          No AI subscription bundled in. No giant framework required.
          <br />
          Your tools, your code, your little corner of the internet.
        </p>
        <a href="https://github.com/napplet" target="_blank" rel="noreferrer">
          Meet napplet <ArrowUpRight size={15} />
        </a>
      </div>
    </section>
  );
}
