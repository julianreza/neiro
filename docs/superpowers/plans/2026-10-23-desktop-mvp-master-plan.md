# Desktop Coding Agent — MVP Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** DRAFT MENUNGGU PERSETUJUAN IMPLEMENTASI. Ini plan membangun aplikasi sampai MVP, BUKAN plan review dokumen. Semua checkbox belum dikerjakan.

**Goal:** Menghasilkan aplikasi SwiftUI pribadi yang berjalan di MacBook M1: login engine-managed, pilih project/model, chat streaming, approval, Stop, diff/bukti tes, lanjut sesi, memory project lokal, dan paket .app/.dmg.

**Architecture:** SwiftUI menggunakan adapter OMP dengan proses lokal dan event terstruktur. OMP memiliki kredensial/agent loop/sesi; aplikasi memiliki UI, lifecycle dan referensi sesi; ai-memory memiliki pengetahuan lintas sesi. Tidak ada agent loop tambahan atau adapter multi-engine.

**Tech Stack:** Swift/SwiftUI, Foundation Process dan concurrency, XCTest, Xcode project + local Swift package, OMP dipin, ai-memory dipin, Git dan tool packaging macOS. Python harness pada plan PoC lama adalah opsional throwaway, bukan prasyarat universal atau runtime produk.

**Spec:** `../specs/2026-10-23-omp-desktop-design.md`
**Evidence:** `../research/2026-10-23-engine-feasibility.md`
**Supporting checklist:** `2026-10-23-omp-poc-plan.md` — checklist skenario PoC, bukan master plan terpisah yang harus diikuti seluruh struktur Python-nya.

## Global Constraints

- Pribadi, lokal, satu sesi aktif, satu engine OMP. Tanpa React/Electron.
- Target uji MacBook M1 arm64, macOS 27.2 menurut pengguna. Xcode belum terpasang; rekomendasi awal Xcode 27.1 perlu dicek kompatibilitas sebelum instalasi.
- Deployment target usulan macOS 15.0; tidak berarti dukungan macOS 15 sudah teruji. Jangan mengklaim versi minimum engine tanpa verifikasi.
- Nama internal sementara `NeiroDesktop`, bukan keputusan merek. Bundle identifier development harus dipilih eksplisit saat penyiapan build, jangan mengasumsikan kepemilikan domain.
- ChatGPT subscription dahulu. Claude/Antigravity/API key milestone tambahan terpisah; jangan menjanjikan dukungan subscription sebelum assessment dan live test.
- Engine memiliki token; UI tidak membaca/menyalin token provider. API-key entry harus menggunakan jalur engine-owned yang terverifikasi; jangan membuat credential store UI kedua.
- Tidak ada TUI keyboard automation, auto-approve/yolo, destructive Git cleanup, auto-merge/deploy, fallback berbayar diam-diam, atau memory lintas project otomatis.
- Memilih folder, private data directory, approval dan subprocess BUKAN sandbox OS.
- Install, OAuth/inference dan tindakan pada akun/mesin pengguna memerlukan izin yang jelas. Tidak ada commit/push tanpa izin. Persetujuan master plan mengizinkan implementasi yang disepakati, bukan semua efek eksternal tanpa batas.
- Perubahan dokumen sekarang tidak merupakan hasil build/test. Semua command/result di bawah EXPECTED sampai benar-benar dijalankan.

## Stop planning loop

Sesudah satu persetujuan master plan, implementer mulai task yang bisa dieksekusi; JANGAN membuat plan review handoff baru. Untuk unknown upstream: selesaikan discovery di task pemiliknya, catat keputusan kontrak ringkas, lalu lanjut. Minta keputusan hanya untuk blocker yang mengubah engine, keamanan, autentikasi, scope atau biaya. Kegagalan runtime tidak menghapus task aplikasi lain yang independen.

## Definisi selesai dan urutan

**MVP-1 / aplikasi coding yang bisa dipakai:** Tasks 1–8 dan 10 lulus, menghasilkan .app/.dmg dengan ChatGPT path nyata, approval/Stop, diff/tes, dan session resume. Memory belum boleh diklaim tersedia jika Task 9 belum lulus.

**MVP lengkap sesuai arah saat ini:** MVP-1 + Task 9 (ai-memory lokal) lulus. Packaging diulang setelah memory disertakan. Provider tambahan Task 11 tidak memblokir MVP ChatGPT, tetapi wajib terverifikasi sebelum dipasarkan sebagai didukung.

Dependensi: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 10. Task 9 setelah 8, lalu ulang Task 10. Task 11 setelah 8; Task 12 menutup milestone yang benar-benar selesai. Shell/UI dapat disiapkan dengan fixtures saat live auth terblokir, tetapi fixtures tidak memenuhi acceptance live.

## Review Focus

1. Byte stream rusak, chunk besar, late event atau request id tertukar tidak menghasilkan completed palsu — Tasks 3/5.
2. Ambient config, auth discovery, runtime tampering atau symlink memperluas akses tanpa sepengetahuan pengguna — Tasks 1/2/6/7.
3. Approval timeout/disconnect/duplicate reply tidak memberi izin — Tasks 4/6.
4. Stop ack tetapi child/queue terus bekerja, crash setelah efek, atau jendela ditutup — Tasks 6/8.
5. Dirty/concurrent edits, memory lintas repo, sensitive output dan deletion history tidak boleh disamarkan — Tasks 7/9/12.

## Struktur file yang diusulkan

Semua file produk berikut masih rencana, bukan kode yang sudah ada:

- `NeiroDesktop.xcodeproj/project.pbxproj` dan shared scheme `NeiroDesktop`: target app dan UI tests.
- `App/NeiroDesktopApp.swift`, `App/RootView.swift`, `App/AppModel.swift`: composition root dan main window.
- `App/Features/Projects/ProjectPickerView.swift`, `Sessions/SessionSidebar.swift`, `Chat/ChatView.swift`, `Chat/ToolActivityView.swift`, `Auth/ProviderLoginView.swift`, `Models/ModelPickerView.swift`, `Approval/ApprovalSheet.swift`, `Changes/ChangesView.swift`, `Tests/TestResultsView.swift`, `Memory/MemoryView.swift`, `Settings/RuntimeSettingsView.swift`.
- `Packages/DesktopCore/Package.swift`, `Sources/DesktopCore/Domain/Models.swift`, `Engine/EngineClient.swift`, `Engine/OMPClient.swift`, `Engine/JSONLDecoder.swift`, `Engine/OMPWireMapper.swift`, `Runtime/RuntimeManager.swift`, `Runtime/ProcessSupervisor.swift`, `Runtime/LaunchPolicy.swift`, `Storage/AppPaths.swift`, `Storage/ProjectStore.swift`, `Storage/SessionIndex.swift`, `Evidence/RepoBaseline.swift`, `Evidence/TestEvidence.swift`, `Memory/MemoryClient.swift`, `Memory/AIMemoryClient.swift`.
- `Packages/DesktopCore/Tests/DesktopCoreTests/`: tests per unit di atas, protocol fixtures berlabel synthetic, fake process/MCP server untuk offline tests.
- `UITests/NeiroDesktopUITests.swift`: UI interactions dengan fake engine terlabel test-only.
- `Config/runtime-manifest.json`: pinned versions/checksums/artifact identity, tidak berisi credentials.
- `scripts/package-app.sh`, `scripts/package-dmg.sh`: packaging lokal repeatable.
- `docs/implementation/omp-contract.md`, `runtime-layout.md`, `acceptance-results.md`, `provider-support.md`, `RUN_ON_MAC.md`: kontrak yang benar-benar diverifikasi dan bukti aktual.

Batas interface host berikut adalah desain aplikasi, BUKAN klaim interface SDK upstream. Buat nama/type di Models.swift agar tidak ada definisi tetangga yang berbeda. `ProjectID`, `SessionID`, `ModelID`, `ApprovalID` adalah host value types; engine ids disimpan terpisah dan opaque.

## Task 1 — Penyiapan Mac dan kontrak runtime minimum

**Files:** `docs/RUN_ON_MAC.md`, `docs/implementation/omp-contract.md`, `Config/runtime-manifest.json`, `LaunchPolicy.swift`, `LaunchPolicyTests.swift` (core package dibuat di Task 2).
**Consumes:** riset OMP dipin dan akses Mac yang diizinkan.
**Produces:** approved LaunchConfiguration: executable URL, private engine directory, project URL, verified argv/settings, allowed inventory, supported version/protocol, unresolved blockers.

- [ ] Periksa repo/instruksi terbaru dan host aktual. Pada Mac, setelah izin, catat `sw_vers`, `uname -m`, `xcodebuild -version`, `xcode-select -p`. Jika Xcode belum ada, berikan jalur instalasi resmi dan lanjutkan pekerjaan source/offline yang memungkinkan; jangan mengklaim instalasi dilakukan oleh agent Linux.
- [ ] Verifikasi versi/toolchain pada dokumentasi Apple, source OMP auth/discovery/config/CLI/approval, dan provenance artifact. Temukan sintaks exact private agentDir dan tool/discovery restriction. `--tools` saja bukan bukti allowlist. Assessment provider terms dicatat terpisah dari implementasi auth; dilarang mengakali penolakan provider.
- [ ] Tulis tes LaunchPolicy yang menolak version mismatch, missing executable, yolo/auto-approve, auth fallback personal, unreviewed executable project config dan ambient tool expansion; jalankan setelah Task 2 menyediakan package (RED → implement → GREEN).
- [ ] Simpan hasil sebagai satu launch contract, bukan plan review baru. Jika CLI tidak memenuhi boundary, ajukan satu keputusan terarah tentang SDK bridge atau containment; jangan diam-diam mengubah engine.

**G1:** konfigurasi launch dibuktikan dari source, batas risiko dinyatakan, tidak ada live task sampai boundary auth/tool cukup untuk fixture. Izin runtime/live diminta saat diperlukan, bukan mengulang persetujuan keseluruhan plan.

## Task 2 — Project SwiftUI yang dapat dibuild dan penyimpanan app

**Files:** Xcode project/shared scheme, App entry/root/model, core Package.swift, Models.swift, AppPaths.swift, ProjectStore.swift dan tests.
**Interfaces:** `AppPaths.applicationSupport() throws -> URL`, `ProjectStore.save(_ project: ProjectRecord) async throws`, `loadProjects() async throws -> [ProjectRecord]`. Core state enums memisahkan engine process, prompt result, session settlement dan approval.

- [ ] Buat package Swift dan app target native dengan minimum usulan macOS 15.0, arm64, development bundle id eksplisit. Swift package tidak memakai runtime Python. Buat app shell sidebar/content/inspector sederhana; fokus fungsi, bukan redesign besar.
- [ ] Tulis XCTest untuk paths app-private, store round-trip/corrupt record, Unicode/spaces dan stable project identity. RED dahulu; implement minimum lalu GREEN. Project path bukan credential directory.
- [ ] `swift test --package-path Packages/DesktopCore`; expected PASS. `xcodebuild -project NeiroDesktop.xcodeproj -scheme NeiroDesktop -configuration Debug -destination 'platform=macOS,arch=arm64' -derivedDataPath .build/xcode build`; expected BUILD SUCCEEDED pada Mac, catat signing requirements aktual.
- [ ] Jalankan app shell di Mac dan verifikasi buka/tutup normal, state kosong dan error store terlihat. Tambahkan .gitignore untuk build/run artifacts tanpa mengabaikan source.

**Acceptance:** ada app native runnable dan unit test package, bukan hanya mockup atau scaffolding yang belum dibuild. Build di Linux tidak dianggap memenuhi acceptance.

## Task 3 — OMP adapter Swift dan protocol PoC di dalam fondasi produk

**Files:** EngineClient.swift, OMPClient.swift, JSONLDecoder.swift, OMPWireMapper.swift, ProcessSupervisor.swift dan tests/fixtures; update omp-contract.md.
**Interfaces:** `protocol EngineClient: Sendable` menyediakan `events() -> AsyncStream<EngineEvent>`, `start(configuration: LaunchConfiguration) async throws`, `availableModels() async throws -> [ModelRecord]`, `sendPrompt(session: SessionID, text: String) async throws -> RequestID`, `shutdown() async`. Domain event memuat source session/request generation. Signature login/session/approval/stop ditambahkan pada task pemilik di bawah.

- [ ] Gunakan skenario protocol dari plan PoC lama, port langsung ke XCTest agar tidak menulis dua harness lengkap. Python dipakai hanya jika satu probe kontrak lebih murah dan dibuang, bukan mandatory gate.
- [ ] Tulis RED tests untuk partial UTF-8/JSONL, newline framing, ready/version negotiation, v2 chunks invalid/oversize/interleaved, stderr isolation, out-of-order ids, unknown event dan EOF. Add request admission != prompt completion != settled tests.
- [ ] Implement actor-based adapter/decoder, continuous stdout+stderr drain, bounded buffer dan host-only mapping. Gunakan wire names persis dari pinned source; unknown contract harus error eksplisit.
- [ ] Run full core suite GREEN. Setelah izin runtime, jalankan real OMP version/ready/state smoke tanpa inference pada private fixture; catat actual protocol dan tool inventory. Fixture tests tidak menjadi bukti live.

**G2:** adapter dapat berbicara structured RPC nyata; jika belum, shell UI bisa tetap maju dengan fake engine terlabel, tetapi fitur live belum lulus.

## Task 4 — Login provider dan model picker

**Files:** ProviderLoginView.swift, ModelPickerView.swift; extend OMPClient/EngineClient/Models dan auth tests.
**Interfaces:** `login(provider: ProviderID) async throws`, `cancelLogin() async throws`, `selectModel(_ model: ModelID, session: SessionID) async throws`. Adapter memetakan metode exact upstream hasil discovery, tidak menebak nama command cancel.

- [ ] Tulis tests login state/cancel/failure, URL scheme validation, no shell execution from URL, secret/log redaction dan unavailable model. Engine-only credential ownership; tidak ada parser auth.json.
- [ ] Implement user-triggered browser open, progress/status dan model discovery. Auth URL transient, tidak disimpan ke evidence. Jika API key membutuhkan secret RPC yang tidak didukung, tampilkan limitation dan catat Task 11; jangan menambahkan UI credential store.
- [ ] Jalankan core tests dan UI tests login dengan fake engine. Setelah izin login dan satu inference benign, uji ChatGPT nyata pada akun pengguna; jangan otomatis beralih API key jika subscription gagal.

**G3:** provider/model nyata tersedia dan inference consented bekerja. Refresh hanya dilaporkan teruji jika benar-benar diamati; auth-expired UI boleh diuji simulated dengan label.

## Task 5 — Project picker, chat streaming dan aktivitas tool

**Files:** ProjectPickerView.swift, ChatView.swift, ToolActivityView.swift, AppModel.swift, ProjectStore; presentation tests dan UITests.
**Interfaces:** `@MainActor AppModel.openProject(_ url: URL) async throws`, `submit(_ text: String) async`, `selectSession(_ id: SessionID) async`; ChatItem memiliki text/tool/error kind dan stable identity.

- [ ] Tulis tests project not selected, empty task, invalid/deleted directory, Unicode/spaces, duplicate send, late events dari sesi lama dan burst streaming. UI update main actor, tidak memblokir scrolling/input.
- [ ] Implement NSOpenPanel folder picker, daftar project, model aktif, composer, transcript stream dan tool status/output. Tidak meminta Full Disk Access sebagai default; jika sandbox dipilih, bookmark/security scope harus benar dan subprocess access diuji, bukan diasumsikan.
- [ ] UI tests pilih fixture → kirim tugas → lihat partial text/tool/result; error/reconnect terlihat, prompt accepted tidak menampilkan finished palsu. Live smoke pada fixture dengan provider Task 4.

**Acceptance:** pengguna benar-benar memberi tugas lewat window SwiftUI dan melihat streaming nyata. Ini vertical slice produk pertama, bukan demo console saja.

## Task 6 — Approval dan Stop end-to-end dari UI

**Files:** ApprovalSheet.swift, AppModel.swift, ProcessSupervisor.swift, OMPClient.swift dan approval/lifecycle/UI tests.
**Interfaces:** `respond(to approval: ApprovalID, decision: ApprovalDecision) async throws`, `stop(session: SessionID) async throws -> StopReport`. Decision allowOnce/deny; StopReport mengandung requested/confirmed/unverified beserta owned-process observations, bukan bool sukses semata.

- [ ] Tulis RED tests deny/cancel/timeout/window close/disconnect/duplicate/late answer, unsupported UI method dan exact-option mapping. Tidak pernah memilih opsi pertama atau grants luas secara otomatis.
- [ ] Implement sheet dengan tool/command/path scope yang terlihat, allow once/deny, approval id/session generation binding. `always-ask` dan explicit tool prompt dipasang lewat contract; eval/subagent tidak diaktifkan untuk melewati gate.
- [ ] Tulis/implement tests Stop streaming/pending approval/tool-active, pending queue, natural completion race dan process tree. Usulan deadline 10 detik cancel, TERM owned process group lalu 5 detik ke KILL; tunjukkan kapan persistence mungkin hilang.
- [ ] Jalankan core/UI tests. Live Mac: deny marker write/shell memastikan efek tidak terjadi; Stop benign long test + child/grandchild dan cek heartbeat/process cessation. Abort ack tanpa bukti bukan stopped. Escaped process menghasilkan unverified dan blok tugas baru.

**G4:** approval dan Stop bekerja pada aksi nyata dari UI untuk threat model yang disepakati. Jika boundary gagal, hentikan live use repo nyata, bukan seluruh pembangunan offline/UI yang independen. Tidak ada klaim sandbox umum.

## Task 7 — Diff dan bukti hasil tes

**Files:** RepoBaseline.swift, TestEvidence.swift, ChangesView.swift, TestResultsView.swift dan tests.
**Interfaces:** `RepoBaseline.capture(project: URL) async throws -> Baseline`, `changes(since: Baseline) async throws -> ChangeReport`; `TestEvidence` berisi command/cwd/exitCode/output/status/origin, status pass/fail/cancelled/notRun/unknown. Evidence parsing berasal dari tool schema yang terverifikasi; ambiguous shell output tidak boleh diterka sebagai structured result.

- [ ] Tulis tests staged+unstaged+untracked baseline, binary/deleted file, symlink, paths spaces/Unicode, concurrent edits dan Git command failures. Tidak ada reset/stash/checkout/clean.
- [ ] Implement baseline/delta view, file list dan text diff; binary ditandai tanpa memaksa text decoder. Pengguna dapat membuka file; tidak ada apply/revert otomatis pada MVP.
- [ ] Implement tool-backed test evidence; command tidak dijalankan kembali hanya untuk mengisi panel. Pipeline/ambiguous invocation diberi unknown jika exit status tidak membuktikan tes. Output disaring untuk storage; model prose bukan evidence.
- [ ] Full tests GREEN; live task memperbaiki fungsi fixture dengan tes gagal lalu pass, lihat diff dan command/exit/output aktual. Dirty fixture tetap mempertahankan perubahan awal. Concurrent edit menghasilkan atribusi terbatas/ambiguous.

**Acceptance:** pengguna menilai perubahan dan tes lewat UI berdasarkan bukti, bukan ringkasan model saja.

## Task 8 — Session persistence, crash recovery dan app lifecycle

**Files:** SessionSidebar.swift, SessionIndex.swift, AppModel/OMPClient/ProcessSupervisor; persistence/lifecycle tests.
**Interfaces:** `createSession(project: ProjectID, model: ModelID) async throws -> SessionID`, `resumeSession(_ id: SessionID) async throws`, `SessionIndex.upsert(_ reference: SessionReference) async throws`. Reference menyimpan engine opaque id/path yang tervalidasi dan project association, bukan transcript/token salinan.

- [ ] Tests create/save/relaunch/resume, stale/corrupt/deleted reference, cross-project mismatch, crash after file effect dan storage failure. Resume tidak otomatis send prompt/tool.
- [ ] Implement sidebar sesi per project, history loading melalui engine, process errors/persistence notice dan close-window/quit handling. Pengguna diberi pilihan Stop saat pekerjaan aktif; jangan menyamakan close window dengan detach sukses tanpa kebijakan.
- [ ] UI relaunch test dan live Mac reopen sesi setelah task; lalu force crash setelah marker action dan pastikan tidak replay. Periksa engine notice dan file disk aktual, bukan UI saja.

**G5:** aplikasi coding dasar dapat dipakai ulang lintas peluncuran, dengan G3/G4/diff evidence lulus. Selanjutnya app dapat dipaketkan untuk MVP-1 meski memory masih dikerjakan.

## Task 9 — ai-memory lokal terintegrasi dan terlihat di aplikasi

**Files:** MemoryClient.swift, AIMemoryClient.swift, MemoryView.swift, RuntimeManager.swift; memory tests; update manifest/runtime-layout.md.
**Interfaces:** `MemoryClient.health() async throws -> MemoryHealth`, `query(project: ProjectID, text: String) async throws -> [MemoryHit]`, `read(_ id: MemoryPageID) async throws -> MemoryPage`. Write/delete/proposal hanya ditambahkan setelah API/semantics versi dipastikan; jangan mengarang MCP tool schema. Domain record menyimpan scope/source/timestamp, tidak menyamakan note dengan fakta mutlak.

- [ ] Pin ai-memory, verifikasi OMP extension/MCP pada mode RPC dan provenance artifact. Pilih satu capture producer default extension OMP jika kontrak terverifikasi; jangan capture lagi dari UI. Konfigurasikan ulang allowlist untuk extension/MCP memory saja; ulang regresi G4 setelah tool surface berubah.
- [ ] Tulis tests project A/B isolation, exclusion rahasia, duplicate event/retry identity, service outage/restart, no remote embedding/LLM, local auth, unsafe note prompt injection dan output redaction. Gunakan fake MCP berlabel offline sebelum service nyata.
- [ ] Implement service lifecycle, health/degraded indicator, scoped search/read UI. Tentukan startup briefing lewat integrasi engine yang terverifikasi, bukan menyisipkan seluruh vault tiap turn. Satu server per data directory, no broad global setup that rewires personal agents.
- [ ] Buat opsi memory enable/disable per project, lihat sumber catatan, buka wiki yang dipilih; Obsidian tidak wajib. Delete UI hanya jika exact purge/version semantics dapat ditampilkan dengan benar; kalau belum, beri workflow upstream eksplisit tanpa janji permanent delete.
- [ ] Live Mac: sesi pertama menghasilkan pengetahuan benign, sesi kedua recall sumber yang tepat, project lain tidak melihatnya, server down menghasilkan warning tanpa approval fail-open. Uji backup/restore sesuai upstream. Catat memory yang dikirim ke provider.

**G6:** memory terpakai lintas sesi dengan scope/exclusion/failure yang terbukti. Jika gagal, rilis tetap berlabel MVP-1 tanpa memory, bukan mengklaim MVP lengkap.

## Task 10 — Runtime distribution dan .app/.dmg pribadi

**Files:** RuntimeManager.swift, RuntimeSettingsView.swift, AppPaths.swift, runtime-manifest.json, package scripts, runtime-layout.md, RUN_ON_MAC.md.
**Interfaces:** `RuntimeManager.prepare(manifest: RuntimeManifest) async throws -> RuntimeInstallation`, `verify(_ installation: RuntimeInstallation) async throws`, `status() async -> RuntimeStatus`. Download/install hanya dipicu persetujuan, tidak saat test offline.

- [ ] Pilihan awal: installer runtime app-managed dengan explicit download, pin artifact/checksum/provenance, storage app-private di Application Support; user tidak perlu instal CLI manual. Offline use setelah runtime tersedia. Jika redistribution/download upstream tidak cocok, catat blocker dan pilih bundling hanya setelah lisensi/native dependencies diverifikasi.
- [ ] Tests checksum/version mismatch, interrupted download, missing executable/native asset, malicious manifest/path traversal, permission error dan no-network launch after install. Tidak mengeksekusi artifact sebelum verification. Update otomatis ditunda; manual replacement hanya versi diuji, dengan backup/migration policy.
- [ ] Implement settings status/install/repair dan runtime lifecycle tanpa login token handling. Tidak bergantung pada PATH shell developer; engine tetap bisa memakai tool project yang dependensinya ditampilkan jika tidak tersedia.
- [ ] Build Release dan package .app, validasi bundle executable/resources/architecture, launch dari Finder pada Mac dengan CLI pribadi tidak di PATH. Gunakan code signing pengembangan sesuai setup aktual; jangan menyebut ad-hoc sebagai Developer ID/notarized.
- [ ] Buat DMG dengan `hdiutil create` dari staging yang hanya berisi app/shortcut yang dimaksud; script menolak overwrite artifact target tanpa izin. Mount → copy app → launch → real task/reopen; ulang setelah ai-memory diaktifkan.
- [ ] Jika ingin distribusi ke mesin lain, tambahkan Developer ID signing/notarization/stapling sebagai gate terpisah. Untuk private MVP tidak membuat klaim Gatekeeper compatibility luas.

**G7:** .app dan .dmg benar-benar dihasilkan dan diuji di Mac M1. Build toolchain bukan runtime requirement aplikasi; pengguna tidak perlu Python harness atau manual engine CLI untuk memakai paket setelah app-managed setup.

## Task 11 — Provider tambahan sebagai milestone eksplisit

**Files:** provider-support.md, auth/model UI tests, engine mapper hanya jika upstream memerlukannya.
**Consumes:** G3/G4/G5. Tidak membuat adapter OAuth provider sendiri.

- [ ] Untuk Claude subscription, Antigravity subscription dan satu API-key provider: catat exact version/method, ketentuan, account entitlement, login/cancel/re-auth, model discovery dan inference. API key tidak membuktikan subscription.
- [ ] Default UI daftar hanya auth methods yang tersedia/terverifikasi; unsupported ditandai, bukan fake option. API key diserahkan melalui jalur engine-owned yang aman; jika CLI secret input tidak didukung, cari SDK/engine auth surface resmi yang tidak membuat app membaca token. Jangan mengakali dengan TUI simulation.
- [ ] Tests model/provider switch saat idle dan ditolak saat busy, no hidden cost fallback, old event generation isolation, context/memory disclosure saat pindah provider.
- [ ] Jalankan satu task/diff/test dan Stop pada masing-masing jalur nyata yang diizinkan. Status per provider: verified/partial/unsupported/not-tested, dengan bukti. Provider terblokir tidak diam-diam diganti.

**Acceptance:** masing-masing provider dinyatakan supported hanya setelah gate-nya lulus; tidak ada klaim semua target didukung berdasarkan katalog source saja.

## Task 12 — Acceptance final, dokumentasi penggunaan dan penutupan

**Files:** acceptance-results.md, RUN_ON_MAC.md, README.md, provider-support.md.

- [ ] Run `swift test --package-path Packages/DesktopCore` dan `xcodebuild -project NeiroDesktop.xcodeproj -scheme NeiroDesktop -destination 'platform=macOS,arch=arm64' -derivedDataPath .build/xcode test`; UI test target wajib terdaftar di shared scheme. Expected PASS hanya menjadi actual setelah output dibaca.
- [ ] Jalankan dari .app hasil DMG: setup runtime → login → model → pilih repo → task → deny/approve → stream → diff/tes → Stop → quit/reopen. Uji error network/auth/model/runtime/persistence/approval disconnect dan memory outage. Tidak ada acceptance final berdasarkan fake engine saja.
- [ ] Dokumentasikan versi aktual hardware/OS/Xcode/runtime, safe evidence, semua PASS/FAIL/BLOCKED/NOT-RUN, batas sandbox, data retention dan backup. Tidak ada raw secrets atau synthetic API output sebagai bukti live.
- [ ] Tulis panduan pengguna: install app, prepare runtime, login, pilih repo/model, memberi tugas, approval, Stop bukan rollback, review diff/tes, lanjut sesi, memory/privacy, uninstall/data retention.
- [ ] Review cakupan dan security secara independen jika reviewer tersedia, atau self-review eksplisit jika tidak. Koreksi issue lalu ulang tes terkait; jangan membuat fase review tanpa batas.

**Definition of Done:** MVP-1 memerlukan G1–G5 + G7 + acceptance Task 12 untuk ChatGPT. MVP lengkap memerlukan G6 dan packaging/acceptance ulang. Task 11 menjadi laporan milestone multi-provider terpisah. Semua fitur yang belum diuji diberi label; tidak ada klaim produksional di luar bukti.

## Risiko bersyarat dan cara melanjutkan

- Akses Mac/Xcode belum tersedia: lanjut source/contract/offline/unit tests yang kompatibel; build/UI/live tetap BLOCKED, bukan fabricated pass.
- Approval/discovery CLI gagal: satu ADR singkat untuk pilihan SDK bridge/containment, minta keputusan hanya tentang itu. Jangan mengulang brainstorming seluruh produk.
- Subscription terms/entitlement gagal: stop provider tersebut, jelaskan; perubahan ke API key perlu izin, bukan fallback otomatis.
- ai-memory gagal: ship hanya MVP-1 dengan memory disabled dan status jujur; tidak menghapus scope memory dari target akhir tanpa keputusan.
- Signature upstream belum diketahui: resolve di kontrak task pemilik. Host interfaces di sini boleh dipertajam tanpa mengganti tujuan, tapi update consumer/tests bersama.

## Self-review

Plan ini mencakup project native sampai artifact dan penggunaan, bukan hanya PoC. Security tetap memakai gerbang teknis tetapi tidak menjadi putaran plan-review baru. Task 3 menggunakan checklist PoC lama tanpa mewajibkan dua implementasi Python/Swift. Perubahan memory mengulang approval regression. Deployment minimum, provider tambahan dan release claims tetap bersyarat pada pengujian nyata.
