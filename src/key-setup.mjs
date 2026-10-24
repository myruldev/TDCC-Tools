import { saveConfig, validateApiKey, validateModel } from './config.mjs';

export const KEY_CREATE_ENDPOINT = 'https://chat.decentralizedcompute.company/api/keys';
const KEY_CREATE_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

async function readResponseText(response) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error('Respons pembuatan key terlalu besar.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function createProjectApiKey({ fetchImpl = globalThis.fetch, name = `agent-${Date.now().toString(36)}` } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Fetch API tidak tersedia; key tidak dibuat.');
  if (typeof name !== 'string' || !name.trim() || name.length > 200 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error('Nama key tidak valid; key tidak dibuat.');
  }

  let response;
  try {
    response = await fetchImpl(KEY_CREATE_ENDPOINT, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(KEY_CREATE_TIMEOUT_MS),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  } catch (error) {
    const reason = error?.name === 'TimeoutError' || error?.name === 'AbortError'
      ? 'Permintaan pembuatan key melewati batas waktu.'
      : 'Koneksi gagal saat meminta pembuatan key.';
    throw new Error(`${reason} Hasilnya mungkin tidak pasti; tidak ada retry. Periksa console TDCC sebelum mencoba setup lagi.`);
  }

  if (!response.ok) {
    const retryAfter = response.status === 429 ? response.headers.get('retry-after') : null;
    const limitNote = response.status === 429
      ? `Batas/kuota TDCC tercapai${retryAfter ? `; Retry-After: ${retryAfter}` : ''}.`
      : `TDCC HTTP ${response.status}.`;
    throw new Error(`${limitNote} Key pengganti tidak diminta dan tidak ada retry.`);
  }

  let raw;
  try {
    raw = await readResponseText(response);
  } catch {
    throw new Error('TDCC merespons sukses tetapi body respons tidak dapat dibaca. Key mungkin sudah dibuat; tidak ada retry. Periksa console TDCC sebelum mencoba setup lagi.');
  }

  let payload;
  try { payload = JSON.parse(raw); }
  catch {
    throw new Error('TDCC merespons sukses dengan JSON yang tidak valid. Key mungkin sudah dibuat; tidak ada retry. Periksa console TDCC sebelum mencoba setup lagi.');
  }

  try { return validateApiKey(payload?.key); }
  catch {
    throw new Error('Respons sukses TDCC tidak berisi field key yang valid seperti format pada Gist. Key mungkin sudah dibuat; tidak ada retry. Periksa console TDCC sebelum mencoba setup lagi.');
  }
}

export async function createAndSaveProjectApiKey({ model, fetchImpl = globalThis.fetch, save = saveConfig, name } = {}) {
  const safeModel = validateModel(model);
  const keyName = name ?? `agent-${Date.now().toString(36)}`;
  const apiKey = await createProjectApiKey({ fetchImpl, name: keyName });

  try {
    await save({ apiKey, model: safeModel });
  } catch {
    throw new Error('TDCC mengembalikan key, tetapi konfigurasi lokal gagal disimpan. Key tidak ditampilkan. Cabut key melalui console TDCC sebelum mencoba setup lagi.');
  }

  return { name: keyName, model: safeModel };
}
