# Requirements: Integrasi penuh ekosistem Hermes (API Server, Skills/MCP, Bot Mode) di Neiro

## Ringkasan

Neiro sudah memakai Hermes API Server untuk run, sesi, approval, clarify, event SSE, jadwal (baca saja), probe kesehatan, dan manajemen Skills/Add-ons per profil (lewat CLI `hermes`). Spec ini menutup celah yang tersisa: memori lintas misi, pemulihan run `unknown`, pilihan approval lengkap, akuntansi token cache dan model aktual, event subagent/reasoning/commentary, jadwal yang bisa dikelola penuh, probe kapabilitas yang nyata, Bot Mode di `/chat` (forever-chat, @mention, Group Room), bot dua arah dari Telegram/Slack/Discord, dan lampiran gambar.

Aturan dasar: fitur yang sudah ada dan sudah benar dibiarkan. Fitur yang sudah ada tapi kurang lengkap diperbaiki di tempat, bukan ditulis ulang.

## Fakta Hermes yang membatasi spec ini

Dibaca dari kode Hermes terpasang (`~/.hermes/hermes-agent/gateway/platforms/api_server*.py`):

| Fitur | Didukung Hermes | Catatan |
|---|---|---|
| `GET /v1/capabilities` | Ya | Ada `features` dan tabel `endpoints` |
| `GET /v1/skills`, `GET /v1/toolsets` | Ya | Toolset MCP bernama `mcp-<server>` |
| Header `X-Hermes-Session-Key` | Ya | Dipakai untuk memori jangka panjang lintas sesi |
| `model_options` di `POST /v1/runs` | Ya | `reasoning_effort` dan `service_tier`; nilai effort sah: `none, minimal, low, medium, high, xhigh, max, ultra` |
| `skills` / `toolsets` per run di `POST /v1/runs` | **Tidak** | Hermes mengabaikannya. Skills dan toolset berlaku per profil |
| `POST /v1/runs/{id}/resolve-unknown` | Ya | Hanya bila flag `run_unknown_resolution` aktif |
| Pilihan approval | `once`, `session`, `always`, `deny` | `always`/`session` bisa tidak ditawarkan; daftar ada di `choices` event `approval.request` |
| `POST /api/sessions/{id}/fork`, `/chat`, `/chat/stream` | Ya | |
| Event `subagent.start`, `subagent.complete`, `message.interim` | Ya | `message.interim` membawa `already_streamed` |
| Endpoint REST khusus `/compact` | **Tidak** | Kompaksi dipicu sebagai perintah slash di chat sesi |
| `skills` di `POST /api/jobs` | Ya | |

Nama migrasi `20261030000000_*` sudah dipakai (`20261030000000_drop_antigravity_runtime.sql`). Migrasi baru spec ini memakai timestamp yang lebih baru dari migrasi terakhir (`20261030000500_code_review_design.sql`).

## Aturan wajib yang berlaku untuk semua requirement

1. Tidak ada ekspor `dynamic`, `dynamicParams`, `revalidate`, `fetchCache`, `experimental_ppr`, atau `runtime` di `page.tsx`, `layout.tsx`, atau `app/api/**/route.ts`. Handler GET dinamis memanggil `await connection()` atau membaca `request.headers`.
2. Semua tabel baru memakai `ENABLE ROW LEVEL SECURITY` tanpa policy publik, dan hanya dibaca lewat `getSupabaseAdmin()` di server.
3. `SUPABASE_SERVICE_ROLE_KEY`, `HERMES_DEFAULT_KEY`, `key_enc`, token bot, dan secret webhook tidak pernah masuk ke `NEXT_PUBLIC_*` atau respons JSON ke browser.
4. Migrasi lama dan blok `<!-- BEGIN:nextjs-agent-rules -->` di `AGENTS.md` tidak diubah.
5. Kode memakai alias `@/*`, `import type` untuk tipe, kutip ganda, titik koma, indentasi 2 spasi.
6. Semua perubahan UI mengikuti gaya neiro yang sekarang: lebar penuh, neumorphism penuh, warna per bagian, robot `AgentBot` dengan `agentLook(lookRole(a))`.

---

## R1. Skema database

**User story:** Sebagai operator, saya ingin data baru (memori, token cache, kontrol tertunda, subagent, room bot, lampiran) tersimpan permanen agar tampil lagi setelah reload.

**Acceptance criteria**

1. KETIKA migrasi baru dijalankan dua kali, MAKA migrasi selesai tanpa error dan tanpa mengubah data (idempoten: `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, constraint dibuat hanya bila belum ada).
2. Tabel `agents` mendapat: `reasoning_effort` (null atau salah satu nilai effort Hermes), `service_tier` (teks, boleh null), `canonical_session_id` (teks, boleh null), `bot_section` (teks, boleh null), `bot_hidden` (boolean, default false).
3. Tabel `missions` mendapat: `learn_skill_on_done` (boolean, default false) dan `attachments` (JSONB array `{ name, dataUrl }`, default `[]`).
4. Tabel `mission_tasks` mendapat: `cache_read_tokens` dan `cache_write_tokens` (int, default 0), `runtime_provider` dan `runtime_model` (teks), `pending_controls` (JSONB, default `[]`), `admission_id` (teks), `execution_generation` (int), `subagent_runs` (JSONB, default `[]`).
5. Tabel baru `bot_rooms` dan `bot_room_messages` dibuat sesuai kolom di master prompt, dengan `bot_room_messages.room_id` ON DELETE CASCADE dan `sender_agent_id` ON DELETE SET NULL. Jumlah anggota room dibatasi 2 sampai 6 oleh constraint `CHECK`.
6. Kolom yang sudah ada dengan arti sama tidak dibuat ganda. Bila sudah ada kolom yang menyimpan data yang sama (misalnya `session_id` di `mission_tasks`), kolom itu dipakai.
7. `lib/types.ts` dan `lib/orchestrator-store.ts` membaca dan menulis semua kolom baru. Bila kolom belum ada di database (migrasi belum dijalankan), simpan tetap berhasil dengan membuang hanya kolom yang hilang, sama seperti pola di `lib/ask-history.ts`.

## R2. Adapter Hermes lengkap (`lib/hermes.ts`)

**User story:** Sebagai developer, saya ingin satu adapter yang memakai seluruh permukaan API Hermes yang benar-benar ada, agar fitur di atasnya tidak menebak.

**Acceptance criteria**

1. `getHermesServerCapabilities(agent?)` memanggil `GET /v1/capabilities` dan mengembalikan flag fitur dan daftar endpoint. Bila endpoint 404 atau gagal, fungsi mengembalikan objek kosong dengan `available: false`, bukan melempar error.
2. `getHermesDetailedInventory(agent)` mengembalikan `skills: { name, description?, category? }[]` dan `toolsets: { name, label?, description?, enabled?, configured?, tools?, isMcp }[]`, dengan `isMcp` benar bila nama diawali `mcp-`. `listHermesCapabilitiesInventory` tetap mengembalikan daftar nama untuk pemanggil lama.
3. `probeHermesAgent` mengembalikan field terstruktur dari `/health/detailed`: status, keadaan DB, ruang disk, `active_runs`, `pending_completions`, `active_delegations`. Field yang tidak dikirim Hermes bernilai `undefined`.
4. `startHermesRun` menerima `sessionKey`. Bila diisi, header `X-Hermes-Session-Key` dikirim, sudah dibersihkan dari `\r`, `\n`, `\0` dan dipotong ke 256 karakter.
5. `startHermesRun` mengirim `model_options` berisi `reasoning_effort` dan/atau `service_tier` dari input atau dari agen. Bila keduanya kosong, `model_options` tidak dikirim.
6. `startHermesRun` TIDAK mengirim `skills` atau `toolsets` di body, karena Hermes mengabaikannya. Pemilihan skills dan toolset tetap per profil.
7. `startHermesRun` menerima `images` (`{ name?, dataUrl }[]`) dan mengirimnya sebagai input multimodal yang diterima `POST /v1/runs`. Bila profil tidak mendukung gambar, run tetap jalan dengan teks dan satu baris catatan bahwa gambar dilewati.
8. `getHermesRun` mengembalikan juga `cache_read_tokens`, `cache_write_tokens`, `runtime` (`provider`, `model`, `route_source`), dan `shutdown_requested_at`. `pending_controls` dinormalisasi menjadi `{ requestId, executionGeneration, kind, tool?, command?, choices }`.
9. `resolveHermesUnknownRun(agent, runId, { admissionId, executionGeneration })` memanggil `POST /v1/runs/{id}/resolve-unknown` dan mengembalikan `true` hanya untuk respons 2xx.
10. `submitHermesRunApproval` menerima `choice: "once" | "session" | "always" | "deny"` dan wajib diberi `requestId` dan `executionGeneration` asli. Pemanggil lama yang memberi boolean tetap bekerja (true = `once`, false = `deny`). Nilai default palsu `"default"` dan `1` dihapus.
11. `forkHermesSession(agent, sessionId, title?)` mengembalikan ID sesi baru.
12. `getHermesSessionMessages` menerima `{ includeCompacted?, inlineImages? }` dan meneruskannya sebagai query.
13. `streamHermesSessionChat(agent, sessionId, input, signal?)` memanggil `POST /api/sessions/{id}/chat/stream` dan mengembalikan stream SSE.
14. Semua fungsi baru juga lewat dispatcher `lib/agent-runtime.ts`. Untuk agen runtime CLI (Oh My Pi), fungsi yang tidak berlaku mengembalikan hasil kosong yang jelas, bukan memanggil Hermes.

## R3. Orchestrator: memori, pemulihan, approval, token, learned skill

**User story:** Sebagai operator, saya ingin misi memakai memori proyek yang sama, pulih sendiri dari crash, dan mencatat token dan model yang benar.

**Acceptance criteria**

1. Setiap run yang dimulai orchestrator (planning, spec, Coding, QA check, Final review, summarizing) mengirim `sessionKey` = `neiro:project:<projectId>` bila misi punya proyek, atau `neiro:mission:<missionId>` bila tidak.
2. KETIKA status run `unknown` dan `admission_id` serta `execution_generation` tersedia, MAKA orchestrator memanggil `resolveUnknownRun`, melepas klaim run, dan menjadwalkan ulang lewat jalur gagal-coba yang sudah ada. Run yang sama tidak pernah dijalankan dua kali.
3. KETIKA status `unknown` tapi data pemulihan tidak ada atau Hermes tidak mendukung `run_unknown_resolution`, MAKA task masuk Needs you dengan alasan yang jelas.
4. KETIKA run menunggu approval, MAKA `pending_controls` disimpan di task, dan notifikasi `task_needs_you` dikirim sekali per `requestId` (dedupe), bukan setiap tick.
5. KETIKA run selesai, MAKA `cache_read_tokens`, `cache_write_tokens`, `runtime_provider`, dan `runtime_model` disimpan. Model aktual dari `runtime` dipakai lebih dulu, lalu model sesi, lalu model agen.
6. `lib/budget.ts` menampilkan berapa token yang dibaca dari cache per misi.
7. KETIKA `learn_skill_on_done` bernilai true, MAKA fase summarizing juga menghasilkan draf `SKILL.md` (frontmatter YAML `name`, `description`, lalu langkah kerja) yang disimpan sebagai artifact jenis `learned_skill` dengan dedupe key `skill:<missionId>`. Skill tidak dipasang otomatis ke profil.
8. Kontrol task baru `approve_tool_always` (dan `approve_tool_session` bila Hermes menawarkannya) memakai `requestId` dan `executionGeneration` dari `pending_controls`. Tombol pilihan yang tidak ada di `choices` tidak ditampilkan.
9. Kontrol task baru `fork_session` membuat sesi cabang lewat `forkHermesSession`, lalu menjalankan ulang tahap Coding dengan instruksi alternatif dari pengguna. Dengan `createBranchTask: true`, task cabang baru dibuat dan task asli tidak diubah.

## R4. Live log: subagent, reasoning, commentary

**User story:** Sebagai operator, saya ingin melihat agen berpikir, berkomentar, dan mendelegasi ke sub-agen secara langsung.

**Acceptance criteria**

1. `LogStepKind` mendapat `reasoning`, `commentary`, dan `subagent`.
2. Event reasoning (`response.reasoning_summary_text.delta`, `reasoning_content`, `item.type === "reasoning"`) menjadi langkah `reasoning`, dan delta berurutan digabung seperti `message`.
3. `message.interim`, `assistant.commentary`, atau `phase === "commentary"` menjadi langkah `commentary`. Event dengan `already_streamed: true` dilewati.
4. `subagent.start` dan `subagent.complete` menjadi langkah `subagent` dengan `delegation_id`, `child_session_id`, status, ringkasan, durasi, dan token.
5. Di `components/live-log.tsx` dan `components/run-inspector-sheet.tsx`: reasoning tampil sebagai blok "thinking" yang bisa dilipat (mono, redup); subagent tampil sebagai kartu cabang dengan lencana delegasi, durasi detik, dan token.
6. `subagent_runs` di task diperbarui dari event ini agar tetap tampil setelah reload.
7. KETIKA ada `subagent.start` atau panggilan tool `message_agent`, MAKA garis antar-agen di `components/team-wires.tsx` beranimasi. Di `prefers-reduced-motion`, garis hanya menyala tanpa gerak.

## R5. Schedules dan Bot Routines yang bisa dikelola

**User story:** Sebagai operator, saya ingin membuat, mengubah, menjalankan, menjeda, dan menghapus jadwal Hermes per agen dari Neiro.

**Acceptance criteria**

1. `GET /api/schedules?agentId=` mengambil jadwal profil agen itu. Tanpa `agentId`, jadwal dari profil default dan semua profil unik agen aktif digabung, dan setiap item diberi `agentId` dan `agentName`.
2. `POST`, `PATCH`, `DELETE /api/schedules[/jobId]` dan aksi `run`, `pause`, `resume` menerima `agentId` dan meneruskannya ke profil yang benar.
3. Semua route jadwal yang mengubah data hanya bisa dipakai pengguna yang login dengan peran yang boleh mengubah (pola `roleAllows` yang ada).
4. Tombol New schedule, Run now, Pause/Resume, Edit, dan Delete aktif bila koneksi Hermes live. Dalam mode demo tombol tetap mati dengan keterangan alasannya.
5. Form jadwal berisi: Name, Agent/Bot, preset jadwal (Every 1h, Daily 09:00, Weekdays 09:00) atau cron sendiri, Prompt, Skills opsional, Provider opsional, Delivery target opsional. Bila ditautkan ke bot, nama otomatis diberi awalan `[bot:<profile>] ` sekali saja.
6. Delete meminta konfirmasi. Setiap aksi menampilkan toast `sonner` dan memuat ulang daftar.

## R6. Probe kapabilitas, effort, dan pilihan Skills/MCP di AI team

**User story:** Sebagai operator, saya ingin melihat apa yang benar-benar bisa dilakukan tiap agen, dan mengatur effort-nya.

**Acceptance criteria**

1. Form agen punya pilihan Reasoning effort (Default plus nilai yang didukung Hermes) dan input Service tier opsional. Untuk agen CLI, field `effort` yang sudah ada tetap dipakai.
2. Route baru `GET /api/agents/capabilities?agentId=` mengembalikan inventaris rinci dan flag kapabilitas, tanpa field rahasia.
3. Daftar Skills, Core toolsets, dan MCP servers (`mcp-*`) tampil sebagai pill yang dikelompokkan. Menyalakan/mematikan pill memakai jalur pengelolaan per profil yang sudah ada (`lib/hermes-skills.ts`, `lib/hermes-addons.ts`), bukan disimpan sebagai pilihan per run.
4. Tombol Preview di mode live memanggil `POST /api/agents/[id]/probe` dan menampilkan latensi, status `/health/detailed`, flag `/v1/capabilities`, skills aktif, dan toolset beserta tool-nya. Mode demo tetap menampilkan data contoh dengan `DataSourceBadge`.
5. Bagian "Sample agent capabilities" di `components/gateway-monitor.tsx` memakai data nyata per agen saat Hermes terhubung, dan tetap memakai contoh dengan `DataSourceBadge` bila belum terkonfigurasi.

## R7. Bot Mode di `/chat`

**User story:** Sebagai operator, saya ingin mengobrol dengan setiap agen sebagai bot yang ingat percakapan selamanya, me-mention bot lain, dan membuat ruang diskusi beberapa bot.

**Acceptance criteria**

1. Sidebar `/chat` punya tab Bots, Group rooms, dan Project threads. Chat yang sudah ada sekarang tetap bisa dibuka di tab Project threads.
2. Tab Bots menampilkan setiap agen aktif yang tidak `bot_hidden`, dikelompokkan per `bot_section`, dengan robot, peran, status kerja, dan cuplikan pesan terakhir.
3. Membuka bot membuka sesi kanonisnya (`canonical_session_id`). Bila belum ada, sesi `Bot Chat: <nama>` dibuat dan disimpan. Bila dua permintaan datang bersamaan, hanya satu sesi yang tersimpan.
4. Tombol Compact context mengirim perintah kompaksi Hermes ke sesi itu. Riwayat tetap terlihat (`include_compacted=true`).
5. Tombol Archive & start fresh meminta konfirmasi, lalu mengganti `canonical_session_id` dengan sesi baru. Sesi lama tidak dihapus dari Hermes.
6. Kotak input di `chat-view.tsx` dan `task-chat.tsx` punya picker `@` berisi semua bot aktif. Pesan dengan `@<handle>` menyertakan daftar rekan tim dan format atribusi `Message from 🤖 <Sender> (@<handle>):`.
7. Pengguna bisa membuat Group room berisi 2 sampai 6 bot. Nama room unik.
8. Satu pesan di room menjalankan paling banyak 3 putaran dan paling banyak 10 balasan bot. Dengan `@mention`, hanya bot yang disebut yang dapat giliran di putaran pertama. Tanpa mention, atau dengan `@all`/`@everyone`, semua anggota dapat giliran berurutan.
9. Setiap bot membaca transkrip room sejak giliran terakhirnya, membalas singkat atau menjawab `PASS`. Balasan `PASS` tidak ditampilkan sebagai pesan. Room berhenti lebih awal bila satu putaran penuh berisi `PASS`.
10. KETIKA bot menyebut `@user` atau butuh approval tool, MAKA room diberi `needs_you = true`, putaran berhenti, dan room muncul di Needs you.
11. `stop @bot`, `@bot pause`, dan tombol Stop room menghentikan bot atau room itu.
12. Driver room tahan restart: putaran yang sedang jalan dilanjutkan oleh tick berikutnya, bukan diulang dari awal.
13. Tombol Convert discussion to mission membuat misi baru dengan transkrip room sebagai konteks.

## R8. Bot dua arah dan lampiran gambar

**User story:** Sebagai operator, saya ingin menyetujui dan memulai pekerjaan dari Telegram/Slack/Discord, dan melampirkan screenshot ke misi atau chat.

**Acceptance criteria**

1. `webhookPayload` tetap mengirim `text` seperti sekarang, dan untuk `plan_ready`, `task_needs_you`, dan `routing_needs_you` menambah tombol: Slack Block Kit, komponen Discord, dan `reply_markup.inline_keyboard` Telegram. Tombol yang tampil: Approve plan, Approve tool (once), Approve tool (always) bila ditawarkan, Deny, Retry task.
2. Bila `NEIRO_TELEGRAM_BOT_TOKEN` dan `NEIRO_TELEGRAM_CHAT_ID` diisi, notifikasi juga dikirim lewat Telegram Bot API.
3. `POST /api/bot/webhook` hanya menerima permintaan dengan secret yang cocok (`X-Neiro-Bot-Secret` atau `X-Telegram-Bot-Api-Secret-Token`, nilainya `NEIRO_BOT_WEBHOOK_SECRET`), dibandingkan dengan waktu konstan di `lib/auth.ts`. Tanpa secret yang cocok, jawabannya 401 dan tidak ada aksi.
4. `proxy.ts` membebaskan `/api/bot/webhook` dari cookie sesi hanya bila secret header valid. `DASHBOARD_SECRET` tidak dipakai sebagai secret webhook.
5. Perintah yang didukung: `/mission <prompt>`, `/status [missionId]`, `/approve <missionId|taskId>`, `/deny <taskId>`, `/clarify <taskId> <jawaban>`, `/ask [@bot] <pertanyaan>`. Perintah tak dikenal dijawab dengan daftar perintah. Tombol callback menjalankan aksi yang sama.
6. Setiap aksi dari bot dicatat di notifikasi Neiro dengan sumbernya (Telegram/Slack/Discord).
7. Mission composer dan chat punya tombol lampirkan gambar: paling banyak 4 gambar, hanya `image/png`, `image/jpeg`, `image/webp`, `image/gif`, paling besar 2 MB per gambar setelah diubah ke `data:image/...;base64`. Gambar yang melanggar ditolak dengan pesan jelas.
8. Gambar misi disimpan di `missions.attachments` dan dikirim ke run Hermes pertama misi itu. Gambar chat dikirim lewat chat sesi.

## R9. Pengujian

**Acceptance criteria**

1. `lib/hermes.test.ts` menguji: header `X-Hermes-Session-Key` dan pembersihannya, `model_options`, tidak adanya `skills`/`toolsets` di body run, pilihan approval, dan `resolveHermesUnknownRun`.
2. `lib/orchestrator.test.ts` menguji: `sessionKey` per proyek/misi, pemulihan `unknown`, dedupe notifikasi approval per `requestId`, penyimpanan token cache dan model aktual.
3. `lib/run-events.test.ts` menguji parsing `subagent.start`, `subagent.complete`, reasoning delta, commentary, dan lewatnya `already_streamed`.
4. Test driver room menguji: batas 3 putaran dan 10 pesan, `PASS`, `@mention`, `@all`, eskalasi `@user`, dan direktif stop.
5. Test webhook bot menguji: secret salah ditolak, perintah dipetakan ke aksi yang benar.
6. Semua pemeriksaan lulus tanpa error: `bun run test`, `bunx next typegen && bunx tsc --noEmit`, `bun run lint`, `bun run build`. Karena RAM host kecil, pemeriksaan berat dijalankan satu per satu.

## Di luar cakupan

- Memasang learned skill secara otomatis ke profil Hermes.
- Mengirim `skills`/`toolsets` per run (tidak didukung Hermes).
- Menghapus sesi Hermes lama saat Archive.
- Hosting publik untuk webhook masuk. Neiro harus bisa dijangkau dari internet (misalnya lewat tunnel) agar Telegram/Slack/Discord bisa memanggilnya; penyiapan tunnel bukan bagian spec ini.
