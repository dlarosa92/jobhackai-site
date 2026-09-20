import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const handlerUrl = new URL('../../analytics-check.js', import.meta.url);
const source = readFileSync(handlerUrl, 'utf8').replace(/from '(\.[^']+)'/g, (_, path) => "from '" + new URL(path, handlerUrl).href + "'");
const { onRequest } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
for (const environment of [undefined, 'production', 'prod', 'development', 'dev', 'QA', 'unknown']) {
  test('diagnostic fails closed in ' + environment, () => {
    assert.equal(onRequest({ env: {ENVIRONMENT: environment}, request: new Request('https://qa.jobhackai.io/analytics-check') }).status, 404);
  });
}
test('a QA value copied onto a production or preview host remains blocked', () => {
  for (const host of ['app.jobhackai.io', 'jobhackai.io', 'preview.pages.dev']) {
    assert.equal(onRequest({env:{ENVIRONMENT:'qa'},request:new Request('https://' + host + '/analytics-check')}).status,404);
  }
});
test('QA diagnostic is uncached, not indexed, and uses the normal consent module', async () => {
  const response = onRequest({env:{ENVIRONMENT:'qa'},request:new Request('https://qa.jobhackai.io/analytics-check')});
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow');
  const html = await response.text();
  assert.match(html,/\/js\/cookie-consent\.js\?v=/);
  assert.match(html,/analytics_delivery_check/);
  assert.doesNotMatch(html,/document\.cookie|localStorage|sessionStorage|GA4_API_SECRET|OPENAI_API_KEY/);
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
});
