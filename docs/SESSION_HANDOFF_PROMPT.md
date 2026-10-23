# Prompt handoff — membangun aplikasi desktop macOS sampai MVP

Salin instruksi berikut ke sesi baru, atau minta agent membaca file ini.

---

Tujuan saya adalah MEMBANGUN APLIKASI CODING AGENT MACOS SAMPAI MVP BISA DIPAKAI, bukan membuat plan review handoff lagi.

## Baca konteks yang sudah ada

Repo: `/home/ubuntu/Project/neiro`
Remote: `https://github.com/julianreza/neiro.git`

Baca instruksi repo yang berlaku dan status Git terbaru, lalu:
1. **MASTER PLAN:** `docs/superpowers/plans/2026-10-23-desktop-mvp-master-plan.md`
2. Design: `docs/superpowers/specs/2026-10-23-omp-desktop-design.md`
3. Riset: `docs/superpowers/research/2026-10-23-engine-feasibility.md`
4. Supporting PoC checklist: `docs/superpowers/plans/2026-10-23-omp-poc-plan.md`

Master plan menjadi entry point dan mengatur urutan pembangunan. PoC lama hanya supporting checklist untuk tahap engine; bukan pengganti plan aplikasi dan tidak wajib menghasilkan harness Python lengkap sebelum SwiftUI.

Jangan membuat dokumen “plan review handoff” atau merencanakan ulang seluruh project. Jika persetujuan implementasi belum tersedia dalam sesi, tampilkan keputusan utama master plan secara singkat dan minta satu persetujuan. Jika sudah disetujui, mulai task pertama yang bisa dijalankan dan simpan progress di master plan. Tidak perlu persetujuan ulang untuk setiap penulisan kode yang sudah masuk scope; tindakan eksternal seperti instalasi, OAuth/inference, commit/push tetap harus sesuai izin eksplisit.

## Keputusan pengguna

- Project baru terpisah dari Nail; jangan mengubah repo lain.
- Penggunaan pribadi, lokal di MacBook M1 arm64.
- macOS 27.2 menurut pengguna, belum diperiksa langsung.
- Xcode belum terpasang; rekomendasi awal Xcode 27.1 diterima. Periksa dokumentasi Apple sebelum instalasi. Minimum deployment usulan macOS 15.0 belum menjadi klaim kompatibilitas runtime.
- Swift + SwiftUI; tanpa React/Electron.
- Nama produk belum ditentukan; NeiroDesktop hanya nama internal sementara.
- OMP satu-satunya kandidat default engine. ChatGPT subscription dahulu; Claude subscription, Antigravity subscription dan API key milestone lanjutan.
- ai-memory lokal untuk pengetahuan lintas sesi; Obsidian opsional, bukan dependensi.
- Target pengalaman: login → model → pilih repo → tugas → approval → stream/tools → diff/tes → Stop → quit/reopen sesi.
- Hasil akhir .app/.dmg untuk dipakai pribadi. Public distribution dan auto-update ditunda.

## Aturan implementasi

- Mulai dari master plan yang sudah ada. Resolve unknown upstream contract di task pemiliknya, bukan membuat fase review baru.
- OMP baseline riset v18.12.6, commit `45c35e40c46166dc726ccc52f5d27f40f2449f99`. ai-memory baseline v3.2.2, commit `a387263c7c898fa3bce74dde035c90548a96b468`. Perubahan versi harus disengaja dan kontraknya diperiksa ulang.
- Source verification tidak sama dengan live execution. Sebelumnya belum ada runtime/login/inference/build macOS yang diuji.
- Jangan mengarang upstream flags/endpoint/event/signature. Interface host pada master plan adalah desain, bukan SDK upstream.
- OMP default approval yolo tidak boleh diwarisi. UI disconnect/deny/cancel/timeout harus fail-closed.
- Prompt accepted != prompt selesai != session settled. Gunakan kontrak settlement yang benar.
- Aplikasi tidak membaca/menyalin token; auth/refresh dimiliki engine. Dukungan source OAuth tidak otomatis membuktikan ketentuan provider atau entitlement akun.
- Folder picker, subprocess, private directory dan approval bukan sandbox. Jangan menjanjikan batas filesystem/network tanpa boundary yang diuji.
- Stop bukan rollback; abort ack tidak membuktikan child process mati. Jangan replay tool otomatis setelah crash.
- Lindungi staged/unstaged/untracked pengguna; tanpa reset/stash/checkout/clean diam-diam. Tes perlu command/cwd/exit/output, bukan klaim model.
- Memory scoped per project, satu capture producer, tanpa cloud/embedding/LLM tambahan/token reuse pada awal. Memory tidak menjadi permission gate atau instruksi tepercaya.
- Host sebelumnya Linux. Verifikasi host sekarang. Offline tests dapat dikerjakan di host yang mendukung; acceptance SwiftUI/runtime wajib di Mac. Jangan laporkan hasil palsu saat Mac belum tersedia.
- Jangan menginstal, OAuth, inference, commit atau push tanpa izin yang relevan. Jangan membaca kredensial atau mengubah repo lain.

## Milestone dan definisi selesai

Master plan mencakup persiapan Mac/kontrak, project SwiftUI runnable, adapter OMP, login/model, project/chat, approval/Stop, diff/tes, sesi/recovery, ai-memory, runtime installer/.app/.dmg, provider tambahan, dan acceptance final.

MVP-1: aplikasi coding ChatGPT nyata sampai .app/.dmg, dengan approval/Stop/diff/tes/resume; memory tidak diklaim jika belum selesai.
MVP lengkap: MVP-1 + ai-memory lokal yang diuji dan packaging ulang.
Provider tambahan dilaporkan per-provider verified/partial/unsupported/not-tested; tidak otomatis memblokir MVP ChatGPT.

Jangan menyatakan seluruh produk selesai hanya karena PoC/protocol tests lulus. Jangan pula menunda semua task produk sampai setiap provider terbukti. Kerjakan bagian independen, catat blocker spesifik, dan minta keputusan hanya bila scope/engine/security/biaya berubah.

Laporan akhir tiap tahap cukup: yang berubah, hasil verifikasi nyata, blocker, dan posisi task berikutnya. Hindari mengulang seluruh proses atau meminta review yang sama berulang kali.
