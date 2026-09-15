const path = require('node:path');
const release = process.env.SPACE_RELEASE_DIR || path.resolve(__dirname, '..');
module.exports = {
  apps: [
    {
      name: process.env.SPACE_APP_NAME || 'napplet-web',
      cwd: path.join(release, 'apps/web'),
      // Run Bun directly: PM2's Bun wrapper uses require(), which rejects top-level await.
      script: process.env.BUN_BIN || 'bun',
      args: ['server.ts'],
      interpreter: 'none',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      exp_backoff_restart_delay: 1000,
      max_memory_restart: '768M',
      kill_timeout: 10000,
      time: true,
      env: {
        SPACE_MODERATION_FILE: process.env.SPACE_MODERATION_FILE || '',
        SPACE_ADMIN_PUBKEYS: process.env.SPACE_ADMIN_PUBKEYS || '',
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: process.env.PORT || '3000',
        SPACE_RELEASE_ID: process.env.SPACE_RELEASE_ID || 'local',
        SPACE_CLI_DOWNLOAD_DIR:
          process.env.SPACE_CLI_DOWNLOAD_DIR || path.join(release, '../../downloads/cli'),
        SPACE_ARTIFACT_DIR: path.join(release, 'packages/backend/data/artifacts'),
        SPACE_SITE_ORIGIN: process.env.SPACE_SITE_ORIGIN || '',
        SPACE_PUBLICDEV: process.env.SPACE_PUBLICDEV || '0',
        SPACE_PUBLICDEV_DIR: process.env.SPACE_PUBLICDEV_DIR || '',
        SPACE_INDEX_DIR: process.env.SPACE_INDEX_DIR || '',
        SPACE_COMMUNITY_DIR: process.env.SPACE_COMMUNITY_DIR || '',
        SPACE_INDEX_RELAYS: process.env.SPACE_INDEX_RELAYS || '',
        SPACE_INDEX_HINTS: process.env.SPACE_INDEX_HINTS || '',
        SPACE_BLOSSOM_ORIGIN: process.env.SPACE_BLOSSOM_ORIGIN || '',
        SPACE_RUNTIME_LOCAL_RELAYS: process.env.SPACE_RUNTIME_LOCAL_RELAYS || '',
      },
    },
  ],
};
