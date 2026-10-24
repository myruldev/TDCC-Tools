import { saveConfig, validateApiKey, validateModel } from './config.mjs';

/**
 * Store a key supplied by the owner. TDCC's public docs do not document the
 * Gist's POST /api/keys provisioning endpoint, so this module never mints keys.
 */
export async function saveProjectApiKey({ apiKey, model, save = saveConfig } = {}) {
  const safeKey = validateApiKey(apiKey);
  const safeModel = validateModel(model);
  try {
    await save({ apiKey: safeKey, model: safeModel });
  } catch {
    throw new Error('Konfigurasi lokal gagal disimpan; key tidak ditampilkan. Periksa permission/path lalu jalankan setup kembali.');
  }
  return { model: safeModel };
}
