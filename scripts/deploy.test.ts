import { expect, test } from 'bun:test';
import { validateBlossomDomain, validateGitDomain, validateTarget } from './deploy';
test('deployment accepts explicit SSH targets and DNS domains', () => {
  expect(validateTarget('root@203.0.113.10', 'napplet.example')).toEqual({
    host: 'root@203.0.113.10',
    domain: 'napplet.example',
  });
  expect(validateTarget('my-vps', 'demo.napplet.example').host).toBe('my-vps');
});
test('deployment rejects shell injection, missing targets, and URL-shaped domains', () => {
  for (const host of [
    undefined,
    '-oProxyCommand=bad',
    'host;whoami',
    'user@host$(id)',
    'user@host bad',
  ])
    expect(() => validateTarget(host, 'napplet.example')).toThrow();
  for (const domain of [
    undefined,
    'https://napplet.example',
    'napplet.example/path',
    'x.example\nreverse_proxy evil',
    '*.example',
  ])
    expect(() => validateTarget('my-vps', domain)).toThrow();
});
test('Blossom deploys on a separate validated hostname', () => {
  expect(validateBlossomDomain('napplet.example')).toBe('blossom.napplet.example');
  expect(validateBlossomDomain('napplet.example', 'files.example')).toBe('files.example');
  for (const value of [
    'napplet.example',
    'x.example;whoami',
    'https://files.example',
    'x.example\nreverse_proxy evil',
    '*.example',
  ])
    expect(() => validateBlossomDomain('napplet.example', value)).toThrow();
});
test('GRASP requires a third validated root hostname', () => {
  expect(validateGitDomain('napplet.example', 'blossom.napplet.example')).toBe(
    'git.napplet.example',
  );
  expect(validateGitDomain('napplet.example', 'files.example', 'source.example')).toBe(
    'source.example',
  );
  for (const value of [
    'napplet.example',
    'files.example',
    'https://source.example',
    'x.example;id',
    '*.example',
  ])
    expect(() => validateGitDomain('napplet.example', 'files.example', value)).toThrow();
});
