import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { configPath, loadConfig, removeConfig, saveConfig } from '../src/config.mjs';

test('saves one key outside the repository with private permissions', async t => {
  const temp = await mkdtemp(path.join(tmpdir(), 'tdcc-config-test-'));
  const prior = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = temp;
  t.after(async () => {
    if (prior === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prior;
    await rm(temp, { recursive: true, force: true });
  });

  await saveConfig({ apiKey: 'test-project-key', model: 'deepseek/model' });
  assert.match(configPath(), new RegExp(`${path.sep}tdcc-tools${path.sep}config\\.json$`));
  const info = await stat(configPath());
  if (process.platform !== 'win32') assert.equal(info.mode & 0o077, 0);
  assert.deepEqual(await loadConfig(), { apiKey: 'test-project-key', model: 'deepseek/model' });
  assert.equal(await removeConfig(), true);
  assert.equal(await loadConfig(), null);
});

test('rejects empty and whitespace-containing API keys', async () => {
  const { validateApiKey } = await import('../src/config.mjs');
  assert.throws(() => validateApiKey(''), /kosong/);
  assert.throws(() => validateApiKey('bad key'), /spasi/);
});
