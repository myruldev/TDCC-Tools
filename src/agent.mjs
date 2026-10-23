import { sendMessage } from './client.mjs';
import { TOOL_DEFINITIONS, executeTool } from './workspace.mjs';

const MAX_TOOL_ROUNDS = 6;

export async function runTurn({ apiKey, model, messages, prompt, root, confirm, onText = () => {} }) {
  messages.push({ role: 'user', content: prompt });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await sendMessage({ apiKey, model, messages, tools: TOOL_DEFINITIONS });
    const content = response.content;
    const textBlocks = content.filter(block => block?.type === 'text' && typeof block.text === 'string');
    for (const block of textBlocks) onText(block.text);
    messages.push({ role: 'assistant', content });

    const calls = content.filter(block => block?.type === 'tool_use');
    if (calls.length === 0) return { stopReason: response.stop_reason || 'end_turn' };

    const results = [];
    for (const call of calls) {
      if (typeof call.id !== 'string' || !call.id) {
        results.push({ type: 'tool_result', tool_use_id: `invalid-${round}`, is_error: true, content: 'ERROR: ID tool call tidak valid.' });
        continue;
      }
      const result = await executeTool(call.name, call.input, { root, confirm });
      results.push({
        type: 'tool_result',
        tool_use_id: call.id,
        is_error: result.startsWith('ERROR:'),
        content: result,
      });
    }
    messages.push({ role: 'user', content: results });
  }

  throw new Error(`Mencapai batas ${MAX_TOOL_ROUNDS} putaran tool; buat permintaan lanjutan bila perlu.`);
}
