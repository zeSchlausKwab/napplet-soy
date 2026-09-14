import { indexHealth } from '../packages/backend/src/indexed-catalog';

// Relay failures remain visible in health, but external discovery is best-effort.
// Readiness requires a live worker for this release, not every remote relay online.
const health = indexHealth();
process.exit(
  health.enabled && !health.stale && health.release === (process.env.SPACE_RELEASE_ID ?? 'local')
    ? 0
    : 1,
);
