import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runTurn } from '../src/agent.mjs';
import { resolveWorkspaceRoot } from '../src/workspace.mjs';

test('performs an Anthropic-compatible read_file tool call and returns the result to the model', async t => {
  const originalFetch = globalThis.fetch;
  const parent = await mkdtemp(path.join(tmpdir(), 'tdcc-agent-test-'));
  const workspace = path.join(parent, 'workspace');
  await mkdir(workspace);
  await writeFile(path.join(workspace, 'note.txt'), 'private workspace fixture');
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await rm(parent, { recursive: true, force: true });
  });

  const requests = [];
  let turn = 0;
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    turn += 1;
    if (turn === 1) {
      return new Response(JSON.stringify({
        content: [{ type: 'tool_use', id: 'call-1', name: 'read_file', input: { path: 'note.txt' } }],
        stop_reason: 'tool_use',
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Sudah saya baca.' }], stop_reason: 'end_turn' }), { status: 200 });
  };

  const messages = [];
  const printed = [];
  const results = await runTurn({
    apiKey: 'test-project-key',
    model: 'deepseek/model',
    messages,
    prompt: 'Baca note.txt',
    root: await resolveWorkspaceRoot(workspace),
    confirm: async () => { throw new Error('read_file seharusnya tidak meminta persetujuan tulis/run'); },
    onText: text => printed.push(text),
  });

  assert.equal(results.stopReason, 'end_turn');
  assert.equal(turn, 2);
  assert.deepEqual(messages.map(message => message.role), ['user', 'assistant', 'user', 'assistant']);
  assert.match(messages[2].content[0].content, /private workspace fixture/);
  assert.equal(requests[1].messages[2].content[0].type, 'tool_result');
  assert.equal(printed[0], 'Sudah saya baca.');
});
