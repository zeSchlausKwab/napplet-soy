import { createFileRoute, type SearchSchemaInput } from '@tanstack/react-router';
import { z } from 'zod';
import { WandSparkles, ArrowUpRight } from 'lucide-react';
import { StarterCommand } from '@/components/starter-command';
export const Route = createFileRoute('/create')({
  validateSearch: (input: SearchSchemaInput & { template?: string }) =>
    z
      .object({
        template: z
          .enum([
            'boilerplate',
            'soft-orbit',
            'tiny-tennis',
            'plasma-garden',
            'blob-friend',
            'very-important',
            'pixel-rain',
          ])
          .catch('boilerplate'),
      })
      .parse(input),
  component: Create,
});
function Create() {
  const { template } = Route.useSearch();
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
      <p className="account-free-note">Create, remix and publish. No website account needed.</p>
      <StarterCommand template={template} />
      <p className="command-note">
        macOS and Linux. No Bun or Node installation needed. Git is required.
        <a href="/cli"> Installation help and downloads ↗</a>
      </p>
      <p className="command-note">
        Publishing uses a Nostr identity. The CLI can create one or connect yours; you don’t need to
        sign in here.
      </p>
      <div className="creation-steps">
        <article>
          <span>01</span>
          <h2>Start with a spark</h2>
          <p>
            Get a working project, a Git repository, and Napplet skills for your coding agent. New
            creations start from the creator-maintained Napplet boilerplate.
          </p>
        </article>
        <article>
          <span>02</span>
          <h2>Make it your kind of weird</h2>
          <p>
            Run <code>soyli dev</code> in the new project. Make changes with the AI tool you
            already use and see them in the sandbox preview.
          </p>
        </article>
        <article>
          <span>03</span>
          <h2>Play it. Pass it around.</h2>
          <p>
            Build your latest changes, then run <code>soyli publish</code> to check your
            creation, publish to Nostr, and get a link to share.
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
