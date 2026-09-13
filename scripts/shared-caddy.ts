import { readFileSync, writeFileSync } from 'node:fs';

export function sharedCaddyCandidate(original: string, fragment: string, candidate: string) {
  const directive = `import ${fragment}`;
  const matches = original.split('\n').filter((line) => line.trim() === directive);
  if (matches.length > 1)
    throw new Error('Duplicate Napplet Caddy imports; inspect configuration.');
  if (matches.length === 1)
    return original
      .split('\n')
      .map((line) => (line.trim() === directive ? `import ${candidate}` : line))
      .join('\n');
  return `${original}\n# Napplet managed site fragment\nimport ${candidate}\n`;
}
if (import.meta.main) {
  const [original, fragment, candidate, output] = process.argv.slice(2);
  if (![original, fragment, candidate, output].every((p) => /^\/[a-zA-Z0-9/._-]+$/.test(p)))
    throw new Error('Expected absolute configuration paths.');
  writeFileSync(output, sharedCaddyCandidate(readFileSync(original, 'utf8'), fragment, candidate), {
    mode: 0o644,
  });
}
