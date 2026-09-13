const path = require('node:path');
const release = process.env.SPACE_RELEASE_DIR || path.resolve(__dirname, '..');
module.exports = {
  apps: [
    {
      name: `${process.env.SPACE_SERVICE_PREFIX || 'napplet'}-blossom`,
      cwd: release,
      script: process.env.BUN_BIN || 'bun',
      args: [process.env.SPACE_BLOSSOM_BUNDLE || path.join(release, '.local/bin/blossom.js')],
      interpreter: 'none',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      exp_backoff_restart_delay: 1000,
      max_memory_restart: '512M',
      kill_timeout: 15000,
      time: true,
      env: {
        SPACE_MODERATION_FILE: process.env.SPACE_MODERATION_FILE || '',
        NODE_ENV: 'production',
        SPACE_BLOSSOM_PORT: process.env.SPACE_BLOSSOM_PORT || '19348',
        SPACE_BLOSSOM_ORIGIN: process.env.SPACE_BLOSSOM_ORIGIN,
        SPACE_BLOSSOM_LOCAL: process.env.SPACE_BLOSSOM_LOCAL || '0',
        SPACE_BLOSSOM_DATA:
          process.env.SPACE_BLOSSOM_DATA || path.join(release, '.local/services/blossom'),
        SPACE_BLOSSOM_INSTANCE: process.env.SPACE_BLOSSOM_INSTANCE || 'napplet',
      },
    },
  ],
};
