import { createRootRoute, HeadContent, Link, Outlet, Scripts } from '@tanstack/react-router';
import { NostrProvider } from '@/components/nostr-provider';
import { Shell } from '@/components/shell';
import styles from '@/styles.css?url';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'napplet.space — Small code. Big weird.' },
      {
        name: 'description',
        content:
          'A playground for tiny games, digital experiments, and wonderfully unnecessary things. Play, inspect, and remix.',
      },
      {
        httpEquiv: 'Content-Security-Policy',
        content: "frame-src 'self' blob:; object-src 'none'; base-uri 'self'",
      },
    ],
    links: [
      { rel: 'stylesheet', href: styles },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
  }),
  component: Root,
  notFoundComponent: () => (
    <div className="empty-page">
      <span className="eyebrow">404 / LOST IN SPACE</span>
      <h1>Nothing orbiting here.</h1>
      <p>This address hasn’t landed in our collection.</p>
      <Link to="/">Back to the playground →</Link>
    </div>
  ),
  errorComponent: ({ reset }) => (
    <div className="empty-page">
      <h1>A little turbulence.</h1>
      <p>We couldn’t load this page. Please try again.</p>
      <button onClick={reset}>Try again</button>
    </div>
  ),
});
function Root() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <NostrProvider>
          <Shell>
            <Outlet />
          </Shell>
        </NostrProvider>
        <Scripts />
      </body>
    </html>
  );
}
