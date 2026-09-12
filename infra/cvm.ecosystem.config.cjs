const path = require('node:path');
const root = process.env.SPACE_RELEASE_DIR || path.resolve(__dirname, '..');
module.exports = {
  apps: [
    {
      name: process.env.SPACE_CVM_APP_NAME || 'napplet-cvm',
      cwd: root,
      script: process.env.BUN_BIN || 'bun',
      args: ['apps/cvm/src/index.ts'],
      interpreter: 'none',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      min_uptime: '10s',
      max_restarts: 10,
      exp_backoff_restart_delay: 1000,
      max_memory_restart: '256M',
      kill_timeout: 10000,
      env: {
        SPACE_CVM_RELAYS: process.env.SPACE_CVM_RELAYS || '',
        SPACE_CVM_KEY_PATH:
          process.env.SPACE_CVM_KEY_PATH || path.join(root, '.local/contextvm/identity'),
        SPACE_CVM_ANNOUNCE: process.env.SPACE_CVM_ANNOUNCE || '0',
      },
    },
  ],
};
