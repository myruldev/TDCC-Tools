import test from 'node:test';
import assert from 'node:assert/strict';
import { saveProjectApiKey } from '../src/key-setup.mjs';

const MOCK_KEY = 'test-project-key-only';

test('stores only the owner-supplied key and selected model; never exposes it in the result', async () => {
  const saved = [];
  const result = await saveProjectApiKey({
    apiKey: MOCK_KEY,
    model: 'deepseek/deepseek-v4-flash-free',
    save: async config => { saved.push(config); },
  });

  assert.deepEqual(saved, [{ apiKey: MOCK_KEY, model: 'deepseek/deepseek-v4-flash-free' }]);
  assert.deepEqual(result, { model: 'deepseek/deepseek-v4-flash-free' });
  assert.equal(Object.hasOwn(result, 'apiKey'), false);
});

test('rejects invalid keys or model IDs before saving', async () => {
  let saves = 0;
  const save = async () => { saves += 1; };
  await assert.rejects(saveProjectApiKey({ apiKey: '', model: 'model', save }), /API key/);
  await assert.rejects(saveProjectApiKey({ apiKey: MOCK_KEY, model: '', save }), /Model ID/);
  assert.equal(saves, 0);
});

test('does not reveal a supplied key if local saving fails', async () => {
  await assert.rejects(
    saveProjectApiKey({ apiKey: MOCK_KEY, model: 'model', save: async () => { throw new Error(MOCK_KEY); } }),
    error => {
      assert.match(error.message, /Konfigurasi lokal gagal disimpan/);
      assert.doesNotMatch(error.message, new RegExp(MOCK_KEY));
      return true;
    },
  );
});
