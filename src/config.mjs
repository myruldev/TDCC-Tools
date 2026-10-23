import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const DEFAULT_BASE_URL = 'https://decentralizedcompute.company/api/anthropic';
export const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash-free';
const MAX_KEY_LENGTH = 4096;
const MAX_MODEL_LENGTH = 200;

export function configDirectory() {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'tdcc-tools');
}

export function configPath() {
  return join(configDirectory(), 'config.json');
}

export function validateApiKey(value) {
  if (typeof value !== 'string') throw new Error('API key harus berupa teks.');
  const key = value.trim();
  if (!key || key.length > MAX_KEY_LENGTH || /[\u0000-\u0020\u007f]/.test(key)) {
    throw new Error('API key kosong, terlalu panjang, atau mengandung spasi/karakter kontrol.');
  }
  return key;
}

export function validateModel(value) {
  if (typeof value !== 'string') throw new Error('Model ID harus berupa teks.');
  const model = value.trim();
  if (!model || model.length > MAX_MODEL_LENGTH || /[\u0000-\u001f\u007f]/.test(model)) {
    throw new Error('Model ID kosong, terlalu panjang, atau mengandung karakter kontrol.');
  }
  return model;
}

async function ensureConfigDirectory() {
  const dir = configDirectory();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await chmod(dir, 0o700);
  return dir;
}

export async function loadConfig() {
  const file = configPath();
  let info;
  try {
    info = await lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('File konfigurasi bukan file biasa; periksa secara manual.');
  if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
    throw new Error(`Permission konfigurasi terlalu terbuka. Jalankan: chmod 600 "${file}"`);
  }
  const raw = await readFile(file, 'utf8');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('JSON konfigurasi rusak; jalankan setup kembali setelah menyimpan key lama.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Format konfigurasi tidak valid.');
  return {
    apiKey: validateApiKey(parsed.apiKey),
    model: validateModel(parsed.model),
  };
}

export async function saveConfig({ apiKey, model }) {
  const safeKey = validateApiKey(apiKey);
  const safeModel = validateModel(model);
  const dir = await ensureConfigDirectory();
  const file = configPath();
  try {
    const existing = await lstat(file);
    if (existing.isSymbolicLink() || !existing.isFile()) throw new Error('File konfigurasi yang ada bukan file biasa.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const temporary = join(dir, `.config.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify({ apiKey: safeKey, model: safeModel }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    if (process.platform !== 'win32') await chmod(temporary, 0o600);
    await rename(temporary, file);
    if (process.platform !== 'win32') await chmod(file, 0o600);
  } catch (error) {
    try { await unlink(temporary); } catch { /* temporary file may not exist */ }
    throw error;
  }
}

export async function removeConfig() {
  const file = configPath();
  try {
    const info = await lstat(file);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('File konfigurasi bukan file biasa; tidak dihapus.');
    await unlink(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
