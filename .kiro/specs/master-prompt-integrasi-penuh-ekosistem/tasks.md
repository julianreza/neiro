# Tasks: Integrasi penuh ekosistem Hermes di Neiro

Urutan wajib diikuti. Setiap task menyebut file, requirement (R), dan tanda selesai. Jalur relatif ke `/Users/rezajulian/Documents/neiro`.

Aturan untuk semua task:
- Tidak ada ekspor `dynamic`/`revalidate`/`runtime`/dsb. di page, layout, atau route. GET dinamis memanggil `await connection()`.
- Tidak ada `key_enc`, `url` agen, token, atau secret di respons JSON.
- Gaya kode repo: `@/*`, `import type`, kutip ganda, titik koma, 2 spasi.
- RAM host kecil: jalankan test per file (`bun test --conditions=react-server lib/<file>.test.ts`), bukan seluruh suite, sampai task penutup tiap tahap.
- Setiap tahap ditutup dengan satu commit di branch kerja. Tidak ada push ke `main`.

---

## Tahap 1: Fondasi

- [x] **1. Migrasi `20261031000000_hermes_full_suite.sql`** (R1.1-R1.5)
  - Buat `supabase/migrations/20261031000000_hermes_full_suite.sql` persis seperti bagian 1 design: kolom baru `agents`, `missions`, `mission_tasks`, `notifications.actions`, `ask_questions.reply_to`/`reply_sent_at`; tabel `bot_rooms` (dengan `driver`) dan `bot_room_messages`; index `bot_room_messages_room_created_idx`; constraint `agents_reasoning_effort_check` dan jumlah anggota room 2-6 lewat blok `DO $$ ... IF NOT EXISTS (pg_constraint) ...`; `ENABLE ROW LEVEL SECURITY` di dua tabel baru tanpa policy.
  - Selesai bila: file tidak mengubah migrasi lama, semua perintah memakai `IF NOT EXISTS`, dan isi file sudah diberikan ke Reza untuk dijalankan di Supabase SQL editor.

- [x] **2. Helper kolom hilang `lib/missing-column.ts`** (R1.7)
  - Ekstrak `missingColumn(err)` dan `writeDroppingMissing(row, optional, write)` dari logika di `lib/ask-history.ts`.
  - Ubah `lib/ask-history.ts` memakai helper ini tanpa mengubah perilaku.
  - Test `lib/missing-column.test.ts`: pesan error PostgREST `PGRST204` dan Postgres `42703` dikenali; hanya kolom opsional yang dibuang; kolom wajib yang hilang tetap error.
  - Selesai bila: `lib/ask-history.test.ts` dan test baru lulus.

- [x] **3. Tipe baru di `lib/types.ts`** (R1.2-R1.6)
  - Tambah `ReasoningEffort`, `REASONING_EFFORTS`, `ImageAttachment`, `ApprovalChoice`, `PendingControl`, `SubagentRun`, `BotRoom`, `RoomDriver`, `BotRoomMessage`, `UnsupportedRuntimeError`.
  - Perluas `Agent`, `Mission`, `MissionTask` dengan field di bagian 1 design (semua opsional atau dengan default di mapper).
  - Selesai bila: `bunx tsc --noEmit` tidak menambah error baru di file yang menyentuh tipe ini (perbaiki pemanggil yang perlu default).

- [x] **4. Store membaca dan menulis kolom baru** (R1.7)
  - `lib/orchestrator-store.ts`: mapper baris ↔ DTO untuk kolom baru `missions` dan `mission_tasks`, dengan default `0`/`[]`/`null`. Write memakai `writeDroppingMissing` dengan daftar kolom opsional baru.
  - `mapAgentRow` di `lib/orchestrator-store.ts` (dipakai semua route yang membaca tabel `agents`) membaca `reasoning_effort`, `service_tier`, `canonical_session_id`, `bot_section`, `bot_hidden`. Route yang memetakan agen sendiri di `app/api/agents/route.ts` diubah memakai `mapAgentRow`.
  - Selesai bila: `lib/orchestrator.test.ts` yang ada tetap lulus.

- [x] **5. Normalisasi kontrol run di `lib/approvals.ts`** (R2.8, R2.10)
  - Tambah `normalizePendingControls(raw): PendingControl[]`: baca `request_id`/`prompt_id`/`id`, `execution_generation`, `kind`/`type` (approval atau clarify), `tool`, `command`, `choices` (default `["once", "deny"]`, buang nilai di luar `ApprovalChoice`).
  - `normalizeApprovals` memakai fungsi ini. Kontrol tanpa id memakai indeks (`"0"`, `"1"`), bukan `"default"`.
  - Test di `lib/approvals.test.ts`: tiga bentuk payload, `choices` dengan `session`/`always`, clarify tidak masuk approval.

- [x] **6. Adapter: kapabilitas, inventaris, probe** (R2.1-R2.3)
  - `lib/hermes.ts`: `readList`, `getHermesServerCapabilities` (cache 60 detik per `url|profile`, tidak menyimpan hasil gagal), `getHermesDetailedInventory`, `listHermesCapabilitiesInventory` ditulis ulang di atasnya, `HermesProbeResult.readiness`.
  - Selesai bila: test di task 10 untuk bagian ini lulus.

- [x] **7. Adapter: `startHermesRun`** (R2.4-R2.7)
  - Tambah `sessionKey`, `modelOptions`, `images` ke `HermesStartRunInput`. Ekspor `cleanSessionKey`.
  - `model_options` dari input di atas `agent.reasoningEffort`/`agent.serviceTier`; tidak dikirim bila kosong. Tidak ada `skills`/`toolsets` di body.
  - Gambar: `input` jadi daftar pesan dengan `input_text` + `image_url`. Bila 400 `invalid_image_url` atau error model tidak mendukung gambar, ulang sekali dengan teks saja dan kembalikan `skippedImages: true`.

- [x] **8. Adapter: `getHermesRun`, approval, clarify, unknown** (R2.8-R2.10)
  - `getHermesRun`: `cache_read_tokens`, `cache_write_tokens`, `runtime`, `shutdown_requested_at`, `controls`. Tanpa `status` → `"missing_status"`. Model: `runtime.model` dulu, baru model sesi.
  - `resolveHermesUnknownRun`.
  - `submitHermesRunApproval(agent, runId, choice | boolean, { requestId, executionGeneration })` dan `submitHermesRunClarify` tanpa nilai palsu `"default"`/`1`; `execution_generation` hanya dikirim bila tidak null.
  - Perbarui semua pemanggil (`lib/agent-runtime.ts`, route kontrol task, route approval misi) agar mengirim `requestId` dan `executionGeneration` dari `controls`.

- [x] **9. Adapter: sesi** (R2.11-R2.13)
  - `forkHermesSession`, `getHermesSessionMessages(..., { includeCompacted, inlineImages })`, `streamHermesSessionChat`, `sendHermesSessionChat`.
  - Pemanggil `getHermesSessionMessages` yang ada tetap mendapat `inline_images=false` seperti sekarang.

- [x] **10. Dispatcher dan test adapter** (R2.14, R9.1)
  - `lib/agent-runtime.ts`: `resolveUnknownRun`, `submitRunApproval(choice)`, `forkSession`, `compactSession`, `sessionChat`, `getCapabilities`, `getInventory`, sesuai tabel di design bagian 2. `startRun` CLI mengabaikan `sessionKey`/`modelOptions`/`images`.
  - Buat `lib/hermes.test.ts`: header session key dan pembersihan (`\r\n\0`, 256 karakter), `model_options`, tidak ada `skills`/`toolsets`, input multimodal + fallback teks, pemetaan boolean approval, `resolveHermesUnknownRun` 2xx dan 4xx, capabilities 404 → `available: false`, inventaris bentuk array dan objek, `isMcp`.
  - Selesai bila: `lib/hermes.test.ts`, `lib/approvals.test.ts`, `lib/cli-runtime.test.ts` lulus.

- [x] **11. Parser event baru `lib/run-events.ts`** (R4.1-R4.4, R9.3)
  - Tambah kind `reasoning`, `commentary`, `subagent` dan field `subagent` di `LogStep`. Urutan cek sesuai design bagian 4 (subagent sebelum `complete`).
  - `appendStep`: gabung `reasoning` berurutan; `subagent.complete` mengganti kartu `subagent.start` dengan `delegation_id` sama.
  - Buat `lib/run-events.test.ts`: start, complete (tidak jadi `done`), reasoning delta tergabung, commentary, `already_streamed` dilewati, event lama (tool/message/approval) tetap sama.

- [x] **12. Penutup tahap 1**
  - Jalankan satu per satu: test file yang disentuh, `bunx next typegen`, `bunx tsc --noEmit`, `bun run lint`.
  - Commit: `feat(hermes): full API adapter, schema and run-event parsing`.
  - Catatan: tsc, lint, dan test lulus. Commit ditunda: file yang sama (`lib/types.ts`, `lib/orchestrator-store.ts`, `lib/ask-history.ts`) memuat perubahan lain yang belum di-commit dari sesi lain, jadi commit sekarang akan ikut membawa kerja itu.

## Tahap 2: Orchestrator dan UI kerja

- [x] **13. Perluas `HermesClient` dan session key** (R3.1)
  - `lib/orchestrator.ts`: tambah `resolveUnknownRun`, `forkSession`, `getCapabilities` ke `HermesClient` dan `realHermes`; stub di `lib/orchestrator.test.ts` dan test orchestrator lain yang membuat deps.
  - Helper `memoryKey(m)`; pasang `sessionKey` di semua `startRun` (planning, spec, Coding, QA check, Final review, summarizing).
  - Test: misi dengan proyek → `neiro:project:<id>`, tanpa proyek → `neiro:mission:<id>`.

- [x] **14. Pemulihan run `unknown`** (R3.2-R3.3)
  - `handleUnknownRun` sesuai diagram design bagian 3, dipakai `stepMissionRun` dan `stepTask`. Lepas klaim dengan `updateTaskIf` + `claimGuard`.
  - Test: berhasil → retries+1 dan run lepas; resolve gagal → Needs you; fitur tidak ada → Needs you; `missing_status` tidak memicu pemulihan.

- [x] **15. Approval tertunda dan notifikasi aksi** (R3.4, R3.8, R8.1 sebagian)
  - Simpan `pendingControls` saat berubah; kosongkan saat run lanjut/selesai.
  - `lib/notifications.ts`: tipe `NotificationAction`, field `actions` di `NotificationEvent`. Notifikasi approval dengan `dedupeKey: approval:<taskId>:<requestId>` dan tombol sesuai `choices`.
  - `lib/notifications-store.ts`: simpan `actions` ke `notifications.actions` (lewat `writeDroppingMissing`).
  - Test: dua tick dengan `requestId` sama → satu notifikasi; `requestId` baru → notifikasi kedua; tombol Always hanya bila ada di `choices`.

- [x] **16. Token cache dan model aktual** (R3.5-R3.6)
  - Saat run selesai: tambah `cacheReadTokens`/`cacheWriteTokens`, isi `runtimeProvider`/`runtimeModel`. Penulisan `agent_token_usage` memakai `run.runtime?.model ?? run.model ?? agent.model`.
  - `lib/budget.ts`: `cacheSummary(tasks)`. Tampilkan "Cache read <n> (<p>%)" di kartu budget misi (cari pemakai `lib/budget.ts` di `components/mission-workspace.tsx`).
  - Test: akumulasi dua run, `readShare` 0 saat total 0, model runtime menang atas model sesi.

- [x] **17. Learned skill** (R3.7)
  - `lib/orchestrator-parsers.ts`: `extractSkillBlock(output)` dengan validasi frontmatter `name` dan `description`.
  - `stepSummarize`: tambah bagian prompt skill bila `m.learnSkillOnDone`; simpan artifact `learned_skill`, `dedupeKey: skill:<id>`.
  - `POST /api/missions` menerima `learnSkillOnDone` (boolean). Checkbox "Learn a skill when done" di `components/mission-composer.tsx`, default mati.
  - `components/markdown-artifact-viewer.tsx`: label "Learned skill" dan tombol Copy.
  - Test: blok valid → artifact; blok tanpa `description` → tidak ada artifact, misi tetap selesai; flag mati → prompt tidak berubah.

- [x] **18. Kontrol task baru** (R3.8-R3.9)
  - `app/api/missions/[id]/tasks/[taskId]/control/route.ts`: `approve_tool_session`, `approve_tool_always` (400 bila tidak ada di `choices`), `deny_tool` dan `approve_tool` memakai `requestId` dari `pendingControls`.
  - `fork_session` sesuai design bagian 3 (409 bila run aktif atau sesi kosong; `instructions` 1-4000 karakter; artifact `fork_note`; stage `Routed`; varian `createBranchTask`).
  - `startTaskRun`: tambahkan catatan fork terbaru sebagai "Try this approach instead:".
  - UI: tombol Always/Session di kartu approval (`components/approval-ask.tsx`) hanya bila ditawarkan; aksi "Fork & retry" di `components/run-inspector-sheet.tsx` dengan dialog instruksi dan checkbox "Keep the original task".
  - Test orchestrator: catatan fork masuk prompt Coding berikutnya.

- [x] **19. Live log, inspector, team wires** (R4.5-R4.7)
  - `components/live-log.tsx`: baris reasoning (`<details>` "Thinking", mono redup), commentary (miring + ikon), kartu subagent (garis cabang SVG, `.code-chip` delegation id, status, durasi, token).
  - `app/api/hermes/runs/[runId]/events/route.ts`: tap event `subagent.*` → simpan `subagent_runs` ke task (debounce 2 detik, hanya bila berubah). Orchestrator juga membaca `delegations`/`subagents` dari `getHermesRun` bila ada.
  - `components/run-inspector-sheet.tsx`: bagian Sub-agents, token cache, "Ran on <provider>/<model>".
  - `components/team-wires.tsx`: prop `activeLinks`, animasi `stroke-dashoffset` 1.2 detik, statis di `prefers-reduced-motion`. Sumber dari langkah subagent `running` dan tool `message_agent` 30 detik terakhir.
  - Sebelum mengubah UI, baca skill `frontend-design-workflow`, `anthropics-skills-frontend-design`, `leonxlnx-taste-skill-design-taste-frontend`, `vercel-labs-agent-skills-web-design-guidelines`, `nextlevelbuilder-ui-ux-pro-max-skill-ui-ux-pro-max`.

- [x] **20. Penutup tahap 2**
  - Test file yang disentuh, `bunx tsc --noEmit`, `bun run lint`.
  - Commit: `feat(orchestrator): memory key, unknown-run recovery, approvals, cache tokens, fork, learned skill`.
  - Catatan: tsc, lint, test lulus. Commit ditunda dengan alasan yang sama seperti tahap 1. Tidak ada kartu budget misi di UI; token cache tampil per task di Run inspector. `TeamWires` tidak dipasang di halaman mana pun; prop `delegating` dan CSS-nya siap dipakai.

## Tahap 3: Agen dan jadwal

- [x] **21. Route kapabilitas dan probe** (R6.2, R6.4)
  - Buat `app/api/agents/capabilities/route.ts` (GET, `agentId` wajib, 404 bila tidak ada, 409 untuk agen CLI dengan `available: false`). Respons hanya `capabilities`, `skills`, `toolsets: { core, mcp }`.
  - `app/api/agents/[id]/probe/route.ts`: tambah `readiness`, `capabilities`, `skills`, `toolsets`; buang `details` mentah dari respons.
  - Test kecil di `lib/agents-capabilities.test.ts` untuk fungsi pembentuk respons: tidak ada `key_enc`, `url`, `details`.

- [x] **22. Effort dan service tier** (R6.1)
  - `app/api/agents/route.ts` dan `app/api/agents/[id]/route.ts`: validasi `reasoningEffort` (anggota `REASONING_EFFORTS` atau null) dan `serviceTier` (maks. 40, `[a-z0-9_-]`), simpan ke kolom baru.
  - `components/agents-manager.tsx`: select Reasoning effort dan input Service tier untuk agen Hermes; agen CLI tetap memakai select `effort` yang ada.

- [x] **23. Pill Skills/MCP dan Preview nyata** (R6.3-R6.4)
  - `components/agents-manager.tsx`: bagian "Skills & tools" dengan tiga grup pill dari route capabilities. Klik pill memakai route yang ada `app/api/agents/[id]/skills` dan `app/api/agents/[id]/addons`. MCP `configured === false` → tanda "needs key" yang membuka form API key MCP yang ada.
  - Dialog Preview: mode live memanggil probe dan menampilkan latensi, readiness, flag kapabilitas, skills, toolset dengan daftar tool yang bisa dilipat. Mode demo tetap konten contoh + `DataSourceBadge`.

- [x] **24. Gateway monitor nyata** (R6.5)
  - `components/gateway-monitor.tsx`: saat live, satu baris per agen (jumlah skills, toolset, MCP, flag `run_approval`, `run_unknown_resolution`, `reasoning_streaming`), dimuat paralel maks. 4 sekaligus. Saat demo, konten contoh sekarang.

- [x] **25. Lib dan API jadwal multi-profil** (R5.1-R5.3)
  - Buat `lib/schedules.ts`: `agentForSchedule`, `listAllSchedules` (kelompok `url|profile`, `Promise.allSettled`, item error per profil gagal), `parseScheduleInput`, `withBotPrefix`.
  - `app/api/schedules/route.ts` dan `app/api/schedules/[jobId]/route.ts`: `agentId` dari query/body, validasi input, cek peran admin untuk mutasi.
  - Test `lib/schedules.test.ts`: prefix tidak ganda, input tidak sah ditolak, field asing dibuang, profil sama dibaca sekali, satu profil gagal tidak menggagalkan daftar.

- [x] **26. UI Schedules** (R5.4-R5.6)
  - `components/schedules-manager.tsx`: aktifkan New schedule, Run now, Pause/Resume, Edit, Delete saat live; mode demo tetap mati dengan alasan.
  - Dialog `ScheduleDialog`: Name, Agent/Bot, preset (`every 1h`, `0 9 * * *`, `0 9 * * 1-5`, Custom), Prompt, Skills (pill dari route capabilities), Provider, Delivery target. Prefix `[bot:<profile>] ` lewat `withBotPrefix`.
  - Kolom Bot dengan robot kecil (`agentLook(lookRole(a))`). Delete lewat `components/delete-button.tsx`. Toast `sonner` + `live.reload()` setelah tiap aksi.

- [x] **27. Penutup tahap 3**
  - Test file yang disentuh, `bunx tsc --noEmit`, `bun run lint`.
  - Commit: `feat(agents): live capabilities, reasoning effort, skills/MCP pills, schedule management`.
  - Catatan: tsc, lint, test lulus. Commit ditunda (alasan sama). Pill Skills/MCP tidak dibuat ulang: `AgentAddons` di form agen sudah mengelolanya per profil. Hermes `/api/jobs` tidak punya provider per jadwal dan prompt maks. 5.000 karakter, jadi form mengikuti itu.

## Tahap 4: Bot

- [x] **28. Mention parser `lib/mentions.ts`** (R7.6, R7.8, R7.10-R7.11)
  - `handleOf(agent)` dengan akhiran `-2` untuk bentrok, `parseMentions(text, known)`.
  - Test `lib/mentions.test.ts`: handle dikenal/tidak, `@all`/`@everyone`, `@user`, `stop @bot`, `@bot pause`, stop room, mention di dalam kata (`email@forge`) tidak dihitung.

- [x] **29. Bot roster dan sesi kanonis** (R7.2-R7.5)
  - Buat `lib/bots.ts`: roster (tanpa `bot_hidden`, kelompok `bot_section`), `ensureCanonicalSession` dengan `UPDATE ... WHERE canonical_session_id IS NULL`, `archiveCanonicalSession`, blok roster rekan tim dan format atribusi.
  - Route `app/api/bots/route.ts`, `app/api/bots/[agentId]/route.ts`, `app/api/bots/[agentId]/session/route.ts` (compact → 409 untuk agen CLI).
  - Pesan bot memakai `sessionKey: neiro:bot:<agentId>` dan disimpan di `ask_questions`.
  - Test: dua panggilan bersamaan `ensureCanonicalSession` → satu id tersimpan dipakai keduanya.

- [x] **30. Store room** (R7.7)
  - Buat `lib/rooms-store.ts`: list, get (dengan 200 pesan terakhir), create (nama unik, 2-6 anggota aktif), update, delete, tambah pesan, update driver bersyarat `updated_at`.
  - Route `app/api/rooms/route.ts` dan `app/api/rooms/[roomId]/route.ts`. Nama bentrok → 409. Anggota di luar 2-6 → 400.

- [x] **31. Driver room `lib/rooms.ts`** (R7.8-R7.12, R9.4)
  - Konstanta `MAX_ROUNDS = 3`, `MAX_REPLIES = 10`, `TURN_TIMEOUT_MS = 600000`.
  - `onUserMessage(room, message, deps)` dan `advanceRoom(room, deps)` sesuai algoritma design bagian 7. Deps disuntik (store, `startRun`, `getRun`, `stopRun`, `createSession`, `now`).
  - `advanceRooms()` dipanggil dari `runTick()` di `lib/tick.ts` setelah `runCodeReviews`; satu langkah per room per tick.
  - Test `lib/rooms.test.ts`: batas 3 putaran, batas 10 balasan, putaran penuh PASS berhenti, mention hanya bot itu di putaran 1, `@all`, `@user` → `needs_you`, approval → `needs_you`, stop/pause, timeout giliran, update driver bersyarat yang kalah tidak memulai run.

- [x] **32. Route pesan dan kontrol room** (R7.11, R7.13)
  - `app/api/rooms/[roomId]/messages/route.ts` (POST pesan + gambar opsional) memanggil `onUserMessage`.
  - `app/api/rooms/[roomId]/control/route.ts`: `stop` (driver null + `stopRun`), `resume`, `to_mission` (transkrip maks. 200 pesan / 20.000 karakter ke jalur buat misi yang ada, lalu `advanceMission`; balas `missionId`).
  - `lib/needs-you.ts`: jenis `room_needs_you`; `app/api/needs-you/route.ts` dan `components/needs-you-inbox.tsx` menampilkannya dengan tautan ke room.

- [x] **33. Input mention dan gambar** (R7.6, R8.7)
  - Buat `lib/attachments.ts` (`validateAttachments`, batas 4 gambar, 2 MB, 4 tipe) + `lib/attachments.test.ts`.
  - Buat `components/mention-input.tsx` (textarea + listbox `@`, keyboard, `aria-activedescendant`) dan `components/attach-images.tsx` (klip, tempel, seret-lepas, pratinjau, hapus).
  - Pasang di `components/chat-view.tsx`, `components/task-chat.tsx` (mention saja), dan `components/mission-composer.tsx` (gambar saja).
  - `POST /api/missions` dan `POST /api/ask` memvalidasi ulang gambar di server; misi menyimpan `attachments` dan mengirimnya hanya ke run planning pertama. `GET /api/missions` tidak memilih kolom `attachments`.

- [x] **34. UI Bot Mode di `/chat`** (R7.1-R7.5, R7.7, R7.13)
  - Baca kelima skill UI (lihat task 19) sebelum mulai.
  - `components/chat-view.tsx`: tab Bots / Group rooms / Project threads. Daftar chat sekarang pindah ke Project threads tanpa perubahan perilaku, `?chat=<id>` tetap jalan dan membuka tab itu.
  - Tab Bots: kelompok section, `AgentBot` dengan `agentLook(lookRole(a))`, status (berdenyut saat bekerja, statis di reduced-motion), cuplikan pesan terakhir. Panel bot: Compact context, Archive & start fresh (konfirmasi).
  - Tab Group rooms: pinned di atas, lencana Needs you, dialog New room (nama, 2-6 bot, section). Panel room: pesan per pengirim dengan robot, pesan system kecil, "<bot> is thinking…", Stop/Resume, Convert to mission. Polling 3 detik saat driver aktif, 15 detik saat diam.
  - Lebar penuh dan neumorphism seperti `/chat` sekarang.

- [x] **35. Notifikasi keluar Slack/Discord/Telegram** (R8.1-R8.2)
  - `lib/notifications.ts`: token aksi (`p`, `r`, `o`, `a`, `d`, `t`), `webhookPayload` per format `generic`/`slack`/`discord` (`NEIRO_NOTIFY_WEBHOOK_FORMAT`).
  - Buat `lib/telegram.ts`: `sendTelegramMessage(text, keyboard?)`, `answerCallbackQuery(id, text)`, timeout 5 detik, token tidak pernah dicatat. Token aksi > 64 byte → `n.<notificationId>.<index>`.
  - `lib/notifications-store.ts`: kirim ke Telegram bila env terisi.
  - Orchestrator mengisi `actions` untuk `plan_ready`, `task_needs_you` (approval dan gagal), `routing_needs_you`.
  - Test di `lib/budget-notify.test.ts` atau file baru `lib/notifications.test.ts`: tiap format hanya berisi field miliknya, `text` selalu ada, token panjang dialihkan.

- [x] **36. Perintah bot dan webhook masuk** (R8.3-R8.6, R9.5)
  - Buat `lib/bot-commands.ts`: `parseBotCommand`, `runBotCommand` dengan deps disuntik; `/approve` ke tiga target; `/ask` menyimpan `reply_to`.
  - `deliverBotReplies()` di `runTick()`: kirim jawaban `/ask` sekali (`reply_sent_at IS NULL`), potong di 3.500 karakter dengan tautan `/chat?chat=<id>`.
  - Buat `app/api/bot/webhook/route.ts` sesuai design bagian 8 (503 tanpa secret, 401 secret salah, batas 64 KB, chat id Telegram harus cocok, `callback_query` dijawab).
  - `proxy.ts`: `isBotWebhookRequest` dengan `timingSafeEqualString`; lolos tanpa cookie hanya bila secret cocok; header sesi dihapus.
  - Notifikasi `bot_action` untuk tiap aksi.
  - Tambah `NEIRO_BOT_WEBHOOK_SECRET`, `NEIRO_TELEGRAM_BOT_TOKEN`, `NEIRO_TELEGRAM_CHAT_ID`, `NEIRO_NOTIFY_WEBHOOK_FORMAT=generic` ke `.env.example`.
  - Test `lib/bot-commands.test.ts` dan `lib/bot-webhook.test.ts` sesuai design bagian 10; test proxy di `lib/auth-route.test.ts`: tanpa secret tetap butuh cookie.

- [x] **37. Penutup akhir** (R9.6)
  - Cek `resource_status` dulu. Bila RAM cukup, jalankan satu per satu: `bun run test`, `bunx next typegen`, `bunx tsc --noEmit`, `bun run lint`, `bun run build`. Bila RAM kurang, jalankan test per file dan tunda build, lalu laporkan apa yang belum jalan.
  - Perbaiki semua error dan warning.
  - Commit: `feat(bots): bot mode chat, group rooms, two-way Telegram, image attachments`.
  - Laporkan ke Reza: SQL migrasi yang harus dijalankan, env baru yang harus diisi, dan cara mendaftarkan webhook Telegram (`setWebhook` dengan `secret_token`), termasuk catatan bahwa Neiro harus bisa dijangkau publik lewat tunnel.
  - Catatan: semua file test lulus (dijalankan satu per satu), `tsc` 0 error, `bun run lint` bersih. `bun run build` ditunda karena RAM host kritis (~1,2 GB). Commit ditunda: file yang sama memuat kerja sesi lain yang belum di-commit. Layout Bot Mode: nomor 2 (rel robot + daftar), dipindah ke menu sendiri `/bots` atas permintaan Reza; `/chat` tetap untuk project threads (dengan @mention dan lampiran gambar).
