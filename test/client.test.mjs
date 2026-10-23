import test from 'node:test';
import assert from 'node:assert/strict';
import { sendMessage } from '../src/client.mjs';

test('sends one request to the published TDCC Anthropic-compatible base', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls += 1;
    assert.equal(new URL(url).origin, 'https://decentralizedcompute.company');
    assert.equal(new URL(url).pathname, '/api/anthropic/v1/messages');
    assert.equal(options.headers['x-api-key'], 'test-project-key');
    assert.equal(options.headers.authorization, undefined);
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'deepseek/model-from-owner');
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await sendMessage({ apiKey: 'test-project-key', model: 'deepseek/model-from-owner', messages: [{ role: 'user', content: 'hi' }], tools: [] });
  assert.equal(result.content[0].text, 'ok');
  assert.equal(calls, 1);
});

test('surfaces 429 without retrying or rotating keys', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { message: 'cohort quota reached' } }), { status: 429, headers: { 'retry-after': '45' } });
  };
  await assert.rejects(
    sendMessage({ apiKey: 'test-project-key', model: 'model', messages: [], tools: [] }),
    /HTTP 429.*Retry-After: 45.*Tidak ada rotasi key atau retry otomatis/,
  );
  assert.equal(calls, 1);
});
