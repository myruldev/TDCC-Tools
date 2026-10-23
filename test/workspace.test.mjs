import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { executeTool, resolveWorkspaceRoot } from '../src/workspace.mjs';

async function fixture(t) {
  const parent = await mkdtemp(path.join(tmpdir(), 'tdcc-tools-test-'));
  const rootDir = path.join(parent, 'workspace');
  await mkdir(rootDir);
  t.after(async () => rm(parent, { recursive: true, force: true }));
  return { parent, rootDir, root: await resolveWorkspaceRoot(rootDir) };
}

test('read_file only accepts a path inside the workspace', async t => {
  const { rootDir, root } = await fixture(t);
  await writeFile(path.join(rootDir, 'hello.txt'), 'hello\nworld\n');
  const result = await executeTool('read_file', { path: 'hello.txt', start_line: 2 }, { root });
  assert.match(result, /world/);
  const escaped = await executeTool('read_file', { path: '../outside.txt' }, { root });
  assert.match(escaped, /^ERROR:/);
});

test('symlinks and common secret paths are refused', async t => {
  const { parent, rootDir, root } = await fixture(t);
  const outside = path.join(parent, 'outside.txt');
  await writeFile(outside, 'secret');
  await symlink(outside, path.join(rootDir, 'link.txt'));
  const linked = await executeTool('read_file', { path: 'link.txt' }, { root });
  assert.match(linked, /Symlink/);
  await writeFile(path.join(rootDir, '.env'), 'TOKEN=secret');
  const hidden = await executeTool('read_file', { path: '.env' }, { root });
  assert.match(hidden, /sensitif/);
});

test('write_file is denied unless the user explicitly approves', async t => {
  const { rootDir, root } = await fixture(t);
  const denied = await executeTool('write_file', { path: 'notes/new.txt', content: 'no' }, { root });
  assert.match(denied, /Dibatalkan pengguna/);
  await assert.rejects(readFile(path.join(rootDir, 'notes/new.txt')));

  const approved = await executeTool('write_file', { path: 'notes/new.txt', content: 'yes' }, { root, confirm: async () => true });
  assert.match(approved, /Tersimpan/);
  assert.equal(await readFile(path.join(rootDir, 'notes/new.txt'), 'utf8'), 'yes');
});

test('edit_file replaces exactly one match only after approval', async t => {
  const { rootDir, root } = await fixture(t);
  await writeFile(path.join(rootDir, 'a.txt'), 'one two');
  const denied = await executeTool('edit_file', { path: 'a.txt', old_string: 'two', new_string: 'three' }, { root });
  assert.match(denied, /Dibatalkan pengguna/);
  assert.equal(await readFile(path.join(rootDir, 'a.txt'), 'utf8'), 'one two');
  const approved = await executeTool('edit_file', { path: 'a.txt', old_string: 'two', new_string: 'three' }, { root, confirm: async () => true });
  assert.match(approved, /Diedit/);
  assert.equal(await readFile(path.join(rootDir, 'a.txt'), 'utf8'), 'one three');

  await writeFile(path.join(rootDir, 'duplicate.txt'), 'x x');
  const duplicate = await executeTool('edit_file', { path: 'duplicate.txt', old_string: 'x', new_string: 'y' }, { root, confirm: async () => true });
  assert.match(duplicate, /muncul 2 kali/);
});

test('run_node asks first and Node permission model confines filesystem access', async t => {
  const { parent, rootDir, root } = await fixture(t);
  const outside = path.join(parent, 'outside-created.txt');
  const script = `const fs = require('node:fs');\nfs.writeFileSync('inside-created.txt', 'ok');\ntry { fs.writeFileSync(${JSON.stringify(outside)}, 'bad'); console.log('OUTSIDE_WRITE_ALLOWED'); } catch (e) { console.log(e.code || e.name); }\n`;
  await writeFile(path.join(rootDir, 'probe.cjs'), script);
  const denied = await executeTool('run_node', { path: 'probe.cjs' }, { root });
  assert.match(denied, /tidak dijalankan/);
  const result = await executeTool('run_node', { path: 'probe.cjs' }, { root, confirm: async () => true });
  assert.match(result, /exit 0/);
  assert.match(result, /ERR_ACCESS_DENIED/);
  await assert.rejects(readFile(outside));
  assert.equal(await readFile(path.join(rootDir, 'inside-created.txt'), 'utf8'), 'ok');
});
