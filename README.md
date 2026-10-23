# TDCC Tools — CLI lokal dengan tool workspace terbatas

Contoh asisten terminal Node.js yang memakai satu API key proyek TDCC melalui base URL Anthropic-compatible yang dipublikasikan. Asisten dapat membaca daftar/file workspace, menulis atau mengedit file setelah persetujuan, dan menjalankan satu script Node.js setelah persetujuan. Key tidak dibuat, dirotasi, atau dikumpulkan dalam pool oleh program ini.

## Mengapa tidak membuat key otomatis?

Halaman resmi [TDCC App](https://decentralizedcompute.company/app.html) menyebut gateway kompatibel OpenAI dan Anthropic, memberi contoh base URL Anthropic `https://decentralizedcompute.company/api/anthropic`, dan menyebut API key yang scoped ke proyek serta memiliki rotation. Halaman itu juga menyebut kuota early-access per cohort untuk concurrency dan belanja, yang bisa dinaikkan atas permintaan.

Dokumentasi publik yang ditemukan **tidak** menjelaskan endpoint `POST /api/keys`, pembuatan key otomatis, batas 60 request/menit per key, endpoint `/v1/chat/completions` pada domain gist, atau model `tdcc-chat`. Karena itu kode ini tidak memanggil endpoint atau model tersebut, tidak melewati kuota, tidak merotasi key otomatis, dan tidak mencoba key kedua. Public docs juga tidak memberi angka batas request/minute yang bisa diklaim di sini.

Untuk endpoint chat, kode memakai rute Anthropic Messages standar di bawah base URL resmi (`/v1/messages`). TDCC menyatakan base URL kompatibel dengan protokol Anthropic, tetapi halaman publik tidak merinci path gabungan atau menyatakan tool-use secara terpisah. Integrasi ini belum divalidasi live; jika mendapat 404 atau error tool-use, berhenti dan minta konfirmasi endpoint/model dari admin TDCC—jangan fallback ke endpoint gist.

## Persyaratan dan setup

Perlu Node.js 20 atau lebih baru, tidak ada dependency npm runtime. Di folder proyek:

```sh
node --version
node src/cli.mjs setup
```

Setup meminta satu key proyek lewat input terminal tersembunyi. Model contoh dari halaman TDCC adalah `deepseek/deepseek-v4-flash-free`; setup memakainya sebagai default, tetapi ketersediaannya untuk project/cohort kamu **tidak dijamin**. Ganti dengan model ID yang diberikan TDCC jika berbeda. Setup hanya menyimpan konfigurasi—ia tidak menguji key atau mengirim request.

Kunci disimpan di luar repo: `~/.config/tdcc-tools/config.json` (atau `$XDG_CONFIG_HOME/tdcc-tools/config.json`), dengan direktori permission `700` dan file `600` pada Linux/macOS. Penyimpanan ini tidak terenkripsi. Jangan menyalin file itu ke repo atau membagikannya. Untuk mengecek tanpa menampilkan nilai key:

```sh
node src/cli.mjs status
```

Untuk menghapus salinan lokal (tidak mencabut key di TDCC):

```sh
node src/cli.mjs remove-key
```

Key harus diperoleh melalui alur resmi project/console TDCC oleh owner/admin yang berwenang. Dokumentasi publik mengonfirmasi key project-scoped dan rotation, tetapi tidak memberi langkah klik yang rinci. Jika akun belum menyediakan key, minta owner/admin atau TDCC menyediakan akses; jangan menebak endpoint pembuatan key.

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
- `run_node` menjalankan file `.js`, `.mjs`, atau `.cjs` dengan Node Permission Model: filesystem dibatasi ke workspace dan izin child-process tidak diberikan. Ini bukan container penuh; kode yang kamu setujui masih dapat memakai kemampuan runtime lain seperti jaringan. Jalankan hanya script yang dipercaya. Tidak ada shell bebas `run_cmd`.

Konten file yang dibaca akan masuk ke percakapan dan dikirim ke TDCC. Filter nama file bukan jaminan bahwa file lain tidak memuat rahasia; periksa workspace sebelum memakainya. Riwayat chat hanya disimpan di memori proses dan hilang ketika CLI keluar. Tool tidak mengirim request provider kecuali setelah kamu memasukkan prompt.

## Kuota dan perilaku API

- Satu key project-scoped dipakai per sesi; tidak ada pool, minting, failover, retry, atau rotasi otomatis.
- Untuk HTTP 429, program menampilkan `Retry-After` bila tersedia lalu berhenti. Tunggu sesuai arahan layanan/owner; jangan buat key tambahan untuk menghindari batas.
- Yang diketahui dari TDCC: early-access quota dapat membatasi concurrency dan belanja per cohort; kenaikan diminta melalui TDCC. Angka pasti per akun, request/minute, cakupan model, dan jadwal reset tidak dipublikasikan pada halaman yang dirujuk.
- Halaman resmi menyebut preview/early-access dan request shape dapat berubah sebelum API dinyatakan stabil. Setup tidak memverifikasi status live. Chat TDCC yang diperiksa saat riset masih memperlihatkan Demo mode, jadi kode dan tes lokal di bawah ini tidak membuktikan key/model benar-benar aktif.

## Tes lokal

```sh
npm test
```

Tes memakai mock HTTP dan direktori sementara; tidak mengirim request sungguhan ke TDCC serta tidak mengubah `/pentest-web`.

## Referensi

- [TDCC App — gateway, API, autentikasi, dan kuota cohort](https://decentralizedcompute.company/app.html)
- [Halaman akun TDCC](https://decentralizedcompute.company/account.html) — menjelaskan akun umum, bukan alur API-key rinci
- [Gist contoh awal](https://gist.github.com/fzn0x/1253c6fd5995a5629bf3a255dd6d6648) — inspirasi untuk tool calls; endpoint key-pool dan detail rate limit di gist tidak diperlakukan sebagai dukungan resmi

Repositori proyek: https://github.com/myruldev/TDCC-Chat (branch `main`).
