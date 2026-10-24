# TDCC Tools — CLI lokal dengan tool workspace terbatas

Asisten terminal Node.js ini meminta satu API key project yang sudah diberikan melalui kanal resmi TDCC, menyimpan key di luar repo, lalu memakai key yang sama untuk chat dan tool calls. Setup tidak membuat atau memvalidasi key. Tidak ada pool, key pengganti, rotasi otomatis, retry, atau shell bebas. Tool workspace tetap dibatasi ke direktori yang dipilih dan tindakan tulis/eksekusi membutuhkan persetujuan.

## Key project resmi

Dokumentasi publik TDCC menyebut API key project-scoped, tetapi tidak mendokumentasikan endpoint provisioning key. Karena itu, `node src/cli.mjs setup` **tidak memanggil** `POST /api/keys` dari Gist dan tidak bisa membuktikan bahwa nilai yang dikembalikan endpoint itu adalah kredensial TDCC yang sah.

Gist contoh memakai host dan endpoint yang tidak tercantum di dokumentasi resmi serta model `tdcc-chat`. Sebuah respons JSON yang berisi field `key` tidak membuktikan bahwa key itu terikat ke project TDCC. Karena itu, masukkan hanya key project yang benar-benar diberikan TDCC; jangan memakai atau membuat key lewat endpoint Gist.

## Persyaratan dan setup

Perlu Node.js 20 atau lebih baru; tidak ada dependency npm runtime. Di folder proyek:

```sh
node --version
node src/cli.mjs setup
```

Setup meminta model ID dan key project resmi. Key dapat dimasukkan dengan input tersembunyi di terminal, atau melalui environment `TDCC_API_KEY`; setup tidak mengirim request jaringan. Default `deepseek/deepseek-v4-flash-free` dan base URL Anthropic `https://decentralizedcompute.company/api/anthropic` mengikuti contoh pada [halaman TDCC App](https://decentralizedcompute.company/app.html). Akses model untuk project/cohort kamu belum diuji live; pakai ID yang diberikan TDCC jika berbeda.

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

Integrasi memakai base URL Anthropic yang dipublikasikan TDCC dan route standar Anthropic `/v1/messages`, sehingga URL request penuh adalah `https://decentralizedcompute.company/api/anthropic/v1/messages`. Pesan dan definisi tool memakai format Anthropic; dukungan live untuk akun, model, dan tool-use belum diuji. Jika ditolak, program melaporkan error dan tidak mencoba endpoint Gist atau fallback lain.

## Kuota dan perilaku API

- Satu key project-scoped yang diberikan pemilik dipakai untuk konfigurasi; program tidak melakukan minting, failover, retry, atau rotasi otomatis.
- Jika chat menerima HTTP 429, program berhenti dan menampilkan `Retry-After` bila tersedia. Tunggu arahan TDCC; jangan membuat key tambahan untuk menghindari kuota.
- Halaman TDCC menyebut kuota early-access per cohort dapat membatasi concurrency dan belanja, serta kenaikan dapat diminta. Angka pasti per akun, request/minute, cakupan model, dan jadwal reset tidak dipublikasikan di halaman tersebut.
- Halaman resmi menyebut preview/early-access dan request shape dapat berubah sebelum API dinyatakan stabil. Tes lokal tidak membuktikan key, endpoint, model, atau tool-use bekerja live.

## Tes lokal

```sh
npm test
```

Tes menggunakan mock dan direktori sementara. Tes memastikan key yang disediakan pemilik disimpan tanpa menampilkan nilainya; tidak ada request ke endpoint provisioning atau chat TDCC, dan tidak mengubah `/pentest-web`.

## Referensi

- [TDCC App — gateway, API, autentikasi, dan kuota cohort](https://decentralizedcompute.company/app.html)
- [Halaman akun TDCC](https://decentralizedcompute.company/account.html) — menjelaskan akun umum, bukan alur API-key rinci
- [Gist contoh awal](https://gist.github.com/fzn0x/1253c6fd5995a5629bf3a255dd6d6648) — contoh tidak resmi; endpoint provisioning dan modelnya tidak dipakai oleh versi ini

Repositori proyek: <https://github.com/myruldev/TDCC-Tools> (branch `main`).
