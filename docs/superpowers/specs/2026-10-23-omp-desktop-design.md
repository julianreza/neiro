# Desktop coding agent macOS — draft design

Status: DRAFT — belum disetujui untuk implementasi.
Tanggal pemeriksaan: 2026-10-23.

## Intent dan kondisi repo

Bangun aplikasi coding agent pribadi di MacBook M1, dengan UI Swift/SwiftUI dan satu engine lokal. Tujuannya menyelesaikan pekerjaan repo lokal sambil mempertahankan konteks, menampilkan bukti perubahan/tes, dan menyediakan kontrol eksekusi yang jujur.

Repo `/home/ubuntu/Project/neiro`, remote `https://github.com/julianreza/neiro.git`, branch `main`, belum memiliki commit. Inspeksi menemukan hanya metadata Git; tidak ada kode, dokumen, atau AGENTS.md pada repo maupun ancestor yang diperiksa. Sebelum penulisan dokumen ini working tree bersih. Ini bukan repo Nail dan tidak ada repo lain yang diubah.

Host pemeriksaan adalah Linux. Target produk adalah MacBook M1 arm64, macOS 27.2 menurut pengguna (belum diverifikasi langsung). Xcode belum terpasang; rekomendasi awal Xcode 27.1 diterima, kompatibilitas perlu diperiksa sebelum instalasi. Minimum deployment usulan macOS 15.0 bukan jaminan kompatibilitas engine. Tidak ada pengujian runtime engine atau build macOS.

## Entry point pembangunan aplikasi

Master implementation plan: `../plans/2026-10-23-desktop-mvp-master-plan.md`. Dokumen tersebut mencakup pembangunan sampai aplikasi SwiftUI, memory, runtime installer dan .app/.dmg. Plan PoC lama hanya checklist validasi engine, bukan pengganti plan produk. Jika urutan atau usulan harness di dokumen ini berbeda, master plan yang lebih baru berlaku: gunakan adapter Swift dan tests produk sebagai PoC bila memungkinkan, tanpa kewajiban membuat harness Python lengkap. Jangan membuat putaran review handoff tambahan.

## Keputusan pengguna

- Penggunaan pribadi dahulu, lokal di MacBook M1.
- Swift + SwiftUI; tanpa React/Electron.
- Satu engine; target provider ChatGPT subscription/Codex, Claude subscription, Antigravity subscription, dan API key.
- Engine memiliki autentikasi, kredensial, dan refresh; aplikasi tidak membaca/menyalin token provider.
- Pengguna memilih repo secara eksplisit.
- Alur: login, model, repo, tugas, approval, progress, diff/tes, Stop, buka ulang sesi.
- Project terpisah dari Nail. Nama produk belum ditentukan; nama repo bukan keputusan merek.
- Arah distribusi .app/.dmg; distribusi publik dan auto-update bukan prioritas PoC.

## Rekomendasi desain, bukan keputusan final

1. OMP v18.12.6 sebagai baseline riset/PoC, dikunci ke commit `45c35e40c46166dc726ccc52f5d27f40f2449f99`. Jangan memperbarui otomatis.
2. PoC pertama memakai satu sesi aktif dan ChatGPT subscription. Provider lain menunggu gerbang kelayakan terpisah.
3. Harness PoC berbasis Python standard library untuk membuktikan kontrak stdio tanpa UI besar. Python bukan dependensi produk macOS yang diputuskan. Kontrak yang lulus kemudian diport ke Swift.
4. Jalur pertama CLI RPC dengan dialog extension aktif. Jangan menambahkan `--no-ui` hanya karena proses tidak memakai TUI. Pilihan final `rpc` versus `rpc-ui` bergantung pada probe approval; pilih yang paling kecil dan terbukti.
5. Gunakan approval `always-ask` serta kebijakan eksplisit `prompt` untuk tool mutasi/exec yang diizinkan; jangan mewarisi default `yolo`. Reads dalam mode ini tidak seluruhnya meminta izin dan tetap bukan sandbox.
6. Batasi tool minimum ke read/search/edit/write/bash. Nonaktifkan eval, task/subagent, browser, computer, remote tools, MCP, auto-QA/advisor, custom command, dan extension ambient untuk PoC. Bentuk konfigurasi CLI yang benar dan cara menonaktifkan discovery wajib diperiksa sebelum runtime; jangan menganggap daftar `--tools` adalah allowlist penuh.
7. Gunakan home/agentDir khusus aplikasi melalui opsi upstream yang diverifikasi, bukan credential store personal. Jangan mengganti HOME secara serampangan atau menyalin kredensial. Folder project tanpa executable config/extension untuk smoke pertama.
8. Tambahkan ai-memory lokal setelah PoC OMP lulus. Obsidian hanya viewer/editor opsional.

## Batas komponen dan data

- Desktop: project selection, chat, model/sesi, approval, visualisasi diff/tes, Stop, lifecycle, metadata UI dan referensi sesi.
- Adapter: framing/protocol negotiation, request correlation, rekonstruksi event, state host, error handling. Tidak membuat agent loop/model retry kedua.
- OMP: auth, model, agent loop, tools, native session persistence. Sumber utama percakapan dan state agent.
- ai-memory fase lanjutan: pengetahuan lintas sesi dan handoff, bukan pengganti sesi native atau permission gate.
- Cache UI/index tidak boleh menjadi satu-satunya salinan bukti atau memory. Prompt cache provider tidak portabel antar-provider dan bukan memory.
- Jangan menyimpan ulang seluruh state engine sebagai database independen. Evidence run menyimpan data minimum yang disetujui, bukan token atau dump OAuth.

## State dan protokol host

State yang dirancang: disconnected, starting, ready, authenticating, running, awaitingApproval, cancelling, idle, failed. Status proses, status prompt, dan settlement harus disimpan terpisah; late event tidak boleh mengubah hasil sesi lain.

OMP menggunakan JSONL custom, bukan JSON-RPC 2.0. Tangani partial/coalesced byte reads, UTF-8, request id, stderr terpisah, ready frame, v2 chunking, batas frame, dan EOF. Input malformed atau unknown event tidak boleh disalahartikan sebagai sukses.

`prompt` success hanya admission. Gunakan `prompt_result` untuk hasil prompt dan `session_settled`/state yang sesuai untuk quiescence. `agent_end` sendiri tidak membuktikan selesai. Di luar kontrak versi yang diuji, fail explicitly rather than silently guess.

## Keamanan dan failure contract

### Approval dan eksekusi

- Penolakan/cancel/timeout/EOF approval tidak mengizinkan aksi yang ditolak.
- Jangan menyediakan auto-approve atau session-wide grants dalam harness awal. Jawab pilihan upstream persis berdasarkan payload dan daftar pilihan yang diverifikasi, bukan token UI buatan.
- Approval umum berbeda dari gate ACP tambahan. Gate ACP yang hanya menahan operasi tertentu tidak menggambarkan seluruh kemampuan OMP.
- Approval tidak menjadi containment filesystem/network. Approved bash dapat membaca/mengubah data atau mengakses jaringan. Tidak ada janji akses hanya di project tanpa boundary OS yang diuji.
- Merge/deploy/push tidak menjadi fitur PoC. Tool bash membuat larangan semantik tidak dapat dijamin hanya dengan tombol UI; jangan menyebutnya sudah diblokir secara menyeluruh.
- PoC hanya pada repo contoh dan akun/lingkungan yang risikonya diterima secara eksplisit. Jangan mengklaim scrub environment atau repo contoh sebagai sandbox.
- Unknown/ambient executable config, tool atau child process harus diselidiki sebelum inference. Jika discovery tidak dapat dibatasi, hentikan jalur live sampai pengguna menilai risikonya.

### Stop dan crash

Stop meminta `abort`; jalur RPC bash eksplisit memiliki `abort_bash` tersendiri. Jangan menganggap keduanya identik. Tolak admission baru di host saat cancelling. Penanganan antrean engine harus diperiksa; jika abort dapat menyisakan pekerjaan yang akan berjalan kembali, batalkan dan hentikan runtime sesuai kontrak yang diuji.

Usulan deadline host: 10 detik menunggu pembatalan, 5 detik setelah TERM sebelum KILL pada process group yang dimiliki harness. Angka ini kebijakan PoC, bukan jaminan upstream. Tetap konsumsi stdout selama shutdown. Jangan membunuh proses berdasarkan nama global atau menyentuh proses personal.

Status success Stop memerlukan verifikasi proses/efek uji, bukan sekadar response abort. Jika keturunan escaped/detached tidak dapat dipastikan berhenti, laporkan stop-unverified dan blok tugas baru; containment kuat menjadi blocker sebelum repo nyata. Stop bukan rollback. Crash/force-kill dapat meninggalkan state tidak tersimpan; buka riwayat tanpa replay otomatis tool.

### Diff dan tes

Fixture awal bersih, lalu skenario terpisah dengan staged, unstaged, dan untracked preexisting. Simpan baseline, termasuk konten untracked yang relevan, bukan hanya `git diff HEAD`. Bukti memisahkan baseline dari delta tugas. Jika pengguna mengedit bersamaan, atribusi ambiguous harus terlihat. Tidak ada stash/reset/checkout/clean otomatis.

Tes membutuhkan command, cwd, exit code, output dan label pass/fail/cancelled/not-run. Model prose bukan bukti tes. Jangan mempersist output mentah sensitif secara default. Latihan marker-file benign membuktikan aksi ditolak tidak terjadi; ini bukan bukti keamanan terhadap arbitrary code.

### Auth dan provider

Discover provider id dan model lewat engine, jangan meng-hardcode katalog. Buka URL OAuth yang disediakan engine melalui browser dengan persetujuan pengguna; jangan mengeksekusi URL sebagai shell. Engine menyimpan/refresh token. Jangan log isi login frame mentah, token, atau URL OAuth ke evidence. RPC tidak mendukung secret input; jika alur membutuhkannya, tandai blocker, jangan pakai TUI automation.

Dukungan implementasi OAuth tidak membuktikan account entitlement, compatibility live atau permission provider. Pemeriksaan ketentuan saat ini masih terbuka. Tidak ada janji dukungan semua subscription. Jangan mengakali penolakan provider. Perubahan ke provider lain memerlukan persetujuan dan penilaian data yang dikirim.

## Memory fase berikutnya

ai-memory v3.2.2 dipetakan ke commit `a387263c7c898fa3bce74dde035c90548a96b468` untuk riset; bukan baseline integrasi yang sudah diuji.

- Local-only, satu server per data directory; autentikasi lokal tetap diperlukan jika HTTP dipakai.
- Satu producer capture per execution: extension OMP atau relay aplikasi, tidak keduanya.
- Pengetahuan project terpisah; preferensi global opt-in. Wiki/viewer bukan trusted instructions.
- Tanpa LLM consolidation/embedding eksternal atau credential reuse OMP pada awal.
- Sanitizer best-effort; capture scope dan exclusion diuji, bukan diasumsikan.
- Memory failure terlihat; coding boleh lanjut hanya dalam mode degradasi yang disetujui. Approval failure tidak boleh fail-open.
- Isi yang direcall ke prompt dikirim ke provider aktif. Hapus file bukan bukti purge Git/backup/database.

## Non-goals dan anti-goals

Tunda multi-engine, multi-agent paralel, remote/web, team, auto-merge/deploy, marketplace, memory cloud, vector tambahan, Intel/Universal, dan update otomatis.

Gagal secara desain bila aplikasi menjanjikan containment palsu, membaca token, mencampur proyek, merusak perubahan pengguna, menyamakan admission dengan completion, atau menyatakan uji lulus tanpa eksekusi.

## Gerbang dan roadmap

G0: persetujuan design/plan + host macOS/Xcode diketahui + provider-use assessment + konfigurasi tool/data/discovery terverifikasi. G1: protocol/offline contract tests lulus. G2: login dan live inference disetujui dan bekerja. G3: approval/Stop/session/file evidence lulus di macOS M1. Hanya setelah itu mempertimbangkan penggunaan repo nyata.

Setelah G3: PoC ai-memory scoped/failure → SwiftUI minimum → Claude/Antigravity/API key masing-masing diuji → bundling/update dan packaging. Jika OMP gagal, buat ADR blocker dahulu; jangan otomatis membangun engine fallback.

## Yang belum dapat diputuskan

- macOS/Xcode terpasang dan akses pengujian pada Mac (wajib sebelum eksekusi Mac).
- Ketentuan provider untuk login subscription aplikasi baru ini.
- Opsi CLI tepat untuk private agentDir, discovery/config restrictions dan tool inventory; SDK bridge fallback jika CLI tidak cukup, tetapi perlu keputusan desain baru.
- Child process cancellation guarantees di macOS dan kebutuhan containment untuk penggunaan repo nyata.
- Metode bundling/update runtime, Bundle Identifier, nama produk, target minimum macOS; bukan blocker untuk review source atau roadmap.

## Bukti dan review

Lihat `../research/2026-10-23-engine-feasibility.md` untuk sumber dipin dan batas verifikasi. Review mandiri sebagai builder: initial review terlalu menekankan gate ACP; telah diperbaiki memakai sistem approval umum. Runtime, private data isolation dan Stop tetap belum terbukti, sehingga plan memakai task discovery dan gerbang tanpa membuat signature upstream fiktif.
