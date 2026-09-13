import { indexHealth } from '../packages/backend/src/indexed-catalog';

const health = indexHealth();
process.exit(
  health.enabled &&
    !health.stale &&
    !health.errors?.length &&
    health.release === (process.env.SPACE_RELEASE_ID ?? 'local')
    ? 0
    : 1,
);
