import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

/** Topic links are siblings of the play link, so browsing never accidentally starts a napplet. */
export function TopicTags({
  topics,
  children,
}: {
  topics: readonly string[];
  children?: ReactNode;
}) {
  if (!topics.length) return null;
  return (
    <nav className="topic-tags" aria-label="Napplet tags">
      {topics.map((topic) => (
        <Link key={topic} to="/" search={{ tag: topic, q: '', sort: 'curated' }} hash="explore">
          #{topic}
        </Link>
      ))}
      {children}
    </nav>
  );
}
