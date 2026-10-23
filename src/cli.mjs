#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { configDirectory, DEFAULT_MODEL, loadConfig, removeConfig, saveConfig } from './config.mjs';
import { runTurn } from './agent.mjs';
import { resolveWorkspaceRoot } from './workspace.mjs';

function usage() {
  console.log(`TDCC Tools (one project key; no key creation or rotation pool)

Commands:
  node src/cli.mjs setup
  node src/cli.mjs status
  node src/cli.mjs remove-key
  node src/cli.mjs --workspace /absolute/path/to/workspace

Chat commands:
  /clear   Clear in-memory conversation
  /quit    Exit
`);
}

function terminal() {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Jalankan perintah ini di terminal interaktif; persetujuan tool tidak pernah otomatis.');
  return createInterface({ input: stdin, output: stdout });
}

async function readHidden(prompt) {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('Input key tersembunyi memerlukan terminal interaktif yang mendukung raw mode.');
  }
  stdout.write(prompt);
  const wasRaw = Boolean(stdin.isRaw);
  stdin.setEncoding('utf8');
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    let finished = false;
    const finish = error => {
      if (finished) return;
      finished = true;
      stdin.off('data', onData);
      process.off('SIGINT', onSignal);
      stdin.setRawMode(wasRaw);
      stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onSignal = () => finish(new Error('Input key dibatalkan.'));
    const onData = chunk => {
      for (const character of chunk) {
        if (character === '\u0003') return finish(new Error('Input key dibatalkan.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') {
          value = Array.from(value).slice(0, -1).join('');
          continue;
        }
        if (character === '\u0015') {
          value = '';
          continue;
        }
        if (character >= ' ' && character !== '\u007f' && character !== '\u001b') value += character;
      }
    };
    stdin.on('data', onData);
    process.once('SIGINT', onSignal);
  });
}

async function setup() {
  console.log(`Base URL resmi TDCC: https://decentralizedcompute.company/api/anthropic`);
  console.log('Model di bawah adalah contoh pada halaman TDCC; ketersediaan untuk akunmu tidak dijamin.');
  const apiKey = (await readHidden('API key proyek TDCC (input disembunyikan): ')).trim();
  if (!apiKey) throw new Error('API key kosong; konfigurasi tidak disimpan.');
  const rl = terminal();
  try {
    const answer = (await rl.question(`Model ID [${DEFAULT_MODEL}]: `)).trim();
    await saveConfig({ apiKey, model: answer || DEFAULT_MODEL });
    console.log(`Konfigurasi tersimpan di ${configDirectory()} dengan permission privat. Key tidak dicetak dan tidak diletakkan di repository.`);
    console.log('Setup tidak menguji key. Permintaan pertama hanya terjadi setelah kamu mengirim prompt pada sesi chat.');
  } finally {
    rl.close();
  }
}

async function status() {
  const config = await loadConfig();
  if (!config) {
    console.log('Belum ada konfigurasi. Jalankan: node src/cli.mjs setup');
    return;
  }
  console.log('Konfigurasi lokal: siap');
  console.log('API key: tersimpan (nilainya tidak ditampilkan)');
  console.log(`Model: ${config.model}`);
  console.log('Endpoint: https://decentralizedcompute.company/api/anthropic');
  console.log('Key tunggal; tidak ada auto-retry, rotasi, atau pool. Status layanan/kuota tidak diperiksa oleh perintah ini.');
}

async function removeKey() {
  const rl = terminal();
  try {
    const answer = await rl.question(`Hapus konfigurasi lokal ${configDirectory()}/config.json? [y/N] `);
    if (!/^y(?:es)?$/i.test(answer.trim())) {
      console.log('Dibatalkan; konfigurasi tidak berubah.');
      return;
    }
    const removed = await removeConfig();
    console.log(removed ? 'Konfigurasi lokal dihapus. Ini tidak mencabut key di TDCC.' : 'Tidak ada konfigurasi lokal.');
  } finally {
    rl.close();
  }
}

function workspaceArgument(argv) {
  const index = argv.indexOf('--workspace');
  if (index < 0 || !argv[index + 1] || argv[index + 1].startsWith('--')) return null;
  return argv[index + 1];
}

async function chat(workspacePath) {
  const config = await loadConfig();
  if (!config) throw new Error('Belum ada API key proyek. Jalankan: node src/cli.mjs setup');
  const root = await resolveWorkspaceRoot(workspacePath);
  const rl = terminal();
  const messages = [];
  try {
    console.log('TDCC Tools siap. Tool hanya melihat workspace yang dipilih. Key tidak ditampilkan.');
    console.log(`Workspace: ${root}`);
    console.log(`Model: ${config.model}`);
    console.log('Untuk write/edit atau run_node, jawab y secara eksplisit pada prompt persetujuan (default: tidak). File yang dibaca dapat dikirim ke TDCC.');
    console.log('Ketik /clear untuk menghapus riwayat di memori atau /quit untuk keluar.');

    while (true) {
      const prompt = (await rl.question('\nKamu> ')).trim();
      if (!prompt) continue;
      if (prompt === '/quit' || prompt === '/exit') break;
      if (prompt === '/clear') {
        messages.length = 0;
        console.log('Riwayat percakapan dihapus dari memori.');
        continue;
      }

      try {
        const result = await runTurn({
          apiKey: config.apiKey,
          model: config.model,
          messages,
          prompt,
          root,
          confirm: async (kind, detail) => {
            const label = kind === 'run' ? 'JALANKAN' : kind === 'edit' ? 'UBAH' : 'TULIS';
            const answer = await rl.question(`\nPersetujuan ${label}: ${detail}\nLanjutkan? [y/N] `);
            return /^y(?:es)?$/i.test(answer.trim());
          },
          onText: text => { if (text.trim()) console.log(`\nAsisten> ${text}`); },
        });
        if (result.stopReason === 'max_tokens') console.log('\n[Catatan: respons mencapai batas token.]');
      } catch (error) {
        console.error(`\nPermintaan gagal: ${error?.message || 'kesalahan tidak diketahui'}`);
        console.error('Tidak ada retry otomatis atau pergantian key. Riwayat sebelumnya tetap berada di memori sesi.');
      }
    }
  } finally {
    rl.close();
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) return usage();
  if (argv[0] === 'setup') return setup();
  if (argv[0] === 'status') return status();
  if (argv[0] === 'remove-key') return removeKey();
  const workspace = workspaceArgument(argv);
  if (!workspace) return usage();
  return chat(workspace);
}

main().catch(error => {
  console.error(`Error: ${error?.message || 'kesalahan tidak diketahui'}`);
  process.exitCode = 1;
});
