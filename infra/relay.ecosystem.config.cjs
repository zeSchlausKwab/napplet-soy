const path = require('node:path');
const release = process.env.SPACE_RELEASE_DIR || path.resolve(__dirname, '..');
module.exports = {
  apps: [
    {
      name: `${process.env.SPACE_SERVICE_PREFIX || 'napplet'}-relay`,
      cwd: release,
      script: process.env.SPACE_RELAY_BIN || path.join(release, '.local/bin/napplet-relay'),
      interpreter: 'none',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      exp_backoff_restart_delay: 1000,
      max_memory_restart: '1G',
      kill_timeout: 15000,
      time: true,
      env: {
        SPACE_MODERATION_FILE: process.env.SPACE_MODERATION_FILE || '',
        SPACE_SERVICE_BIND: process.env.SPACE_RELAY_BIND || '127.0.0.1:19347',
        SPACE_SERVICE_CVM_BIND: process.env.SPACE_RELAY_CVM_BIND || '',
        SPACE_SERVICE_URL: process.env.SPACE_RELAY_ORIGIN || 'http://localhost:8080/relay',
        SPACE_SERVICE_ALIASES: process.env.SPACE_RELAY_ALIASES || '',
        SPACE_SERVICE_DATA:
          process.env.SPACE_RELAY_DATA || path.join(release, '.local/services/relay'),
        SPACE_SERVICE_INSTANCE: process.env.SPACE_RELAY_INSTANCE || 'napplet',
      },
    },
  ],
};
