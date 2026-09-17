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
        SPACE_CVM_DATA_PATH:
          process.env.SPACE_CVM_DATA_PATH || path.join(root, '.local/contextvm/boards.sqlite'),
        SPACE_CVM_MAX_PEERS: process.env.SPACE_CVM_MAX_PEERS || '8',
        SPACE_TURN_URLS: process.env.SPACE_TURN_URLS || '',
        SPACE_TURN_SECRET_PATH: process.env.SPACE_TURN_SECRET_PATH || '',
        SPACE_TURN_RELAY_ONLY: process.env.SPACE_TURN_RELAY_ONLY || '0',
        SPACE_CVM_RELAYS: process.env.SPACE_CVM_RELAYS || '',
        SPACE_CVM_PUBLIC_RELAYS:
          process.env.SPACE_CVM_PUBLIC_RELAYS || process.env.SPACE_CVM_RELAYS || '',
        SPACE_CVM_KEY_PATH:
          process.env.SPACE_CVM_KEY_PATH || path.join(root, '.local/contextvm/identity'),
        SPACE_CVM_ANNOUNCE: process.env.SPACE_CVM_ANNOUNCE || '0',
      },
    },
  ],
};
