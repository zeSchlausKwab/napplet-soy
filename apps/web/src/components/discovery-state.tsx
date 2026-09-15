import { Link, useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button } from './ui/button';
import { usePlayRoute } from '@/lib/use-play-route';

export function DiscoveryState({
  state = 'searching',
  message,
  poll = true,
}: {
  state?: string;
  message?: string;
  poll?: boolean;
}) {
  const router = useRouter();
  const play = usePlayRoute();
  useEffect(() => {
    if (poll) void router.invalidate();
  }, []);
  const [attempt, setAttempt] = useState(0);
  const pending = ['queued', 'searching'].includes(state) && attempt < 12;
  useEffect(() => {
    if (!pending || !poll) return;
    const timer = setTimeout(() => {
      setAttempt((a) => a + 1);
      void router.invalidate();
    }, 2000);
    return () => clearTimeout(timer);
  }, [pending, poll, attempt, router]);
  return (
    <section className="discovery-state" aria-live="polite">
      <span className="eyebrow">FROM THE RELAYS</span>
      <h1>
        {pending
          ? 'Finding your napplet…'
          : state === 'missing'
            ? 'Not found on the available relays.'
            : 'Still looking for this one.'}
      </h1>
      <p>
        {message ??
          (pending
            ? 'Looking up its signed release, checking the download and finding its preview.'
            : 'The relay or download may be temporarily unavailable. You can try this link again.')}
      </p>
      {pending ? (
        <LoaderCircle className="animate-spin" aria-label="Searching" />
      ) : (
        <Button
          variant="outline"
          onClick={() => {
            setAttempt(0);
            void router.invalidate();
          }}
        >
          Check again
        </Button>
      )}
      <p>
        <Link to={play.immersive ? play.detailPath : '/'}>
          {play.immersive ? 'Back to details →' : 'Back to the playground →'}
        </Link>
      </p>
    </section>
  );
}
