# Engine feasibility review

Status: DRAFT. Pemeriksaan read-only 2026-10-23, tanpa instalasi, login, inference atau runtime agent. Tidak membaca credential store. Environment: Linux.

## Repo lokal

`git status --short --branch`: `No commits yet on main...origin/main [gone]`. Repo belum memiliki commit; tidak menyimpulkan keadaan server dari label tracking lokal. `git remote -v` mengarah ke `https://github.com/julianreza/neiro.git`. File discovery hanya menemukan metadata `.git`; tidak ada instruksi ancestor AGENTS.md yang ditemukan. `git log -1` gagal karena belum ada commit, bukan bukti error produk.

## OMP baseline

GitHub API `/repos/can1357/oh-my-pi/releases/latest` mengembalikan `v18.12.6`, published `2026-10-21T21:02:53Z`. Tag dipetakan melalui commits API ke `45c35e40c46166dc726ccc52f5d27f40f2449f99`.

Semua URL OMP berikut dipin ke commit tersebut:

- [RPC](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/docs/rpc.md)
- [SDK](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/docs/sdk.md)
- [Approval mode](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/docs/approval-mode.md)
- [Approval resolver](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/coding-agent/src/tools/approval.ts)
- [ACP additional gate](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/coding-agent/src/session/acp-permission-gate.ts)
- [RPC dispatcher](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [Session implementation](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/coding-agent/src/session/agent-session.ts)
- [Codex OAuth](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/ai/src/registry/oauth/openai-codex.ts)
- [Installer](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/scripts/install.sh)
- [License](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/LICENSE)

### Terverifikasi dari dokumentasi/source

- JSONL custom stdio. Ready frame, request ids, response/event families, protocol v2 chunking dengan physical frame 1 MiB dan logical reassembly 64 MiB didokumentasikan. Batas mengikuti ready/version, bukan asumsi global selamanya.
- `get_login_providers`, `login`, `get_available_models`, `set_model`, `prompt`, `abort`, `abort_bash`, `get_state`, dan operasi sesi didokumentasikan.
- Login mengirim open_url, notify, dan input non-secret sesuai batas protokol. Secret input ditolak. Tidak ada jaminan semua provider login melalui RPC.
- `prompt` response adalah admission. `prompt_result` membedakan completed/aborted/error; sessionSettled dan session_settled menunjukkan quiescence. Agent_end tidak cukup.
- Dispatcher `abort` menunggu session.abort; RPC bash mempunyai abortBash terpisah. Ini bukti jalur kode, bukan bukti semua child process berhenti.
- EOF stdin menolak pending UI dan memulai teardown/drain. Client harus terus membaca stdout agar exit tidak tertahan. Persistence failure dapat menghasilkan notice dan exit nonzero.
- Approval umum memiliki tier read/write/exec dan mode always-ask, always-ask-cached, write, yolo. Default terdokumentasi yolo.
- always-ask mengizinkan read dan meminta approval write/exec, tetapi tool policy eksplisit bisa mengubah resolusi; per-tool prompt dan tool inventory tetap perlu diaudit.
- Unknown approval tier default exec. Generic approval tersedia pada RPC via select. Tidak adanya interactive UI menyebabkan required prompt gagal, bukan auto-allow.
- ACP additional gate untuk bash/destructive edit tidak mewakili keseluruhan sistem approval. Review awal yang hanya memakai gate ini terlalu sempit.
- SDK `toolNames` sendiri BUKAN allowlist. `restrictToolNames: true` membatasi tools dan menonaktifkan discovery ambient tertentu; kontrak CLI setara belum diverifikasi.
- SDK secara default dapat menemukan config, context files, extension, custom commands, dan MCP. Karena itu private directory saja tidak membuktikan project/ambient config tidak dimuat.
- Installer mempunyai cabang Darwin dan arm64, termasuk deteksi Rosetta. Ini bukan uji binary di Mac atau notarization.
- MIT mengatur source engine, bukan ketentuan layanan subscription.

### Belum terbukti / blocker sebelum live

1. Provider-use assessment untuk penggunaan baru ini; tidak ada legal clearance yang disimpulkan.
2. Private engine state dan credential discovery yang tidak menyentuh auth personal.
3. CLI flags/config untuk inventory minimum dan pencegahan ambient executable loading. Jika tidak cukup, pertimbangkan SDK bridge sebagai perubahan desain, bukan fallback diam-diam.
4. Account/model entitlement dan login/inference nyata.
5. Round-trip approval, cancellation saat disconnect, dan efek file yang benar-benar ditolak.
6. Stop mencakup child/grandchild, detached processes, retry/queued work dan late result di macOS.
7. Crash/resume tanpa re-execution efek.
8. Packaging/signing/notarization dan peluncuran Finder.

Tidak ada kandidat dinyatakan tidak layak secara final dari bukti saat ini. OMP layak diteruskan ke PoC bersyarat; belum layak diberi label aman/produksi.

## ai-memory baseline untuk roadmap

Tag v3.2.2 dipetakan ke `a387263c7c898fa3bce74dde035c90548a96b468` lewat API.

[Support matrix dipin](https://github.com/akitaonrails/ai-memory/blob/a387263c7c898fa3bce74dde035c90548a96b468/docs/support-matrix.md) menyebut:
- OMP: native MCP configuration + TypeScript extension yang menegakkan capture exclusions.
- macOS: native aarch64/x86_64 release tarball dan launchd support.
- Hermes: integrasi dimodelkan dari source v0.22.2 dan belum end-to-end oleh maintainers. Label Supported bukan bukti semua integrasi sama matang.

README dan dokumen main pada riset sebelumnya menjelaskan wiki Markdown/Git, derived indexing, zero-LLM default, sanitizer best-effort, satu producer capture, dan purge/retention. Klaim rinci tersebut perlu dipastikan ulang pada rilis yang akan dipakai sebelum plan memory; jangan menganggap seluruh dokumentasi main sama dengan v3.2.2. Belum ada compatibility test OMP v18.12.6 + ai-memory v3.2.2 dalam RPC.

## Verdict

- OMP: PARTIAL — kontrak relevan terdokumentasi; keamanan/lifecycle/live auth belum diuji.
- ai-memory: kandidat roadmap; tidak menjadi dependensi PoC pertama.
- Klaim runtime yang terverifikasi dalam sesi ini: TIDAK ADA.
- Perubahan sesi ini: dokumen planning saja; tanpa commit/push.
