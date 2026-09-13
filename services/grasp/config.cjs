const { resolve } = require('node:path');

// Shared by Bun's test/dev tooling and Node's PM2 configuration loader.
module.exports = function graspEnvironment(input) {
  const url = new URL(input.origin);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    (input.local
      ? url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)
      : url.protocol !== 'https:')
  )
    throw new Error('GRASP needs a root HTTPS origin, or literal HTTP loopback in local mode.');
  return {
    PATH: process.env.PATH || '/usr/bin:/bin',
    SPACE_GRASP_LOCAL_ONLY: input.local ? '1' : '0',
    NGIT_DOMAIN: url.host,
    NGIT_BASE_PATH: '/',
    NGIT_BIND_ADDRESS: input.bind || '127.0.0.1:19349',
    NGIT_GIT_DATA_PATH: resolve(input.directory, 'git'),
    NGIT_RELAY_DATA_PATH: resolve(input.directory, 'relay'),
    NGIT_DATABASE_BACKEND: 'lmdb',
    NGIT_RELAY_NAME: `Napplet Space Git (${input.instance})`,
    NGIT_RELAY_DESCRIPTION: 'Open source napplet repositories, authorized by signed Nostr state.',
    NGIT_USER_INDEX_RELAYS: '',
    NGIT_SYNC_PLUS_FALLBACK_RELAYS: '',
    NGIT_SYNC_PLUS_ENABLED: 'false',
    NGIT_SYNC_ALLOW_NON_GLOBAL_TARGETS: 'false',
    NGIT_LOG_LEVEL: 'info',
    NGIT_MAX_CONNECTIONS: '256',
    NGIT_RELAY_MAX_SUBSCRIPTIONS: '50',
    NGIT_RELAY_FILTER_LIMIT: '200',
    // Enforced by native Git receive-pack; Caddy also limits HTTP request bodies.
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'receive.maxInputSize',
    GIT_CONFIG_VALUE_0: String(50 * 1024 * 1024),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
  };
};
