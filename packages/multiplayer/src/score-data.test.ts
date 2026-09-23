import { test, expect } from 'bun:test';
import { encodeScoreData, validateScoreDataSchema, SCORE_DATA_BYTES } from './score-data';

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['car', 'version'],
  properties: {
    version: { type: 'integer', enum: [1] },
    car: {
      type: 'object',
      additionalProperties: false,
      required: ['limbs'],
      properties: {
        color: { type: 'string', minLength: 1, maxLength: 20 },
        limbs: {
          type: 'array',
          minItems: 1,
          maxItems: 64,
          items: {
            type: 'array',
            minItems: 2,
            maxItems: 2,
            items: { type: 'number', minimum: -100, maximum: 100 },
          },
        },
      },
    },
    boosted: { type: 'boolean' },
    nothing: { type: 'null' },
  },
};

test('score data validates nested drawing geometry without coercion or payloads in errors', () => {
  const registered = validateScoreDataSchema(schema);
  const data = {
    version: 1,
    car: {
      color: 'coral',
      limbs: [
        [0, 0],
        [12, 8],
      ],
    },
    boosted: false,
    nothing: null,
  };
  expect(JSON.parse(encodeScoreData(registered, data)!)).toEqual(data);
  for (const invalid of [
    { ...data, version: 2 },
    { ...data, version: '1' },
    { ...data, car: {} },
    { ...data, car: { limbs: [[0, 999]] } },
    { ...data, car: { limbs: [[0]] } },
    { ...data, car: { limbs: [] } },
    { ...data, extra: true },
    { ...data, boosted: 0 },
    { ...data, nothing: false },
  ])
    expect(() => encodeScoreData(registered, invalid)).toThrow();
  expect(() => encodeScoreData(registered, { ...data, version: 'private-token-fixture' })).toThrow(
    'data.version',
  );
  try {
    encodeScoreData(registered, { ...data, version: 'private-token-fixture' });
  } catch (error) {
    expect(String(error)).not.toContain('private-token-fixture');
  }
  expect(() => encodeScoreData(registered, undefined)).toThrow('requires data');
  expect(() => encodeScoreData(undefined, data)).toThrow('no dataSchema');
  expect(encodeScoreData(undefined, undefined)).toBeNull();
});

test('attachments enforce UTF-8 bytes, safe JSON, depth, array and node budgets', () => {
  const open = validateScoreDataSchema({ type: 'object' });
  const boundary = { text: 'x'.repeat(SCORE_DATA_BYTES - 11) };
  expect(encodeScoreData(open, boundary)!.length).toBe(SCORE_DATA_BYTES);
  for (const invalid of [
    { text: boundary.text + 'x' },
    { text: '🎮'.repeat(2200) },
    { x: NaN },
    { x: Infinity },
    { x: undefined },
    { x: BigInt(1) },
    { x: new Date() },
    { x: () => {} },
    { x: Array(257).fill(0) },
    JSON.parse('{"__proto__":{"polluted":true}}'),
    { x: { constructor: 'bad' } },
    { x: Array.from({ length: 32 }, () => Array(64).fill(0)) },
  ])
    expect(() => encodeScoreData(open, invalid)).toThrow();
  let nested: unknown = 0;
  for (let i = 0; i < 9; i++) nested = [nested];
  expect(() => encodeScoreData(open, { nested })).toThrow('nesting');
  const cycle: Record<string, unknown> = {};
  cycle.cycle = cycle;
  expect(() => encodeScoreData(open, cycle)).toThrow('cycles');
});

test('schema registration refuses unsupported or contradictory validation rules', () => {
  for (const invalid of [
    { type: 'array', items: { type: 'number' } },
    { type: 'object', $ref: 'https://example.com/schema' },
    { type: 'object', properties: { x: { type: 'string', pattern: '.*' } } },
    { type: 'object', properties: { x: { type: 'string', minimum: 1 } } },
    { type: 'object', properties: { x: { type: 'array' } } },
    { type: 'object', properties: { x: { type: 'integer', enum: [1.2] } } },
    { type: 'object', properties: { x: { type: 'string', enum: ['a', 'a'] } } },
    { type: 'object', properties: { x: { type: 'number', minimum: 10, maximum: 0 } } },
    { type: 'object', required: ['missing'] },
    { type: 'object', additionalProperties: { type: 'string' } },
    {
      type: 'object',
      properties: { x: { type: 'array', maxItems: 257, items: { type: 'null' } } },
    },
  ])
    expect(() => validateScoreDataSchema(invalid)).toThrow();
});
