import { expect, test } from 'bun:test';
import { z } from 'zod';
import { diagnose, DiagnosticError, formatDiagnostic, redactDiagnostic, ToolOutput } from './index';

test('errors retain operation, system code, cause, tool status and actionable context', () => {
  const cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
  const error = new DiagnosticError('GIT_COMMAND', 'Git fetch failed.', {
    operation: 'fetch source commit',
    tool: 'git',
    exitCode: 128,
    target: 'https://name:password@git.example/repo?token=abc#private',
    cause,
    recovery: 'Check the source server and retry.',
  });
  const result = diagnose(error);
  expect(result.code).toBe('GIT_COMMAND');
  expect(result.operation).toBe('fetch source commit');
  expect(result.details).toContain('Exit status: 128');
  expect(formatDiagnostic(result)).toContain('ECONNREFUSED');
  expect(formatDiagnostic(result)).toContain('git.example/repo');
  for (const value of ['password', 'token=abc', '#private'])
    expect(JSON.stringify(result)).not.toContain(value);
});

test('normal, JSON and cause diagnostics redact keys, signer links, tokens and terminal controls', () => {
  const secret = 'a'.repeat(64);
  const message = `\x1b[31mFailure\x1b[0m\nkey ${secret}\nkey nsec1sensitive-secret\nnostrconnect://link?secret=123\nbunker://private\nAuthorization: Bearer hidden-value\npassword="do not reveal"\n-----BEGIN PRIVATE KEY-----\nkey-material\n-----END PRIVATE KEY-----`;
  const child = new Error(message);
  child.cause = child;
  const result = diagnose(
    new DiagnosticError('WRAPPED', 'Connection failed', {
      cause: new AggregateError([child, child], 'All attempts failed.'),
    }),
  );
  for (const output of [
    JSON.stringify(result),
    formatDiagnostic(result),
    redactDiagnostic(message),
  ]) {
    expect(output).toContain('Failure');
    for (const value of [
      secret,
      'nsec1sensitive',
      'nostrconnect:',
      'bunker:',
      'hidden-value',
      'do not reveal',
      'key-material',
      '\x1b',
    ])
      expect(output).not.toContain(value);
  }
  expect(result.details!.length).toBeLessThanOrEqual(8);
  expect(diagnose('a private thrown value').message).not.toContain('private thrown');
});

test('validation reports field paths without serializing rejected values or parser excerpts', () => {
  const parsed = z.object({ amount: z.number() }).safeParse({ amount: 'password-in-input' });
  if (parsed.success) throw new Error('Invalid test fixture');
  const result = diagnose(parsed.error);
  expect(result.code).toBe('INVALID_CONFIG');
  expect(result.message).toContain('amount');
  expect(result.message).not.toContain('password-in-input');
  expect(diagnose(new SyntaxError('Unexpected token at "private-input"')).message).not.toContain(
    'private-input',
  );
  const annotated = z
    .unknown()
    .superRefine((_, ctx) =>
      ctx.addIssue({
        code: 'custom',
        message: 'private-rejected-value',
        params: { diagnosticMessage: 'Expected bounded data; nsec1fixturesecret' },
      }),
    )
    .safeParse('private-rejected-value');
  if (annotated.success) throw new Error('Invalid test fixture');
  const safe = diagnose(annotated.error).message;
  expect(safe).toContain('Expected bounded data');
  expect(safe).not.toContain('private-rejected-value');
  expect(safe).not.toContain('nsec1fixturesecret');
});

test('streamed tool output redacts secrets spanning chunks and bounds oversized lines', () => {
  let visible = '';
  const output = new ToolOutput((text) => {
    visible += text;
  });
  const source =
    'starting\nsecret=nsec1splitacrosschunks\n-----BEGIN PRIVATE KEY-----\nbase64material\n-----END PRIVATE KEY-----\n' +
    'x'.repeat(9000) +
    '\nerror TS123: missing module\n';
  for (const byte of new TextEncoder().encode(source)) output.push(new Uint8Array([byte]));
  output.finish();
  expect(output.text).toContain('error TS123: missing module');
  expect(visible).not.toContain('nsec1');
  expect(visible).not.toContain('base64material');
  expect(visible).toContain('omitted');
  expect(output.text.length).toBeLessThanOrEqual(8192);
});
