import { useEffect, useRef, useState } from 'react';
import { useRouter } from '@tanstack/react-router';

/** Keep the SSR page useful while the browser independently refreshes its protocol data. */
export function useProtocolRefresh(key: string, read: () => Promise<unknown>) {
  const router = useRouter(),
    reader = useRef(read);
  reader.current = read;
  const [error, setError] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    reader
      .current()
      .then(() => {
        if (active) return router.invalidate();
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [key, attempt, router]);
  return error ? (
    <p role="status" className="muted">
      Couldn’t refresh from your relays. Showing cached data.{' '}
      <button className="text-link" onClick={() => setAttempt((n) => n + 1)}>
        Retry
      </button>
    </p>
  ) : null;
}
