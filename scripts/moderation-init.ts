import { resolve } from 'node:path';
import { initializePolicy } from '../packages/moderation/src/policy';
if (!process.argv[2])
  throw new Error('Usage: bun scripts/moderation-init.ts /absolute/path/policy.json');
initializePolicy(resolve(process.argv[2]));
console.log('Moderation policy initialized.');
