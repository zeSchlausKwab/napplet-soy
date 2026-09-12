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
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: process.env.PORT || '3000',
        SPACE_RELEASE_ID: process.env.SPACE_RELEASE_ID || 'local',
        SPACE_ARTIFACT_DIR: path.join(release, 'packages/backend/data/artifacts'),
        SPACE_SITE_ORIGIN: process.env.SPACE_SITE_ORIGIN || '',
        SPACE_PUBLICDEV: process.env.SPACE_PUBLICDEV || '0',
        SPACE_PUBLICDEV_DIR: process.env.SPACE_PUBLICDEV_DIR || '',
      },
    },
  ],
};
