const path = require('node:path');
const release = process.env.SPACE_RELEASE_DIR || path.resolve(__dirname, '..');
module.exports = {
  apps: [
    {
      name: `${process.env.SPACE_SERVICE_PREFIX || 'napplet'}-indexer`,
      cwd: release,
      script: process.env.BUN_BIN || 'bun',
      args: ['services/indexer/index.ts'],
      interpreter: 'none',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      exp_backoff_restart_delay: 1000,
      max_memory_restart: '768M',
      kill_timeout: 15000,
      time: true,
      env: {
        SPACE_MODERATION_FILE: process.env.SPACE_MODERATION_FILE || '',
        NODE_ENV: 'production',
        SPACE_RELEASE_ID: process.env.SPACE_RELEASE_ID || 'local',
        SPACE_INDEX_DIR: process.env.SPACE_INDEX_DIR,
        SPACE_INDEX_RELAYS: process.env.SPACE_INDEX_RELAYS,
        SPACE_INDEX_HINTS: process.env.SPACE_INDEX_HINTS || '',
        SPACE_INDEX_LOCAL_BLOSSOM: process.env.SPACE_INDEX_LOCAL_BLOSSOM || '',
      },
    },
  ],
};
