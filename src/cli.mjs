#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { configDirectory, DEFAULT_MODEL, loadConfig, removeConfig, validateModel } from './config.mjs';
import { runTurn } from './agent.mjs';
import { resolveWorkspaceRoot } from './workspace.mjs';
import { createAndSaveProjectApiKey } from './key-setup.mjs';

function usage() {
  console.log(`TDCC Tools (one project key; no pool or rotation)

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

async function setup() {
  const existing = await loadConfig();
  if (existing) {
    console.log('Setup berhenti tanpa membuat key: konfigurasi lokal sudah berisi satu key.');
    console.log('Agar tidak menambah key yang tidak perlu, cabut key lama di console TDCC sebelum menghapus konfigurasi lokal dan menjalankan setup lagi.');
    return;
  }

  const rl = terminal();
  let model;
  try {
    const answer = (await rl.question(`Model ID [${DEFAULT_MODEL}]: `)).trim();
    model = validateModel(answer || DEFAULT_MODEL);
  } finally {
    rl.close();
  }

  console.log('Setup akan meminta tepat satu key melalui endpoint pada Gist; endpoint ini belum diverifikasi resmi atau live.');
  console.log('Tidak ada retry. Jika hasil POST tidak pasti, periksa console TDCC sebelum mencoba setup lagi.');
  const created = await createAndSaveProjectApiKey({ model });
  console.log(`Satu key (nama: ${created.name}) tersimpan di ${configDirectory()} dengan permission privat; nilainya tidak ditampilkan.`);
  console.log('Key tersimpan digunakan untuk chat dan tool calls. Permintaan chat pertama hanya dikirim setelah kamu memasukkan prompt.');
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
  console.log('Satu key tersimpan; tidak ada pool, rotasi, key pengganti, atau retry otomatis. Status layanan/kuota tidak diperiksa oleh perintah ini.');
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
