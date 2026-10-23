# Prompt handoff — desktop coding agent macOS

Salin isi di bawah ke sesi baru, atau minta agent membaca file ini sebagai konteks kerja.

---

Saya ingin melanjutkan review dan perencanaan aplikasi coding agent desktop macOS untuk penggunaan pribadi. Gunakan handoff ini agar tidak mengulang keputusan yang sudah dibuat.

## 1. Tugas sesi baru

Inspeksi kondisi repo dan dokumen yang sudah ada, review draft design/plan, validasi asumsi yang masih terbuka, lalu perbarui dokumen jika diperlukan. Jangan langsung mengimplementasikan produk.

Draft sudah ditulis pada sesi sebelumnya, tetapi belum ada persetujuan eksplisit untuk implementasi. Persetujuan rekomendasi toolchain atau penyimpanan prompt bukan persetujuan instalasi, OAuth, inference, atau eksekusi plan.

## 2. Repo dan keadaan terakhir

- Repo: `/home/ubuntu/Project/neiro`
- Remote: `https://github.com/julianreza/neiro.git`
- Pengguna mengonfirmasi ini repo project baru.
- Nama produk belum ditentukan; `neiro` adalah nama repo, bukan nama produk final.
- Project terpisah dari Nail. Nail hanya referensi pelajaran, bukan basis untuk disalin.
- Jangan mengubah repo lain atau menggunakan kredensial/config agent personal.

Dokumen yang sudah dibuat:
- `docs/superpowers/research/2026-10-23-engine-feasibility.md`
- `docs/superpowers/specs/2026-10-23-omp-desktop-design.md`
- `docs/superpowers/plans/2026-10-23-omp-poc-plan.md`

Pada inspeksi terakhir, repo belum memiliki commit dan hanya berisi metadata Git sebelum dokumen planning dibuat. Dokumen belum di-commit/push. Periksa ulang status aktual; jangan menimpa perubahan pengguna atau menganggap repo tetap kosong.

Mulai dengan membaca AGENTS.md/instruksi yang berlaku, status Git, struktur repo, dan ketiga dokumen di atas. Jangan membuat ulang dokumen yang sama tanpa membaca isinya.

## 3. Target perangkat dan toolchain

- MacBook M1, Apple Silicon `arm64`.
- Pengguna melaporkan macOS **27.2**. Ini informasi pengguna, belum diverifikasi langsung pada mesin target.
- Xcode belum terpasang.
- Rekomendasi yang diterima pengguna: **Xcode 27.1** sebagai baseline pengembangan; instal aplikasi Xcode lengkap untuk SwiftUI, bukan hanya Command Line Tools.
- Pada pemeriksaan sebelumnya, halaman resmi Apple `https://developer.apple.com/support/xcode/` mencantumkan Xcode 27.1 mendukung macOS 26.6 atau lebih baru dan Xcode 27.2 berstatus RC. Periksa lagi sebelum instalasi; jangan menganggap label rilis tetap sama.
- Usulan minimum deployment aplikasi: **macOS 15.0**, Apple Silicon saja. Ini target desain sementara, belum jaminan kompatibilitas engine/runtime.
- Prioritas acceptance awal: macOS 27.2 pada MacBook pengguna. Jangan mengklaim dukungan macOS 15 hanya dari deployment target.
- Intel/Universal Binary ditunda.
- Host agent sebelumnya Linux. Periksa host aktual; pengujian Linux tidak membuktikan build/runtime macOS.

Perbarui draft yang masih menyatakan versi macOS belum diketahui agar sesuai informasi di atas, sambil menjaga status self-reported dan belum diuji.

## 4. Keputusan produk

- Penggunaan pribadi dahulu, lokal di MacBook.
- UI **Swift + SwiftUI**, tanpa React/Electron.
- Fokus coding agent pada repo lokal yang dipilih pengguna.
- Satu engine dahulu, bukan multi-engine.
- Target provider: ChatGPT subscription/Codex, Claude subscription, Antigravity subscription, dan API key.
- Dukungan subscription berbeda dari API vendor; jangan menjanjikan semuanya sebelum verifikasi.
- Engine mengelola login, penyimpanan kredensial, dan refresh.
- Aplikasi tidak mengimplementasikan ulang OAuth dan tidak membaca/menyalin token engine.
- Alur produk: pilih repo/model, kirim tugas, lihat streaming/tool, jawab approval, lihat diff/hasil tes, Stop, tutup dan lanjut sesi.
- Distribusi akhirnya `.app` dalam `.dmg`. Packaging publik, notarization dan auto-update bukan prioritas PoC; kebutuhan signing pengembangan tetap diperiksa.

## 5. Kandidat dan urutan

- **OMP / Oh My Pi** adalah kandidat default engine:
  https://github.com/can1357/oh-my-pi
- **ai-memory** kandidat pengetahuan jangka panjang lokal:
  https://github.com/akitaonrails/ai-memory
- **Obsidian opsional** sebagai viewer/editor wiki Markdown, bukan dependensi runtime.

Urutan yang direkomendasikan:
1. Buktikan OMP tanpa memory dahulu.
2. Satu provider PoC: ChatGPT subscription.
3. Tambahkan ai-memory setelah kontrak engine terbukti.
4. Claude, Antigravity, dan API key lewat gerbang masing-masing.

OMP belum keputusan produksi terverifikasi. Evaluasi alternatif hanya jika ditemukan blocker kebutuhan wajib. Jangan membandingkan semua engine dari awal atau membuat banyak adapter.

OpenCode adalah kandidat fallback, bukan scope implementasi sekarang. Hermes tidak perlu dipilih hanya demi memory. Codex app-server lebih relevan jika scope berubah menjadi Codex-first saja.

Tidak perlu LangGraph/LangChain atau agent loop kedua.

## 6. Arsitektur dan kepemilikan data

```text
SwiftUI
  → adapter OMP tipis
      → runtime OMP lokal
          ├─ autentikasi/kredensial
          ├─ model dan agent loop
          ├─ tools, event, sesi
          └─ integrasi ai-memory
              → layanan memory lokal
                  ├─ pengetahuan dan handoff
                  ├─ wiki Markdown + Git
                  └─ indeks pencarian
```

- Desktop memiliki tampilan, lifecycle, metadata UI dan referensi sesi.
- OMP menjadi sumber utama state/riwayat sesi native serta kredensial provider.
- ai-memory menjadi sumber pengetahuan lintas sesi, bukan pengganti sesi atau permission gate.
- Jangan menduplikasi seluruh state engine ke database aplikasi.
- Bedakan memory, riwayat sesi, compaction, indeks lokal, prompt cache provider, dan kredensial.
- Prompt cache bukan memory dan tidak otomatis berpindah antar-provider.

## 7. Bukti teknis dan koreksi penting

Dokumen riset memuat sumber dipin. Riset sebelumnya hanya dokumentasi/source; belum ada login, inference, runtime agent atau build macOS.

OMP baseline riset:
- Rilis `v18.12.6`.
- Commit `45c35e40c46166dc726ccc52f5d27f40f2449f99`.
- Custom JSONL stdio, bukan JSON-RPC 2.0.
- Login/model/stream/cancel/session didokumentasikan.
- `prompt` success adalah admission, bukan selesai.
- `prompt_result` bisa muncul sebelum seluruh pekerjaan selesai; perhatikan `session_settled`/state quiescence.
- OMP memiliki **approval umum** dengan tier read/write/exec; review awal yang hanya menilai gate ACP terlalu sempit.
- Default approval terdokumentasi **yolo**. PoC harus memakai kebijakan eksplisit, tanpa auto-approve/persistent grants.
- `--no-ui` dapat menonaktifkan jalur dialog approval; jangan mengartikannya sebagai sekadar menyembunyikan terminal.
- Pada SDK, `toolNames` saja **bukan allowlist**. `restrictToolNames` dan discovery control perlu diperiksa; jangan mengasumsikan CLI identik.
- OMP dapat menemukan config, extension, MCP dan custom command ambient. Private state directory saja tidak membuktikan semuanya terisolasi.
- `abort` dan `abort_bash` memiliki jalur berbeda. Response abort bukan bukti semua descendant process berhenti.
- MIT adalah lisensi engine, bukan izin layanan subscription.

ai-memory baseline riset:
- Rilis `v3.2.2`.
- Commit `a387263c7c898fa3bce74dde035c90548a96b468`.
- Support matrix menyebut OMP MCP + TypeScript extension dan dukungan macOS.
- Wiki Markdown/Git dan indeks turunan; jangan menganggap seluruh DB/state cache disposable.
- Jalur default tanpa LLM tersedia; fitur eksternal opsional.
- Sanitizer best-effort, bukan jaminan bebas rahasia.
- Sebagian riset awal memakai main; verifikasi perilaku versi final secara konsisten.
- OMP RPC + ai-memory belum diuji end-to-end.

Angka versi ini baseline, bukan kewajiban memakai latest atau meng-update. Jika mengganti versi, catat alasan dan ulangi kontrak relevan.

## 8. Keamanan wajib

- Memilih folder dan subprocess biasa bukan sandbox.
- Jangan menjanjikan akses hanya dalam repo tanpa boundary OS yang diuji.
- Terminal/eval dapat melewati kategori baca/edit/jaringan/merge/deploy.
- Audit ambient config, extension, MCP dan tool inventory sebelum inference.
- Tanpa TUI keyboard automation jika protokol terstruktur tersedia.
- Approval ditolak/cancel/timeout/disconnect tidak boleh fail-open.
- Aksi yang ditolak tidak menghasilkan efek yang ditolak.
- Jangan memakai pilihan pertama dialog sebagai approval otomatis.
- Stop bukan rollback. Bedakan cancelling, stopped, dan stop-unverified.
- Jangan membunuh proses personal/unrelated berdasarkan nama global.
- Jika child/detached process tidak dapat dipastikan berhenti, laporkan batas dan blok task baru.
- Jangan replay tool otomatis setelah crash; efek mungkin sudah terjadi.
- Jangan reset/stash/checkout/clean perubahan pengguna diam-diam.
- Baseline diff mencakup staged, unstaged, untracked; edit bersamaan dapat membuat atribusi ambiguous.
- Tes membutuhkan command, cwd, exit code, output, dan pass/fail/cancelled/not-run. Klaim model bukan evidence.
- Jangan log token, raw auth payload atau OAuth URL ke dokumen/artifact.
- Jangan mengaktifkan fallback berbayar/provider/account diam-diam.
- Penggunaan pribadi tidak otomatis menyelesaikan ketentuan subscription. Verifikasi dukungan teknis, entitlement akun, permission provider, dan keselamatan produksi sebagai kesimpulan terpisah.

## 9. Memory awal

- Local-only, tanpa cloud sync/team sharing.
- Satu capture producer per execution: extension OMP ATAU aplikasi, bukan keduanya.
- Pisahkan project memory dan preferensi personal; lintas project tidak otomatis.
- Jangan memberi akses seluruh vault Obsidian pribadi.
- Mulai tanpa LLM consolidation atau embedding eksternal.
- Jangan menggunakan ulang token OMP untuk ai-memory.
- Memory bisa salah/usang dan mengandung prompt injection; bukan otoritas di atas pengguna/fakta repo.
- Recall ke prompt mengirim catatan ke provider aktif meskipun storage lokal.
- Hapus file tidak otomatis menghapus Git history/backup/observasi; gunakan semantics purge resmi.
- Failure memory harus terlihat. Mode degradasi memory tidak boleh mengubah approval menjadi fail-open.

## 10. Scope plan

Draft plan saat ini memiliki 6 task:
1. Resolve kontrak launch/auth/discovery/tool restriction sebelum runtime.
2. Bounded protocol transport dan turn reconstruction.
3. Private process launch, login engine-managed, approval.
4. Stop/shutdown dan status kegagalan yang observable.
5. Baseline diff, bukti tes, reopen tanpa replay.
6. Real acceptance di macOS M1 dan verdict.

Usulan harness: Python standard library + unittest sebagai alat PoC sementara. Ini bukan dependensi produk SwiftUI yang sudah diputuskan.

Jangan mengarang upstream flags, endpoint, event atau signature SDK. Interface host boleh dirancang dan harus diberi label demikian. Unknown upstream contract menjadi discovery task dengan output terukur.

Acceptance mencakup:
- Login/model/inference nyata yang diizinkan.
- Approve dan deny dengan pemeriksaan efek file benign.
- UI loss saat menunggu approval.
- Stop streaming/tool/test dengan child/grandchild dan queued work.
- Crash setelah efek file lalu reopen tanpa replay.
- Dirty baseline dan concurrent edits.
- Shutdown drain, persistence failure, unsupported model/version.

Test double harus berlabel synthetic/mock; bukan bukti OMP. Expected output bukan actual result. Skenario yang tidak dijalankan ditulis NOT-RUN, bukan PASS.

Roadmap saja untuk ai-memory, provider tambahan, SwiftUI, runtime bundling/update, dan .app/.dmg/signing. Jangan merinci implementasi fase yang bergantung pada PoC belum lulus.

## 11. Non-goals

Tunda multi-engine, multi-agent paralel, web/remote, multi-user, marketplace, auto-merge/deploy, memory cloud, multi-device sync, vector tambahan, Intel/Universal, dan auto-update.

## 12. Deliverable dan batas izin

Sesi planning/review boleh:
- Inspeksi read-only repo/source/network.
- Membaca draft yang ada dan memperbarui dokumen planning relevan.
- Menyatakan rekomendasi kecil secara eksplisit, bukan sebagai keputusan pengguna.

Tidak boleh tanpa izin terpisah:
- Menulis kode produk/harness implementasi.
- Mengubah config runtime atau repo lain.
- Menginstal runtime/dependensi/Xcode.
- Membaca kredensial, memulai OAuth atau inference.
- Commit atau push.

Ikuti konvensi repo, gunakan `docs/superpowers/` untuk draft yang sudah ada. Pakai tanggal sistem aktual untuk riset baru. Pertahankan status DRAFT sampai disetujui.

Akhiri dengan:
1. Dokumen yang diperbarui.
2. Temuan utama dan blocker.
3. Yang sudah/belum diverifikasi.
4. Keputusan pengguna yang benar-benar dibutuhkan.
5. Permintaan review sebelum implementasi.

Jangan mengulang pertanyaan yang sudah terjawab: target M1/arm64, macOS 27.2 dilaporkan pengguna, Xcode belum terpasang, rekomendasi Xcode 27.1 diterima. Jika informasi teknis live berbeda, jelaskan bukti dan dampaknya.

Mulai dengan membaca kondisi aktual dan draft yang sudah ada, bukan scaffolding atau membuat plan duplikat.
