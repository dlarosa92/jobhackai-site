import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../pricing.js', import.meta.url), 'utf8');
const { onRequest } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('trailing-slash pricing redirects before resolving relative assets and keeps acquisition parameters', async () => {
  const response = await onRequest({
    request: new Request('https://qa.jobhackai.io/pricing/?canceled=1&utm_campaign=fixture'),
    next() { throw new Error('must redirect before fetching the HTML'); }
  });
  assert.equal(response.status, 308);
  const destination = response.headers.get('Location');
  assert.equal(destination, 'https://qa.jobhackai.io/pricing?canceled=1&utm_campaign=fixture');
  assert.equal(new URL('js/voice-cta.js', destination).pathname, '/js/voice-cta.js');
  assert.equal(new URL('voice-interview.html', destination).pathname, '/voice-interview.html');
});
test('canonical pricing serves the asset once without a redirect loop', async () => {
  let calls = 0;
  const response = await onRequest({
    request: new Request('https://qa.jobhackai.io/pricing?canceled=1'),
    async next(request) {
      calls++;
      assert.equal(request.url, 'https://qa.jobhackai.io/pricing.html?canceled=1');
      return new Response('<html>Pricing</html>');
    }
  });
  assert.equal(calls, 1);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'text/html; charset=utf-8');
});
