const path = require('node:path');
const environment = require('../services/grasp/config.cjs');
const release = process.env.SPACE_RELEASE_DIR || path.resolve(__dirname, '..');
const directory = process.env.SPACE_GRASP_DATA || path.join(release, '.local/services/grasp');
module.exports = {
  apps: [
    {
      name: `${process.env.SPACE_SERVICE_PREFIX || 'napplet'}-grasp`,
      cwd: directory,
      script: process.env.SPACE_GRASP_BIN || path.join(release, '.local/bin/ngit-grasp'),
      interpreter: 'none',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      exp_backoff_restart_delay: 1000,
      max_memory_restart: '1G',
      kill_timeout: 30000,
      time: true,
      env: environment({
        directory,
        origin: process.env.SPACE_GRASP_ORIGIN,
        local: process.env.SPACE_GRASP_LOCAL === '1',
        instance: process.env.SPACE_GRASP_INSTANCE || 'napplet',
        bind: process.env.SPACE_GRASP_BIND,
      }),
    },
  ],
};
