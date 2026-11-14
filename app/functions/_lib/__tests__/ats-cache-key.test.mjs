// Run: node --test app/functions/_lib/__tests__/ats-cache-key.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { atsCacheKey } from '../ats-cache-key.js';

const head = 'Jane Doe\nSoftware Engineer\n' + 'Experience line. '.repeat(150); // well past 2000 characters
assert.ok(head.length > 2000);

test('an edit anywhere in the resume produces a different cache key', async () => {
  const original = head + '\nSkills: Java, SQL';
  const editedLate = head + '\nSkills: Java, SQL, Kubernetes';
  // The two versions share their first 2000 characters, the case the old key could not tell apart.
  assert.equal(original.slice(0, 2000), editedLate.slice(0, 2000));
  assert.notEqual(await atsCacheKey(original, 'software engineer'), await atsCacheKey(editedLate, 'software engineer'));
  assert.notEqual(await atsCacheKey(original, 'software engineer'), await atsCacheKey(original + ' ', 'software engineer'));
});

test('the same resume and role always produce the same key, and the role matters', async () => {
  const text = head + '\nSkills: Java, SQL';
  const key = await atsCacheKey(text, 'software engineer');
  assert.equal(key, await atsCacheKey(text, 'software engineer'));
  assert.match(key, /^atsCache:[0-9a-f]{64}$/);
  assert.notEqual(key, await atsCacheKey(text, 'product manager'));
  assert.notEqual(await atsCacheKey('', 'software engineer'), await atsCacheKey(text, 'software engineer'));
});

test('the scoring endpoint uses the shared key for both the cache read and the cache write', () => {
  const source = readFileSync(new URL('../../api/ats-score.js', import.meta.url), 'utf8');
  assert.equal(source.match(/await atsCacheKey\(text, normalizedJobTitle\)/g)?.length, 2);
  assert.ok(!/substring\(0,\s*2000\)/.test(source), 'the cache must not be keyed on a prefix of the resume');
  assert.ok(!source.includes('`atsCache:'), 'no second, hand built cache key');
});
