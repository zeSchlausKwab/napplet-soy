import { createFileRoute } from '@tanstack/react-router';

// The parent owns the loader, metadata and live iframe across presentation changes.
export const Route = createFileRoute('/n/$naddr/play')({ component: () => null });
