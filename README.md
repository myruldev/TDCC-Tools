# TDCC Tools — CLI lokal dengan tool workspace terbatas

Asisten terminal Node.js ini meminta tepat satu API key pada setup, menyimpan key di luar repo, lalu memakai key yang sama untuk chat dan tool calls. Tidak ada pool, key pengganti, rotasi otomatis, retry, atau shell bebas. Tool workspace tetap dibatasi ke direktori yang dipilih dan tindakan tulis/eksekusi membutuhkan persetujuan.

## Pembuatan satu key otomatis

`node src/cli.mjs setup` meminta satu key lewat endpoint yang dipakai Gist:

```http
POST https://chat.decentralizedcompute.company/api/keys
Content-Type: application/json

{"name":"agent-<timestamp>"}
```

Sesuai kode Gist, program mengharapkan respons JSON dengan field `key`, menyimpan nilai itu ke konfigurasi lokal privat, dan tidak menampilkannya. Permintaan setup hanya dikirim satu kali. Jika konfigurasi lokal sudah berisi key, setup berhenti tanpa meminta key baru.

**Batas verifikasi:** endpoint `POST /api/keys` hanya didapat dari [Gist contoh](https://gist.github.com/fzn0x/1253c6fd5995a5629bf3a255dd6d6648); dokumentasi publik resmi TDCC yang diperiksa tidak mengonfirmasi endpoint atau kontrak provisioning tersebut. Endpoint pembuatan key, endpoint chat, kompatibilitas tool calls, dan ketersediaan model belum diverifikasi resmi/live. Tes proyek menggunakan mock dan tidak mengirim request ke TDCC. Gunakan hanya jika memahami bahwa kontrak endpoint ini belum dikonfirmasi TDCC.

Permintaan yang timeout, terputus, atau memberi respons sukses dengan format tak terduga bisa saja sudah membuat key di server. Tidak ada retry otomatis: periksa console TDCC sebelum mencoba setup lagi. HTTP 429 menghentikan setup dan menampilkan `Retry-After` bila tersedia; program tidak meminta key pengganti. Jika key berhasil dibuat tetapi gagal disimpan lokal, program meminta key itu dicabut melalui console TDCC sebelum setup dicoba lagi.

Dokumentasi resmi [TDCC App](https://decentralizedcompute.company/app.html) menyebut gateway kompatibel OpenAI dan Anthropic, memberi contoh base URL Anthropic `https://decentralizedcompute.company/api/anthropic`, serta menyebut API key project-scoped dan rotation. Namun halaman itu tidak merinci `POST /api/keys`, path chat lengkap, dukungan tool-use, ID model yang tersedia untuk akun ini, ataupun batas request-per-minute per key. Tidak ada fallback ke endpoint atau model pada Gist.

## Persyaratan dan setup

Perlu Node.js 20 atau lebih baru; tidak ada dependency npm runtime. Di folder proyek:

```sh
node --version
node src/cli.mjs setup
```

Setup meminta model ID, lalu membuat satu key. Default `deepseek/deepseek-v4-flash-free` adalah contoh pada halaman TDCC, tetapi ketersediaan untuk project/cohort kamu **tidak dijamin dan belum diuji live**. Ganti dengan model ID yang diberikan TDCC jika berbeda.

Key disimpan di luar repo: `~/.config/tdcc-tools/config.json` (atau `$XDG_CONFIG_HOME/tdcc-tools/config.json`), dengan direktori permission `700` dan file `600` pada Linux/macOS. Penyimpanan ini tidak terenkripsi. Jangan menyalin file itu ke repo atau membagikannya. Untuk mengecek konfigurasi tanpa menampilkan key:

```sh
node src/cli.mjs status
```

Untuk menghapus salinan lokal:

```sh
node src/cli.mjs remove-key
```

Perintah `remove-key` **tidak mencabut key di TDCC**. Sebelum meminta key lain, cabut key lama melalui console/administrator TDCC, baru hapus konfigurasi lokal dan jalankan setup lagi. Dokumentasi publik yang diperiksa menyebut key project-scoped dan rotation, tetapi tidak menjelaskan alur klik atau endpoint pencabutan secara rinci.

## Menjalankan chat dan tool

Tentukan direktori yang memang boleh dibaca/diubah. Direktori itu harus sudah ada. Jangan pilih folder berisi data atau kredensial yang tidak ingin dikirim ke model.

```sh
mkdir -p "$HOME/tdcc-workspace"
node src/cli.mjs --workspace "$HOME/tdcc-workspace"
```

Contoh prompt: “Lihat file di folder ini”, “Baca `notes.txt`”, atau “Buat `draft.md` berisi …”. Untuk setiap write/edit, terminal menampilkan path dan preview konten/perubahan; untuk eksekusi script, terminal menampilkan path, argumen, dan hash SHA-256. Persetujuan berlaku untuk satu aksi itu saja. Jawaban `y`/`yes` menyetujui; selain itu berarti tidak. Tidak ada mode auto-approve.

Tool yang tersedia:

- `list_dir` dan `read_file` hanya memakai path relatif di workspace. Path keluar workspace dan symlink ditolak. `.git`, `node_modules`, `.ssh`, `.env`, serta beberapa file key/certificate umum diblokir.
- `write_file` dan `edit_file` menulis hanya setelah persetujuan; edit harus memiliki satu kecocokan persis.
- `run_node` menjalankan file `.js`, `.mjs`, atau `.cjs` dengan Node Permission Model: filesystem dibatasi ke workspace dan izin child-process tidak diberikan. Ini bukan container penuh; script yang disetujui masih dapat memakai kemampuan runtime lain seperti jaringan. Jalankan hanya script yang dipercaya. Tidak ada shell bebas `run_cmd`.

Konten file yang dibaca masuk ke percakapan dan dikirim ke TDCC. Filter nama file bukan jaminan bahwa file lain tidak memuat rahasia; periksa workspace sebelum memakainya. Riwayat chat hanya disimpan dalam memori proses dan hilang ketika CLI keluar. Tool tidak mengirim request chat sebelum kamu memasukkan prompt.

Integrasi memakai endpoint Anthropic Messages di bawah base URL TDCC yang dipublikasikan dan menyertakan definisi tool dalam request. Namun path gabungan dan dukungan tool-use belum dikonfirmasi TDCC atau diuji live. Jika endpoint/model/tool-use ditolak, program melaporkan error; jangan menambahkan fallback endpoint Gist tanpa konfirmasi resmi.

## Kuota dan perilaku API

- Satu key project-scoped dipakai untuk konfigurasi; tidak ada pool, minting pengganti, failover, retry, atau rotasi otomatis.
- Jika pembuatan key atau chat menerima HTTP 429, program berhenti dan menampilkan `Retry-After` bila tersedia. Tunggu arahan TDCC; jangan membuat key tambahan untuk menghindari kuota.
- Halaman TDCC menyebut kuota early-access per cohort dapat membatasi concurrency dan belanja, serta kenaikan dapat diminta. Angka pasti per akun, request/minute, cakupan model, dan jadwal reset tidak dipublikasikan di halaman tersebut.
- Halaman resmi menyebut preview/early-access dan request shape dapat berubah sebelum API dinyatakan stabil. Tes lokal tidak membuktikan key, endpoint, model, atau tool-use bekerja live.

## Tes lokal

```sh
npm test
```

Tes menggunakan mock HTTP dan direktori sementara. Tes provisioning memastikan paling banyak satu POST per percobaan, tidak mengirim request nyata ke endpoint key/chat, dan tidak mengubah `/pentest-web`.

## Referensi

- [TDCC App — gateway, API, autentikasi, dan kuota cohort](https://decentralizedcompute.company/app.html)
- [Halaman akun TDCC](https://decentralizedcompute.company/account.html) — menjelaskan akun umum, bukan alur API-key rinci
- [Gist contoh awal](https://gist.github.com/fzn0x/1253c6fd5995a5629bf3a255dd6d6648) — sumber endpoint provisioning yang dipakai pada setup ini; endpoint tersebut belum dikonfirmasi dokumentasi resmi

Repositori proyek: <https://github.com/myruldev/TDCC-Tools> (branch `main`).
