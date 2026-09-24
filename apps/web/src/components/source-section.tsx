import { Proposals } from './proposals';
import type { SignedEvent } from '../../../../packages/protocol/src';
import { Link } from '@tanstack/react-router';
import { Code2, Terminal } from 'lucide-react';
import { Button } from './ui/button';
import { useEffect, useRef, useState } from 'react';
import { getReadme } from '@/lib/catalog.functions';

export function SourceSection({
  revision,
  manifest,
  hasArchive = true,
}: {
  revision: string;
  manifest?: SignedEvent;
  hasArchive?: boolean;
}) {
  const section = useRef<HTMLElement>(null);
  const [readme, setReadme] = useState<Awaited<ReturnType<typeof getReadme>>>(null);
  useEffect(() => {
    setReadme(null);
    if (!hasArchive || !section.current) return;
    let active = true;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        void getReadme({ data: revision })
          .then((value) => {
            if (active) setReadme(value);
          })
          .catch(() => {});
      },
      { rootMargin: '250px' },
    );
    observer.observe(section.current);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [revision, hasArchive]);
  return (
    <>
      <section ref={section} className="source-section" aria-label="Source">
        <div className="source-section-heading">
          <div>
            <span className="eyebrow">UNDER THE HOOD</span>
            <h2>Peek at the source.</h2>
            <p>
              Browse this release’s files, inspect its license, or find a starting point for your
              remix.
            </p>
          </div>
          <Button asChild variant="outline" data-tone="blue" data-effect="source">
            <Link to="/r/$snapshot/source" params={{ snapshot: revision }} preload={false}>
              <Code2 size={16} />
              Browse source
            </Link>
          </Button>
        </div>
        {readme && (
          <div className="readme-terminal">
            <div className="readme-terminal-heading">
              <span>
                <Terminal size={15} />
                {readme.path}
              </span>
              <Link
                to="/r/$snapshot/source"
                params={{ snapshot: revision }}
                search={{ view: 'project', file: readme.path }}
                preload={false}
              >
                Read full file ↗
              </Link>
            </div>
            <pre tabIndex={0} aria-label={`First ${readme.lines.length} lines of ${readme.path}`}>
              <code>
                {readme.lines.map((line, i) => (
                  <span className="readme-line" key={i}>
                    <span className="readme-line-number" aria-hidden>
                      {i + 1}
                    </span>
                    <span>{line || '\u00a0'}</span>
                  </span>
                ))}
              </code>
            </pre>
          </div>
        )}
      </section>
      {manifest && <Proposals manifest={manifest} />}
    </>
  );
}
