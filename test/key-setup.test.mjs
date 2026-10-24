import test from 'node:test';
import assert from 'node:assert/strict';
import { createAndSaveProjectApiKey, createProjectApiKey, KEY_CREATE_ENDPOINT } from '../src/key-setup.mjs';

const MOCK_KEY = 'sk_tdcc_mock_key_for_tests';

function successResponse(key = MOCK_KEY) {
  return new Response(JSON.stringify({ key }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('requests one key from the Gist endpoint with only the name field', async () => {
  const calls = [];
  const key = await createProjectApiKey({
    name: 'agent-test-123',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return successResponse();
    },
  });

  assert.equal(key, MOCK_KEY);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, KEY_CREATE_ENDPOINT);
  assert.equal(calls[0].url, 'https://chat.decentralizedcompute.company/api/keys');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers['content-type'], 'application/json');
  assert.equal(calls[0].options.headers.authorization, undefined);
  assert.deepEqual(JSON.parse(calls[0].options.body), { name: 'agent-test-123' });
});

test('creates once and saves that same key with the selected model', async () => {
  let requests = 0;
  const saved = [];
  const result = await createAndSaveProjectApiKey({
    name: 'agent-single-key',
    model: 'deepseek/model-from-owner',
    fetchImpl: async () => { requests += 1; return successResponse(); },
    save: async config => { saved.push(config); },
  });

  assert.equal(requests, 1);
  assert.deepEqual(saved, [{ apiKey: MOCK_KEY, model: 'deepseek/model-from-owner' }]);
  assert.deepEqual(result, { name: 'agent-single-key', model: 'deepseek/model-from-owner' });
  assert.equal(Object.hasOwn(result, 'apiKey'), false);
});

test('stops on 429, reports Retry-After, and never requests a replacement key', async () => {
  let requests = 0;
  await assert.rejects(
    createProjectApiKey({
      name: 'agent-limit-test',
      fetchImpl: async () => {
        requests += 1;
        return new Response('{}', { status: 429, headers: { 'retry-after': '45' } });
      },
    }),
    /Batas\/kuota TDCC tercapai; Retry-After: 45.*Key pengganti tidak diminta dan tidak ada retry/,
  );
  assert.equal(requests, 1);
});

test('does not retry when the POST outcome is ambiguous', async () => {
  let requests = 0;
  await assert.rejects(
    createProjectApiKey({
      name: 'agent-network-test',
      fetchImpl: async () => { requests += 1; throw new TypeError('network unavailable'); },
    }),
    /Hasilnya mungkin tidak pasti; tidak ada retry/,
  );
  assert.equal(requests, 1);
});

test('does not reveal or retry when the success response lacks the expected key field', async () => {
  let requests = 0;
  await assert.rejects(
    createProjectApiKey({
      name: 'agent-response-test',
      fetchImpl: async () => {
        requests += 1;
        return new Response(JSON.stringify({ token: 'do-not-print-this-secret' }), { status: 200 });
      },
    }),
    error => {
      assert.match(error.message, /tidak berisi field key yang valid/);
      assert.doesNotMatch(error.message, /do-not-print-this-secret/);
      return true;
    },
  );
  assert.equal(requests, 1);
});

test('reports a created key that could not be saved without printing the key', async () => {
  let requests = 0;
  await assert.rejects(
    createAndSaveProjectApiKey({
      name: 'agent-save-failure',
      model: 'deepseek/model-from-owner',
      fetchImpl: async () => { requests += 1; return successResponse(); },
      save: async () => { throw new Error('disk unavailable'); },
    }),
    error => {
      assert.match(error.message, /konfigurasi lokal gagal disimpan/);
      assert.match(error.message, /Cabut key melalui console TDCC/);
      assert.doesNotMatch(error.message, new RegExp(MOCK_KEY));
      return true;
    },
  );
  assert.equal(requests, 1);
});
