import { Link } from '@tanstack/react-router';
import { Code2 } from 'lucide-react';
import { Button } from './ui/button';

export function SourceSection({ revision }: { revision: string }) {
  return (
    <section className="source-section" aria-label="Source">
      <div>
        <span className="eyebrow">UNDER THE HOOD</span>
        <h2>Peek at the source.</h2>
        <p>
          Browse this release’s files, inspect its license, or find a starting point for your remix.
        </p>
      </div>
      <Button asChild variant="outline">
        <Link to="/r/$snapshot/source" params={{ snapshot: revision }} preload={false}>
          <Code2 size={16} />
          Browse source
        </Link>
      </Button>
    </section>
  );
}
