import { spawn } from 'node:child_process';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const MAX_TOOL_OUTPUT = 12_000;
const MAX_FILE_BYTES = 512_000;
const MAX_WRITE_BYTES = 64_000;
const MAX_RUN_MS = 20_000;
const MAX_RUN_OUTPUT = 8_000;

export const TOOL_DEFINITIONS = [
  {
    name: 'list_dir',
    description: 'List entries in a directory relative to the approved workspace. Does not follow symlinks.',
    input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Relative directory path; use . for the workspace root.' } }, required: ['path'], additionalProperties: false },
  },
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file relative to the approved workspace. Use start_line (1-based) and limit to read a section.',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, start_line: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 400 } }, required: ['path'], additionalProperties: false },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a UTF-8 text file in the approved workspace. The user must approve every write.',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false },
  },
  {
    name: 'edit_file',
    description: 'Replace exactly one occurrence of old_string in a UTF-8 file in the approved workspace. The user must approve every edit.',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['path', 'old_string', 'new_string'], additionalProperties: false },
  },
  {
    name: 'run_node',
    description: 'Run one JavaScript file inside the approved workspace using Node.js Permission Model. No shell or child-process permission is granted. The user must approve every run.',
    input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Relative .js, .mjs, or .cjs script path.' }, args: { type: 'array', items: { type: 'string' }, maxItems: 20 } }, required: ['path'], additionalProperties: false },
  },
];

const TOOL_NAMES = new Set(TOOL_DEFINITIONS.map(tool => tool.name));

export async function resolveWorkspaceRoot(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Tentukan workspace secara eksplisit dengan --workspace PATH.');
  const candidate = path.resolve(input.trim());
  const root = await realpath(candidate);
  const info = await lstat(root);
  if (!info.isDirectory()) throw new Error('Workspace harus berupa direktori yang sudah ada.');
  return root;
}

function inside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

function relativeTarget(root, input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Path relatif wajib diisi.');
  if (input.includes('\0') || path.isAbsolute(input) || path.win32.isAbsolute(input) || /^[A-Za-z]:/.test(input)) {
    throw new Error('Path harus relatif terhadap workspace.');
  }
  if (input.split(/[\\/]+/).includes('..')) throw new Error('Segmen .. tidak diizinkan.');
  const target = path.resolve(root, input);
  if (!inside(root, target)) throw new Error('Path berada di luar workspace.');
  return target;
}

function relativeLabel(root, target) {
  const label = path.relative(root, target);
  return label || '.';
}

function isSensitivePath(root, target) {
  const segments = path.relative(root, target).split(path.sep).filter(Boolean);
  return segments.some(segment => {
    const name = segment.toLowerCase();
    if (name === '.git' || name === 'node_modules' || name === '.ssh') return true;
    if (/^\.env(?:$|\.(?!example$|sample$))/.test(name)) return true;
    if (/^(?:id_rsa|id_ed25519)(?:\..*)?$/.test(name)) return true;
    if (/\.(?:pem|key|p12|pfx|p8)$/i.test(name)) return true;
    return false;
  });
}

async function assertNoSymlinkComponents(root, target, { allowMissing = false } = {}) {
  if (!inside(root, target)) throw new Error('Path berada di luar workspace.');
  const rel = path.relative(root, target);
  const parts = rel ? rel.split(path.sep) : [];
  let current = root;
  for (let i = 0; i < parts.length; i += 1) {
    current = path.join(current, parts[i]);
    let info;
    try { info = await lstat(current); }
    catch (error) {
      if (allowMissing && error.code === 'ENOENT') return;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error('Symlink tidak diikuti oleh tool workspace.');
    if (i < parts.length - 1 && !info.isDirectory()) throw new Error('Komponen path di tengah bukan direktori.');
  }
}

async function ensureParentDirectories(root, target) {
  const parent = path.dirname(target);
  const rel = path.relative(root, parent);
  let current = root;
  for (const part of rel ? rel.split(path.sep) : []) {
    current = path.join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Parent path harus direktori biasa; symlink ditolak.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await mkdir(current, { mode: 0o700 });
    }
  }
}

function requireString(value, name, { allowEmpty = false, max = MAX_WRITE_BYTES } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && !value) || Buffer.byteLength(value, 'utf8') > max) {
    throw new Error(`${name} harus berupa teks${allowEmpty ? '' : ' non-kosong'} maksimal ${max} byte.`);
  }
  return value;
}

async function readTextFile(root, target) {
  await assertNoSymlinkComponents(root, target);
  if (isSensitivePath(root, target)) throw new Error('Akses ke path sensitif ditolak (.git, node_modules, .env, atau file key/certificate).');
  const info = await lstat(target);
  if (!info.isFile()) throw new Error('Path bukan file biasa.');
  if (info.size > MAX_FILE_BYTES) throw new Error(`File melebihi batas ${MAX_FILE_BYTES} byte.`);
  return readFile(target, 'utf8');
}

function trimOutput(value, cap = MAX_TOOL_OUTPUT) {
  const text = String(value);
  if (Buffer.byteLength(text, 'utf8') <= cap) return text;
  let out = text.slice(0, cap);
  while (Buffer.byteLength(out, 'utf8') > cap - 80) out = out.slice(0, -1);
  return `${out}\n[output dipotong; batas ${cap} byte]`;
}

function sanitizedEnv(root) {
  const env = { PATH: process.env.PATH || '', HOME: root, USERPROFILE: root, TMPDIR: root, TMP: root, TEMP: root };
  if (process.platform === 'win32' && process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  return env;
}

async function runNode(root, target, args) {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) throw new Error('run_node memerlukan Node.js 20+ untuk Permission Model.');
  if (root.includes(',')) throw new Error('Path workspace berisi koma; run_node dinonaktifkan agar batas izin Node tidak ambigu.');
  const argv = ['--permission', `--allow-fs-read=${root}`, `--allow-fs-write=${root}`, target, ...args];
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn(process.execPath, argv, { cwd: root, env: sanitizedEnv(root), stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, MAX_RUN_MS);
    const collect = (current, chunk) => {
      const value = current + chunk.toString('utf8');
      return value.length > MAX_RUN_OUTPUT ? value.slice(0, MAX_RUN_OUTPUT) : value;
    };
    child.stdout.on('data', chunk => { stdout = collect(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = collect(stderr, chunk); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve(`exit ${code}${signal ? ` signal ${signal}` : ''}${timedOut ? ' (timeout 20 detik)' : ''}\n--- stdout ---\n${stdout || '(kosong)'}\n--- stderr ---\n${stderr || '(kosong)'}`);
    });
  });
}

export async function executeTool(name, input, { root, confirm = async () => false } = {}) {
  if (!TOOL_NAMES.has(name)) return `ERROR: tool tidak dikenal: ${String(name).slice(0, 80)}`;
  if (!root) return 'ERROR: workspace root belum ditetapkan.';
  const args = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  try {
    if (name === 'list_dir') {
      const target = relativeTarget(root, args.path ?? '.');
      await assertNoSymlinkComponents(root, target);
      if (isSensitivePath(root, target)) throw new Error('Akses ke path sensitif ditolak.');
      const info = await lstat(target);
      if (!info.isDirectory()) throw new Error('Path bukan direktori.');
      const { readdir } = await import('node:fs/promises');
      const entries = await readdir(target, { withFileTypes: true });
      const names = entries
        .filter(entry => entry.name !== '.git' && entry.name !== 'node_modules' && entry.name !== '.ssh')
        .map(entry => `${entry.name}${entry.isDirectory() ? '/' : entry.isSymbolicLink() ? ' [symlink; tidak diikuti]' : ''}`)
        .sort((a, b) => a.localeCompare(b));
      return trimOutput(names.join('\n') || '(kosong)');
    }

    if (name === 'read_file') {
      const target = relativeTarget(root, args.path);
      const text = await readTextFile(root, target);
      const start = Number.isInteger(args.start_line) && args.start_line >= 1 ? args.start_line : 1;
      const limit = Number.isInteger(args.limit) && args.limit >= 1 ? Math.min(args.limit, 400) : 200;
      const rows = text.split(/\r?\n/).slice(start - 1, start - 1 + limit);
      return trimOutput(rows.map((line, index) => `${String(start + index).padStart(5, ' ')}  ${line}`).join('\n') || '(kosong)');
    }

    if (name === 'write_file') {
      const content = requireString(args.content, 'content', { allowEmpty: true, max: MAX_WRITE_BYTES });
      const target = relativeTarget(root, args.path);
      if (isSensitivePath(root, target)) throw new Error('Menulis ke path sensitif ditolak.');
      await assertNoSymlinkComponents(root, target, { allowMissing: true });
      const label = relativeLabel(root, target);
      const preview = content.slice(0, 500);
      const accepted = await confirm('write', `${label} (${Buffer.byteLength(content, 'utf8')} byte)\nKonten: ${JSON.stringify(preview)}${content.length > preview.length ? '… [preview dipotong]' : ''}`);
      if (!accepted) return 'Dibatalkan pengguna; tidak ada perubahan.';
      await ensureParentDirectories(root, target);
      await assertNoSymlinkComponents(root, target, { allowMissing: true });
      try {
        const info = await lstat(target);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error('Target harus file biasa; symlink atau direktori ditolak.');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await writeFile(target, content, { encoding: 'utf8', mode: 0o600 });
      return `Tersimpan: ${label} (${Buffer.byteLength(content, 'utf8')} byte).`;
    }

    if (name === 'edit_file') {
      const oldText = requireString(args.old_string, 'old_string', { max: MAX_FILE_BYTES });
      const newText = requireString(args.new_string, 'new_string', { allowEmpty: true, max: MAX_WRITE_BYTES });
      const target = relativeTarget(root, args.path);
      const label = relativeLabel(root, target);
      if (isSensitivePath(root, target)) throw new Error('Mengedit path sensitif ditolak.');
      const text = await readTextFile(root, target);
      const count = text.split(oldText).length - 1;
      if (count !== 1) throw new Error(count === 0 ? 'old_string tidak ditemukan.' : `old_string muncul ${count} kali; harus unik.`);
      const replacement = text.replace(oldText, newText);
      if (Buffer.byteLength(replacement, 'utf8') > MAX_FILE_BYTES) throw new Error(`Hasil edit melebihi batas ${MAX_FILE_BYTES} byte.`);
      const detail = `${label}\nLama: ${JSON.stringify(oldText.slice(0, 200))}${oldText.length > 200 ? '…' : ''}\nBaru: ${JSON.stringify(newText.slice(0, 200))}${newText.length > 200 ? '…' : ''}`;
      const accepted = await confirm('edit', detail);
      if (!accepted) return 'Dibatalkan pengguna; tidak ada perubahan.';
      await assertNoSymlinkComponents(root, target);
      const latest = await readTextFile(root, target);
      if (latest !== text) throw new Error('File berubah setelah persetujuan diminta; tidak ada edit. Baca ulang dan coba lagi.');
      await writeFile(target, replacement, { encoding: 'utf8' });
      return `Diedit: ${label}.`;
    }

    if (name === 'run_node') {
      const target = relativeTarget(root, args.path);
      const extension = path.extname(target).toLowerCase();
      if (!['.js', '.mjs', '.cjs'].includes(extension)) throw new Error('run_node hanya menerima file .js, .mjs, atau .cjs.');
      await assertNoSymlinkComponents(root, target);
      if (isSensitivePath(root, target)) throw new Error('Menjalankan file dari path sensitif ditolak.');
      const info = await lstat(target);
      if (!info.isFile()) throw new Error('Script bukan file biasa.');
      if (info.size > MAX_FILE_BYTES) throw new Error(`Script melebihi batas ${MAX_FILE_BYTES} byte.`);
      const scriptHash = createHash('sha256').update(await readFile(target)).digest('hex');
      const runArgs = args.args === undefined ? [] : args.args;
      if (!Array.isArray(runArgs) || runArgs.length > 20 || runArgs.some(value => typeof value !== 'string' || value.length > 1000)) {
        throw new Error('args harus berupa array maksimal 20 string (masing-masing maksimal 1000 karakter).');
      }
      const label = relativeLabel(root, target);
      const command = `node [Permission Model: filesystem workspace-only, child processes denied] ${label}${runArgs.length ? ` ${runArgs.map(value => JSON.stringify(value)).join(' ')}` : ''}`;
      const accepted = await confirm('run', `${command}\nSHA-256 script: ${scriptHash}`);
      if (!accepted) return 'Dibatalkan pengguna; script tidak dijalankan.';
      await assertNoSymlinkComponents(root, target);
      const latest = await readFile(target);
      if (createHash('sha256').update(latest).digest('hex') !== scriptHash) throw new Error('Script berubah setelah persetujuan diminta; tidak dijalankan. Tinjau ulang dan coba lagi.');
      return trimOutput(await runNode(root, target, runArgs), MAX_RUN_OUTPUT + 300);
    }

    return 'ERROR: tool belum tersedia.';
  } catch (error) {
    return `ERROR: ${error?.message || 'operasi gagal'}`;
  }
}
