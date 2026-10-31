# Design: Integrasi penuh ekosistem Hermes di Neiro

Dokumen ini menjelaskan cara teknis memenuhi `requirements.md` (R1 sampai R9). Semua jalur file relatif ke `/Users/rezajulian/Documents/neiro`.

## Keputusan yang dipakai

| Keputusan | Pilihan |
|---|---|
| Kolom `agents.skills` / `agents.toolsets` | Tidak dibuat. Skills dan toolset diatur per profil lewat `lib/hermes-skills.ts` dan `lib/hermes-addons.ts` |
| Perintah masuk dari chat app | Telegram dulu. Slack dan Discord mendapat tombol di notifikasi keluar. Parser perintah dibuat netral platform agar adapter Slack/Discord bisa ditambah nanti |
| Cara pengerjaan | Satu spec, 4 tahap, satu commit per tahap |

Akibat keputusan kedua pada R8.5: perintah masuk yang diterima endpoint di spec ini datang dari Telegram (pesan dan `callback_query`) dan dari pemanggil generik yang mengirim JSON `{ text }` dengan header `X-Neiro-Bot-Secret`.

## Gambaran arsitektur

```
Browser (components/*)
   │  fetch /api/*
   ▼
Route handlers (app/api/**/route.ts)        POST /api/bot/webhook ◄── Telegram / pemanggil generik
   │                                             │
   ▼                                             ▼
lib/agent-runtime.ts  (satu pintu: Hermes atau CLI)   lib/bot-commands.ts
   │                                             │
   ▼                                             ▼
lib/hermes.ts  ──HTTP──►  Hermes API Server    lib/orchestrator.ts, lib/rooms.ts
                                                 │
runTick() (lib/tick.ts) ──► advanceActiveMissions + runCodeReviews + advanceRooms (baru)
   │
   ▼
Supabase (getSupabaseAdmin, RLS on, tanpa policy publik)
```

Tidak ada proses latar baru. Driver room ikut `runTick()` yang sudah dipanggil `lib/local-ticker.ts` dan `app/api/orchestrator/tick/route.ts`.

## Tahap pengerjaan

| Tahap | Isi | Requirement |
|---|---|---|
| 1. Fondasi | Migrasi, tipe, store, adapter Hermes, run-events | R1, R2, R4.1-4.4, R9.1, R9.3 |
| 2. Orchestrator dan UI kerja | Memori, recovery, approval, token cache, fork, learned skill, live log, team wires | R3, R4.5-4.7, R9.2 |
| 3. Agen dan jadwal | Probe, effort, pill Skills/MCP, Schedules CRUD | R5, R6 |
| 4. Bot | Bot Mode `/chat`, room, webhook bot, gambar | R7, R8, R9.4-9.5 |

---

## 1. Database (R1)

File baru: `supabase/migrations/20261031000000_hermes_full_suite.sql`. Timestamp ini lebih baru dari migrasi terakhir (`20261030000500_code_review_design.sql`).

```sql
-- agents
ALTER TABLE agents ADD COLUMN IF NOT EXISTS reasoning_effort TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS service_tier TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS canonical_session_id TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS bot_section TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS bot_hidden BOOLEAN NOT NULL DEFAULT false;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_reasoning_effort_check') THEN
    ALTER TABLE agents ADD CONSTRAINT agents_reasoning_effort_check CHECK (
      reasoning_effort IS NULL OR reasoning_effort IN
      ('none','minimal','low','medium','high','xhigh','max','ultra'));
  END IF;
END $$;

-- missions
ALTER TABLE missions ADD COLUMN IF NOT EXISTS learn_skill_on_done BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

-- mission_tasks
ALTER TABLE mission_tasks ADD COLUMN IF NOT EXISTS cache_read_tokens INT NOT NULL DEFAULT 0;
ALTER TABLE mission_tasks ADD COLUMN IF NOT EXISTS cache_write_tokens INT NOT NULL DEFAULT 0;
ALTER TABLE mission_tasks ADD COLUMN IF NOT EXISTS runtime_provider TEXT;
ALTER TABLE mission_tasks ADD COLUMN IF NOT EXISTS runtime_model TEXT;
ALTER TABLE mission_tasks ADD COLUMN IF NOT EXISTS pending_controls JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE mission_tasks ADD COLUMN IF NOT EXISTS admission_id TEXT;
ALTER TABLE mission_tasks ADD COLUMN IF NOT EXISTS execution_generation INT;
ALTER TABLE mission_tasks ADD COLUMN IF NOT EXISTS subagent_runs JSONB NOT NULL DEFAULT '[]'::jsonb;

-- bot_rooms
CREATE TABLE IF NOT EXISTS bot_rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  avatar_url TEXT,
  member_agent_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  detect_stop_directives BOOLEAN NOT NULL DEFAULT true,
  needs_you BOOLEAN NOT NULL DEFAULT false,
  pinned BOOLEAN NOT NULL DEFAULT false,
  section TEXT,
  member_sessions JSONB NOT NULL DEFAULT '{}'::jsonb,
  driver JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- constraint member count 2..6, dibuat via DO-block yang sama seperti di atas:
--   CHECK (jsonb_typeof(member_agent_ids) = 'array'
--          AND jsonb_array_length(member_agent_ids) BETWEEN 2 AND 6)

CREATE TABLE IF NOT EXISTS bot_room_messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES bot_rooms(id) ON DELETE CASCADE,
  sender_kind TEXT NOT NULL CHECK (sender_kind IN ('user', 'bot', 'system')),
  sender_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  sender_name TEXT NOT NULL,
  content TEXT NOT NULL,
  mentions JSONB NOT NULL DEFAULT '[]'::jsonb,
  thread_root_id TEXT,
  run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bot_room_messages_room_created_idx
  ON bot_room_messages (room_id, created_at);

ALTER TABLE bot_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_room_messages ENABLE ROW LEVEL SECURITY;
```

Tambahan di luar master prompt, karena dibutuhkan R7.11 dan R7.12:

- `bot_rooms.driver` (JSONB, null saat diam) menyimpan keadaan putaran yang sedang jalan: `{ triggerMessageId, round, queue: agentId[], replies, passesThisRound, paused: agentId[], claim: { agentId, runId, startedAt } | null }`.
- `notifications.actions` (JSONB, default `[]`) menyimpan tombol aksi notifikasi, dipakai bila token aksi terlalu panjang untuk `callback_data` Telegram (bagian 8).
- `ask_questions.reply_to` (TEXT, boleh null, misalnya `telegram:<chatId>`) dan `ask_questions.reply_sent_at` (TIMESTAMPTZ) untuk mengirim jawaban `/ask` kembali ke chat app sekali saja.

```sql
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actions JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ask_questions ADD COLUMN IF NOT EXISTS reply_to TEXT;
ALTER TABLE ask_questions ADD COLUMN IF NOT EXISTS reply_sent_at TIMESTAMPTZ;
```

Kolom `mission_tasks.session_id` (sudah ada dari `20261029000400_task_session.sql`) dipakai untuk fork. Tidak ada kolom sesi baru di task.

### Tipe dan store

`lib/types.ts`:

```ts
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export const REASONING_EFFORTS: readonly ReasoningEffort[] = [...];

export type Agent = { ...; reasoningEffort?: ReasoningEffort | null; serviceTier?: string | null;
  canonicalSessionId?: string | null; botSection?: string | null; botHidden?: boolean };

export type ImageAttachment = { name: string; dataUrl: string };
export type Mission = { ...; learnSkillOnDone: boolean; attachments: ImageAttachment[] };

export type PendingControl = {
  requestId: string; executionGeneration: number | null; kind: "approval" | "clarify";
  tool?: string; command?: string; choices: ApprovalChoice[];
};
export type ApprovalChoice = "once" | "session" | "always" | "deny";
export type SubagentRun = {
  delegationId: string; childSessionId?: string; status: "running" | "completed" | "failed";
  summary?: string; durationSec?: number; tokens?: number; startedAt: string | null;
};
export type MissionTask = { ...; cacheReadTokens: number; cacheWriteTokens: number;
  runtimeProvider: string | null; runtimeModel: string | null; pendingControls: PendingControl[];
  admissionId: string | null; executionGeneration: number | null; subagentRuns: SubagentRun[] };

export type BotRoom = { id; name; avatarUrl; memberAgentIds; detectStopDirectives; needsYou;
  pinned; section; memberSessions: Record<string, string>; driver: RoomDriver | null; ... };
export type BotRoomMessage = { id; roomId; senderKind: "user" | "bot" | "system";
  senderAgentId: string | null; senderName; content; mentions: string[];
  threadRootId: string | null; runId: string | null; createdAt };
```

`AgentPublic` tetap `Omit<Agent, "key_enc">`. Tidak ada field rahasia baru di `Agent`.

Penanganan kolom yang belum ada (R1.7): helper baru `lib/missing-column.ts` diekstrak dari pola di `lib/ask-history.ts`:

```ts
/** Nama kolom yang ditolak Postgres/PostgREST, atau null. */
export function missingColumn(err: { code?: string; message?: string } | null): string | null;
/** Jalankan write; bila satu kolom hilang, buang kolom itu dan coba lagi (maks. jumlah kolom opsional). */
export async function writeDroppingMissing<T>(row: Record<string, unknown>, optional: readonly string[],
  write: (row: Record<string, unknown>) => Promise<{ error: ... }>): Promise<...>;
```

`lib/ask-history.ts` diubah memakai helper ini (perilakunya tetap). `lib/orchestrator-store.ts` memakainya untuk kolom baru `mission_tasks` dan `missions`. Mapper baris → DTO memberi default (`0`, `[]`, `null`) bila kolom tidak ada di baris.

---

## 2. Adapter Hermes (R2)

Semua di `lib/hermes.ts`. Pola tetap: `hermesFetch(agent, path, init, signal)`.

### Kapabilitas dan inventaris

```ts
export type HermesServerCapabilities = {
  available: boolean;
  features: Record<string, boolean>;           // run_unknown_resolution, run_approval, ...
  endpoints: Record<string, { method: string; path: string }>;
  sessionKeyHeader?: string;
};
export async function getHermesServerCapabilities(agent?): Promise<HermesServerCapabilities>;

export type HermesSkillInfo = { name: string; description?: string; category?: string };
export type HermesToolsetInfo = { name: string; label?: string; description?: string;
  enabled?: boolean; configured?: boolean; tools?: string[]; isMcp: boolean };
export async function getHermesDetailedInventory(agent):
  Promise<{ skills: HermesSkillInfo[]; toolsets: HermesToolsetInfo[] }>;
```

Parser bersama `readList(data, key)` menerima array polos atau `{ <key>: [...] }`, seperti logika di `listHermesCapabilitiesInventory` sekarang. `listHermesCapabilitiesInventory` ditulis ulang di atas `getHermesDetailedInventory` dan tetap mengembalikan `string[]`.

`getHermesServerCapabilities` di-cache per URL+profil selama 60 detik di memori modul (`Map`), karena orchestrator membacanya tiap kali menemukan run `unknown`. Cache kosong saat gagal agar tidak menyimpan `available: false` terlalu lama.

### Probe

`HermesProbeResult` mendapat `readiness?: { status?: string; db?: string; diskFreeBytes?: number; activeRuns?: number; pendingCompletions?: number; activeDelegations?: number }`. Field dibaca dengan helper angka/teks yang aman. `details` mentah tetap ada untuk kompatibilitas, tapi route probe hanya mengirim `readiness` ke browser.

### `startHermesRun`

```ts
export type HermesStartRunInput = {
  sessionId?: string; prompt: string; instructions?: string; model?: string; idempotencyKey?: string;
  sessionKey?: string;
  modelOptions?: { reasoning_effort?: ReasoningEffort; service_tier?: string; reasoning?: { enabled: boolean } };
  images?: Array<{ name?: string; dataUrl: string }>;
};
```

- `sessionKey` → `cleanSessionKey(v) = v.replace(/[\r\n\0]/g, "").slice(0, 256)`. Bila hasilnya kosong, header tidak dikirim. Diekspor agar bisa dites.
- `model_options` = gabungan `input.modelOptions` di atas nilai agen (`reasoningEffort`, `serviceTier`). Objek kosong tidak dikirim.
- Tidak ada `skills`/`toolsets` di body (R2.6). Test memastikan kuncinya tidak ada.
- `images`: bila ada, `input` dikirim sebagai daftar pesan:
  ```json
  [{ "role": "user", "content": [
    { "type": "input_text", "text": "<prompt>" },
    { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }
  ] }]
  ```
  Hermes memvalidasi bagian `image_url` dan menerima `data:image/...`. Bila Hermes menjawab 400 dengan kode `invalid_image_url` atau model tidak mendukung gambar, run dikirim ulang sekali dengan teks saja dan hasilnya membawa `skippedImages: true`. Pemanggil menulis catatan ke log task.

`HermesStartRunResult` started-variant mendapat `skippedImages?: boolean`.

### `getHermesRun`

`HermesRunStatus` mendapat:

```ts
cache_read_tokens?: number; cache_write_tokens?: number;
runtime?: { provider?: string; model?: string; route_source?: string };
shutdown_requested_at?: number;
controls: PendingControl[];        // hasil normalisasi
```

`pending_controls` mentah tetap ada. Normalisasi di fungsi baru `normalizePendingControls(raw)` di `lib/approvals.ts`, yang juga dipakai `normalizeApprovals` (sehingga nilai palsu `"default"` hilang dari satu tempat). Bila Hermes tidak mengirim `choices`, default-nya `["once", "deny"]`.

Model: urutan `runtime.model` → model sesi (logika sekarang) → kosong. Bila `runtime.model` ada, panggilan sesi tidak dilakukan.

### Kontrol run

```ts
export async function resolveHermesUnknownRun(agent, runId,
  details: { admissionId: string; executionGeneration: number }): Promise<boolean>;

export async function submitHermesRunApproval(agent, runId,
  choice: ApprovalChoice | boolean,
  details: { requestId: string; executionGeneration: number | null }): Promise<boolean>;
```

Boolean dipetakan `true → "once"`, `false → "deny"`. `execution_generation` hanya dikirim bila bukan null. `submitHermesRunClarify` diubah sama: tidak ada lagi `"default"` dan `1`.

### Sesi

```ts
export async function forkHermesSession(agent, sessionId, title?): Promise<string>;
export async function getHermesSessionMessages(agent, sessionId,
  opts?: { includeCompacted?: boolean; inlineImages?: boolean });
export async function streamHermesSessionChat(agent, sessionId,
  input: { prompt: string; images?: string[]; model?: string; modelOptions?: Record<string, unknown> },
  signal?): Promise<ReadableStream<Uint8Array>>;
export async function sendHermesSessionChat(agent, sessionId, input): Promise<{ output: string; tokens: number }>;
```

`sendHermesSessionChat` (non-stream, `POST /api/sessions/{id}/chat`) dipakai untuk kompaksi (`prompt: "/compact"`) dan untuk giliran bot di room, karena driver berjalan di dalam tick dan butuh jawaban utuh.

### Dispatcher (`lib/agent-runtime.ts`)

Fungsi baru dengan perilaku CLI yang jelas:

| Fungsi | Hermes | CLI (Oh My Pi) |
|---|---|---|
| `resolveUnknownRun` | `resolveHermesUnknownRun` | `false` |
| `submitRunApproval(choice)` | pilihan penuh | `once`/`session`/`always` → Allow, `deny` → Deny |
| `forkSession` | `forkHermesSession` | lempar `UnsupportedRuntimeError` |
| `compactSession` | `sendHermesSessionChat("/compact")` | lempar `UnsupportedRuntimeError` |
| `sessionChat` | `sendHermesSessionChat` | `startCliRun` lalu tunggu `getCliRun` |
| `getCapabilities` / `getInventory` | Hermes | `{ available: false }` / kosong |

`UnsupportedRuntimeError` (di `lib/types.ts`) dipetakan route ke 409 dengan pesan "Not available for Oh My Pi agents". `startRun` untuk CLI mengabaikan `sessionKey`, `modelOptions`, dan `images` (CLI tetap pakai `effort`).

---

## 3. Orchestrator (R3)

### `HermesClient`

Tipe `HermesClient` di `lib/orchestrator.ts` diperluas:

```ts
type HermesClient = {
  startRun; getRun; createSession;
  resolveUnknownRun: typeof resolveUnknownRun;
  forkSession: typeof forkSession;
  getCapabilities: typeof getCapabilities;
};
```

Test memberi stub untuk ketiganya.

### Session key

Helper `memoryKey(m: Mission): string` = `neiro:project:${m.projectId}` atau `neiro:mission:${m.id}`. Dipanggil di semua `d.hermes.startRun` di `stepMissionRun`, `startTaskRun`, dan `stepSummarize`.

### Run `unknown`

Fungsi bersama `handleUnknownRun(agent, run, release)`:

```
status.toLowerCase() === "unknown"
  ├─ admission_id && typeof execution_generation === "number"
  │    && (await d.hermes.getCapabilities(agent)).features.run_unknown_resolution
  │      → ok = await d.hermes.resolveUnknownRun(...)
  │        ok    → release() lalu jalur failAttempt yang ada (retries+1, tick berikut menjadwalkan ulang)
  │        !ok   → Needs you, alasan "Hermes could not resolve a run left in an unknown state"
  └─ selain itu → Needs you, alasan "Run state is unknown and Hermes cannot recover it"
```

`release()` memakai `updateTaskIf(task.id, claimGuard, { runId: null, ... })` sehingga dua tick yang bersamaan hanya satu yang menang. Untuk run misi (planning/spec) jalurnya sama, memakai `clearRun` misi.

Catatan: status `unknown` saat ini juga nilai default bila Hermes tidak mengirim `status`. `getHermesRun` diubah: tanpa `status` hasilnya `"missing_status"`, agar hanya status `unknown` asli yang memicu pemulihan.

### Approval tertunda

Di `stepTask`, ketika `run.controls.length > 0` atau status `waiting_for_approval`:

1. Simpan `pendingControls` bila berbeda dari yang tersimpan (bandingkan `requestId` saja).
2. Untuk setiap `requestId` baru: `safeNotify` `task_needs_you` dengan `dedupeKey: approval:${task.id}:${requestId}` dan `actions` (lihat bagian 8).
3. Saat run lanjut atau selesai, `pendingControls` dikosongkan.

### Token dan model

Saat run selesai, `cacheReadTokens += run.cache_read_tokens ?? 0`, sama untuk write, `runtimeProvider`/`runtimeModel` diisi dari `run.runtime`. Penulisan `agent_token_usage` yang sudah ada memakai `run.runtime?.model ?? run.model ?? agent.model`.

`lib/budget.ts` mendapat `cacheSummary(tasks): { readTokens: number; writeTokens: number; readShare: number }`. `readShare` = `readTokens / (tokens total)` dibulatkan satu desimal persen, 0 bila total 0. Ditampilkan di kartu budget misi sebagai "Cache read 42.1k (18%)".

### Learned skill

`stepSummarize` sekarang membuat artifact `summary:<id>`. Bila `m.learnSkillOnDone`:

- Prompt summarizing ditambah bagian: "After the summary, output a fenced block ```skill ... ``` containing a SKILL.md: YAML frontmatter with name (kebab-case) and description, then numbered steps that reuse what worked in this mission."
- Parser baru `extractSkillBlock(output): string | null` di `lib/orchestrator-parsers.ts`: ambil blok ```` ```skill ````, cek frontmatter punya `name` dan `description`. Bila tidak valid, tidak ada artifact skill dan misi tetap selesai.
- Artifact: `kind: "learned_skill"`, `title: "Learned skill: <name>"`, `dedupeKey: skill:${m.id}`.
- `components/markdown-artifact-viewer.tsx` menampilkan jenis ini dengan tombol Copy. Tidak ada pemasangan otomatis.

Checkbox "Learn a skill when done" ditambah di `components/mission-composer.tsx`, default mati.

### Kontrol task baru

`app/api/missions/[id]/tasks/[taskId]/control/route.ts`:

| Aksi | Isi body | Perilaku |
|---|---|---|
| `approve_tool` (ada) | `requestId?` | `choice: "once"`; `requestId` default ke kontrol pertama |
| `approve_tool_session` | `requestId?` | `choice: "session"`, ditolak 400 bila tidak ada di `choices` |
| `approve_tool_always` | `requestId?` | `choice: "always"`, aturan sama |
| `deny_tool` (ada) | `requestId?` | `choice: "deny"` |
| `fork_session` | `instructions: string` (wajib, 1-4000 karakter), `createBranchTask?: boolean` | lihat di bawah |

`fork_session`:
1. Tolak 409 bila task sedang punya run aktif atau `sessionId` kosong.
2. `newSession = await forkSession(agent, task.sessionId, "Fork: " + task.title)`.
3. Tanpa `createBranchTask`: simpan `instructions` sebagai artifact `kind: "fork_note"`, `dedupeKey: fork:<taskId>:<n>` (`n` = jumlah catatan fork task itu + 1). Lalu update task: `sessionId = newSession`, `stage = "Routed"` (agen yang sama dipakai lagi, router tidak jalan ulang), `runId = null`. Saat `startTaskRun` membangun prompt Coding, catatan fork terbaru task itu ditambahkan sebagai bagian "Try this approach instead:".
4. Dengan `createBranchTask`: buat task baru `"<title> (fork)"` dengan `depends` sama, `agentId` sama, `sessionId = newSession`, stage `Routed`, dan artifact catatan untuk task baru. Task asli tidak diubah.

Semua aksi tetap lewat pemeriksaan peran yang ada di route ini.

---

## 4. Run events dan live log (R4)

### Parser (`lib/run-events.ts`)

```ts
export type LogStepKind = "tool" | "message" | "reasoning" | "commentary" | "subagent"
  | "approval" | "done" | "error" | "info";
export type LogStep = { ...; subagent?: SubagentRun };
```

Urutan cek di `parseRunEvent` (urutan penting karena cek `complete`/`tool` sekarang terlalu luas):

1. `decision` (ada).
2. `subagent.start` / `subagent.complete` → `subagent`. Harus sebelum cek `complete` agar `subagent.complete` tidak dibaca sebagai run selesai.
3. Reasoning: `type === "response.reasoning_summary_text.delta"`, `type === "reasoning.delta"`, `data.reasoning_content` string, atau `data.item?.type === "reasoning"` → `reasoning`, `delta: true` untuk varian delta.
4. Commentary: `message.interim`, `assistant.commentary`, `data.phase === "commentary"` → `commentary`; `already_streamed === true` → `null`.
5. Approval, error, done, tool, message (ada).

`appendStep` menggabungkan `reasoning` berurutan seperti `message` (batas 600 karakter sama). `subagent.complete` dengan `delegation_id` yang sama mengganti kartu `subagent.start` sebelumnya, bukan menambah baris.

### Penyimpanan `subagent_runs`

Event SSE dibaca browser, bukan server. Agar tetap ada setelah reload, orchestrator membaca `getHermesRun` yang sudah dipanggil tiap tick: bila respons membawa `delegations`/`subagents`, isinya dinormalisasi ke `SubagentRun[]`. Bila Hermes tidak mengirimnya di status run, kartu subagent hanya hidup selama stream terbuka, dan `subagent_runs` diisi dari route stream yang sudah ada (`app/api/hermes/runs/[runId]/events/route.ts`): route itu sudah meneruskan SSE, dan ditambah tap yang mem-parse event `subagent.*` lalu `updateTask` (debounce 2 detik, hanya bila berubah).

### UI

- `components/live-log.tsx`: baris `reasoning` = `<details>` tertutup, judul "Thinking", isi `font-mono text-xs text-muted-foreground`. Baris `commentary` = teks miring dengan ikon pesan kecil. Baris `subagent` = kartu cabang dengan garis kiri bercabang (SVG), lencana `.code-chip` untuk `delegation_id` (8 karakter pertama), status, durasi `12s`, token `3.4k`.
- `components/run-inspector-sheet.tsx`: bagian "Sub-agents" dari `task.subagentRuns`, plus baris token cache dan "Ran on <provider>/<model>".
- `components/team-wires.tsx`: prop baru `activeLinks: Array<{ from: string; to?: string }>`. `to` kosong = garis dari agen ke titik "sub-agent". Animasi `stroke-dashoffset` 1.2 detik; di `prefers-reduced-motion` garis hanya berganti warna. Sumber `activeLinks`: langkah `subagent` dengan status `running`, dan langkah `tool` bernama `message_agent` dalam 30 detik terakhir.

---

## 5. Schedules (R5)

### API

`lib/schedules.ts` (baru):

```ts
export async function agentForSchedule(agentId: string | null): Promise<Agent | undefined>;
export async function listAllSchedules(): Promise<Array<ScheduleItem>>;
// ScheduleItem = Record<string, unknown> & { agentId: string | null; agentName: string }
```

`listAllSchedules` mengambil profil default (`agentId: null`, `agentName: "Default"`) dan agen aktif runtime Hermes, dikelompokkan per kunci `url|profile` agar satu profil hanya dibaca sekali. Panggilan berjalan paralel dengan `Promise.allSettled`; profil yang gagal menghasilkan satu item error `{ error, agentName }` agar halaman tetap tampil.

Route:
- `app/api/schedules/route.ts`: `GET` baca `?agentId=`; `POST` baca `body.agentId`, buang field itu sebelum diteruskan.
- `app/api/schedules/[jobId]/route.ts`: `PATCH`, `DELETE`, dan `POST { action: "run" | "pause" | "resume", agentId }`.
- Validasi body di `lib/schedules.ts` `parseScheduleInput(body)`: `name` 1-120 karakter, `schedule` 1-120 karakter, `prompt` 1-8000, `skills` array string, `provider`, `deliver` string opsional. Field lain dibuang.
- Peran: `roleAllows` di proxy sudah memblokir metode non-GET untuk viewer. Route juga memeriksa header peran (`SESSION_HEADERS.role`) agar tetap aman bila dipanggil di luar proxy.

### Prefix bot

`withBotPrefix(name, profile)`: hapus awalan `[bot:...] ` yang sudah ada, lalu tambah `[bot:<profile>] `. Dipakai saat agen dipilih dan profilnya bukan default.

### UI (`components/schedules-manager.tsx`)

- Teks "read-only" dihapus untuk mode live; mode demo tetap menampilkan alasannya.
- Dialog form baru `ScheduleDialog` (shadcn `Dialog`, komponen yang sudah ada di `components/ui`). Preset: `every 1h`, `0 9 * * *`, `0 9 * * 1-5`, Custom (input cron). Skills: multi-pill dari `GET /api/agents/capabilities?agentId=` (bagian 6). Delivery target: input teks dengan placeholder `telegram:<chat id>` / `slack:<channel>` / `local`.
- Kolom baru "Bot" di tabel (nama agen + robot kecil).
- Delete memakai `components/delete-button.tsx` (sudah ada konfirmasi). Semua aksi: `toast.success`/`toast.error` lalu `live.reload()`.

---

## 6. AI team: probe, effort, pill (R6)

### API

`app/api/agents/capabilities/route.ts` (baru, `GET`):
- `await connection()`, baca `agentId` (wajib) dari query.
- Ambil agen, panggil `getCapabilities` dan `getInventory` paralel.
- Respons: `{ capabilities: HermesServerCapabilities, skills, toolsets: { core: HermesToolsetInfo[], mcp: HermesToolsetInfo[] } }`. Tidak ada `url`, `key_enc`, atau `details` mentah.

`app/api/agents/[id]/probe/route.ts` (ada): respons ditambah `readiness`, `capabilities`, `skills`, `toolsets`, diambil paralel.

`app/api/agents/route.ts` dan `app/api/agents/[id]/route.ts`: terima `reasoningEffort` (harus anggota `REASONING_EFFORTS` atau null) dan `serviceTier` (maks. 40 karakter, `[a-z0-9_-]`).

### UI

- `components/agents-manager.tsx` form: select "Reasoning effort" (Default + 8 nilai) dan input "Service tier" untuk agen Hermes. Agen CLI tetap melihat select `effort` yang sekarang.
- Bagian "Skills & tools" di form agen: tiga grup pill (Skills, Core toolsets, MCP servers). Pill aktif = `enabled !== false`. Klik pill memanggil route yang sudah ada `app/api/agents/[id]/skills` (enable/disable skill) atau `app/api/agents/[id]/addons` (toolset/MCP). Setelah sukses, inventaris dimuat ulang. Toolset MCP yang `configured === false` diberi tanda "needs key" yang membuka form API key MCP yang sudah ada (`lib/hermes-mcp-keys.ts`).
- Dialog Preview: mode live memanggil probe dan menampilkan kartu latensi, readiness (ikon status per baris), flag kapabilitas (chip hijau/abu), skills, toolset dengan daftar tool yang bisa dilipat. Mode demo memakai konten sekarang dengan `DataSourceBadge`.
- `components/gateway-monitor.tsx` "Sample agent capabilities": saat live, satu baris per agen dengan jumlah skills, toolset, MCP, dan flag penting (`run_approval`, `run_unknown_resolution`, `reasoning_streaming`), diambil dari route capabilities per agen (paralel, maks. 4 sekaligus). Saat demo, konten contoh sekarang.

---

## 7. Bot Mode di `/chat` (R7)

### Modul baru

| File | Tugas |
|---|---|
| `lib/bots.ts` | Roster bot, handle, `ensureCanonicalSession`, `archiveCanonicalSession`, format atribusi |
| `lib/mentions.ts` | Parse `@handle`, `@all`/`@everyone`, `@user`, direktif stop/pause. Murni, tanpa I/O |
| `lib/rooms-store.ts` | CRUD `bot_rooms` / `bot_room_messages` lewat `getSupabaseAdmin()` |
| `lib/rooms.ts` | Driver room (murni + deps yang disuntik, seperti orchestrator) |
| `app/api/bots/route.ts` | `GET` roster |
| `app/api/bots/[agentId]/route.ts` | `GET` riwayat sesi kanonis, `POST { message, images? }` kirim pesan |
| `app/api/bots/[agentId]/session/route.ts` | `POST { action: "compact" | "archive" }` |
| `app/api/rooms/route.ts` | `GET` daftar, `POST` buat room |
| `app/api/rooms/[roomId]/route.ts` | `GET` room + pesan, `PATCH` (nama, anggota, pinned, section), `DELETE` |
| `app/api/rooms/[roomId]/messages/route.ts` | `POST` pesan pengguna (memulai driver) |
| `app/api/rooms/[roomId]/control/route.ts` | `POST { action: "stop" | "resume" | "to_mission" }` |

Master prompt menyebut `app/api/rooms/[roomId]/turn/route.ts`. Desain ini memakai `messages` untuk pesan masuk dan menjalankan giliran di tick, karena giliran bot bisa butuh menit dan route handler tidak boleh menunggu selama itu.

### Handle

`handleOf(agent)` = nama agen huruf kecil, hanya `[a-z0-9-]`, maks. 24 karakter (misalnya `Neiro PM` → `neiro-pm`). Bila dua agen menghasilkan handle sama, yang dibuat belakangan diberi akhiran `-2`. Daftar di master prompt (`@neiro`, `@scribe`, ...) adalah contoh; handle nyata selalu dari nama agen di database.

### Sesi kanonis

`ensureCanonicalSession(agent)`:
1. Bila `canonicalSessionId` ada, kembalikan.
2. Buat sesi `Bot Chat: <nama>` lewat `createSession`.
3. `UPDATE agents SET canonical_session_id = $new WHERE id = $id AND canonical_session_id IS NULL RETURNING canonical_session_id`. Bila tidak ada baris kembali (kalah balapan), baca ulang dan pakai yang tersimpan. Sesi yang kalah dibiarkan (tidak dihapus).

Pesan bot memakai `startRun` dengan `sessionId` kanonis dan `sessionKey: neiro:bot:<agentId>`, lalu disimpan di `ask_questions` seperti chat biasa (`chat_kind` tidak perlu: chat bot dikenali dari `session_id` yang sama dengan `canonical_session_id`). Riwayat diambil dari `getHermesSessionMessages(..., { includeCompacted: true })`.

Compact: `compactSession` (perintah `/compact` lewat session chat). Archive: konfirmasi di UI, lalu buat sesi baru dan `UPDATE` tanpa syarat `IS NULL`.

### Mention ke bot lain

`lib/mentions.ts`:

```ts
export type ParsedMentions = { handles: string[]; all: boolean; user: boolean;
  stops: Array<{ handle: string | "room"; kind: "stop" | "pause" }> };
export function parseMentions(text: string, known: readonly string[]): ParsedMentions;
```

Handle tidak dikenal diabaikan. Saat pesan berisi mention, instruksi run ditambah blok:

```
Your teammates (mention one with @handle to hand off):
- @forge — Forge Backend (Coding)
...
When you relay another bot's words, prefix them with: Message from 🤖 <Sender> (@<handle>):
```

Picker `@` di `components/chat-view.tsx` dan `components/task-chat.tsx`: komponen baru `components/mention-input.tsx` (textarea + popover). Muncul saat mengetik `@` di awal kata, filter dengan huruf berikutnya, panah atas/bawah dan Enter memilih, Escape menutup. Popover memakai `role="listbox"` dan `aria-activedescendant`.

### Driver room

Semua logika di `lib/rooms.ts`, dipanggil `advanceRooms()` dari `runTick()` setelah `runCodeReviews`.

Konstanta: `MAX_ROUNDS = 3`, `MAX_REPLIES = 10`, `TURN_TIMEOUT_MS = 10 * 60_000`.

Saat pesan pengguna masuk (`POST messages`):
1. Simpan pesan. Parse mention.
2. Terapkan direktif stop/pause ke `driver.paused` (atau hentikan room).
3. Bila `driver` aktif, pesan ini masuk transkrip dan antrean putaran sekarang diganti mulai putaran berikut (driver tidak dimulai dua kali).
4. Bila tidak aktif: `driver = { triggerMessageId, round: 1, queue, replies: 0, passesThisRound: 0, paused, claim: null }`. `queue` = bot yang di-mention (urutan sesuai teks); tanpa mention atau `@all` = semua anggota sesuai urutan `member_agent_ids`. Bot di `paused` dibuang dari antrean.
5. `needs_you` diset false.

Satu langkah `advanceRoom(room)` per tick (maks. satu run per room per tick, agar tick tetap cepat):

```
driver null atau needs_you → selesai
claim ada:
  run = getRun(...)
  belum selesai → (timeout? catat pesan system "<bot> timed out", lepas claim) selesai
  butuh approval → needs_you = true, pesan system, selesai
  selesai → teks = output.trim()
     teks == "PASS" (tanpa beda huruf, boleh titik) → passesThisRound++
     selain itu → simpan pesan bot, replies++, parse mention di balasan:
         @user → needs_you = true, driver selesai
         mention bot lain di room → bot itu ditambah ke antrean putaran berikutnya
  claim = null
antrean kosong:
  passesThisRound == jumlah giliran putaran ini → driver selesai (hening)
  round == MAX_ROUNDS → driver selesai
  round++, queue = anggota yang tidak di-pause (+ bot yang di-mention di putaran ini, tanpa duplikat)
replies >= MAX_REPLIES → driver selesai, pesan system "Room paused after 10 replies"
ambil bot berikutnya dari queue → sesi room bot (member_sessions[agentId], buat bila belum ada)
  prompt = transkrip sejak giliran terakhir bot itu + aturan room
  startRun(..., { sessionId, sessionKey: neiro:room:<roomId> }) → claim
```

Semua update `driver` memakai pembaruan bersyarat `updated_at = <nilai lama>` agar dua tick yang bersamaan tidak menjalankan giliran yang sama (R7.12). Gagal update = tick lain sudah maju, langkah ini berhenti tanpa efek.

Aturan room yang ditambah ke instruksi bot:

```
You are in a group room with: <daftar handle>. Reply only if you add something new,
in at most 6 sentences. If you have nothing to add, reply with exactly PASS.
Mention @user only when a human must decide.
```

Stop room (`control: stop`) = `driver = null`, run aktif dihentikan lewat `stopRun`. `resume` = `needs_you = false`, driver lanjut dari keadaan tersimpan.

`to_mission`: transkrip room (maks. 200 pesan terakhir, maks. 20.000 karakter) menjadi `prompt` misi baru lewat jalur pembuatan misi yang ada (`lib/mission-input.ts`), lalu `advanceMission`. Respons membawa `missionId`, UI pindah ke misi itu.

Needs you: `lib/needs-you.ts` mendapat jenis `room_needs_you`, dibangun dari room dengan `needs_you = true`.

### UI (`components/chat-view.tsx`)

- Sidebar kiri mendapat tab (komponen `Tabs` yang ada): Bots, Group rooms, Project threads. Isi daftar chat sekarang pindah ke Project threads tanpa perubahan perilaku, termasuk `?chat=<id>`.
- Tab Bots: kelompok per `bot_section` (tanpa section = "Team"). Baris: `AgentBot` dengan `agentLook(lookRole(a))`, nama, peran, titik status (bekerja = berdenyut, diam = statis), cuplikan pesan terakhir satu baris.
- Tab Group rooms: daftar room, room `pinned` di atas, lencana Needs you oranye. Tombol New room membuka dialog: nama, pilih 2-6 bot (pill dengan robot), section opsional.
- Panel kanan bot: header dengan tombol Compact context dan Archive & start fresh (menu titik tiga, Archive memakai dialog konfirmasi).
- Panel kanan room: pesan dikelompokkan per pengirim dengan robot pengirim, pesan system abu kecil, indikator "<bot> is thinking…" dari `driver.claim`, tombol Stop room / Resume, dan Convert to mission. Polling `GET /api/rooms/[roomId]` tiap 3 detik saat driver aktif, 15 detik saat diam.
- Layout lebar penuh dan neumorphism seperti halaman `/chat` sekarang.

---

## 8. Bot dua arah dan gambar (R8)

### Notifikasi keluar

`NotificationEvent` mendapat `actions?: NotificationAction[]`:

```ts
export type NotificationAction = {
  id: "approve_plan" | "approve_tool_once" | "approve_tool_always" | "deny_tool" | "retry_task";
  label: string;
  target: string;        // missionId atau taskId
  requestId?: string;
};
```

Daftar `id` di atas juga berisi `"approve_route"`. Orchestrator mengisi `actions` untuk:

| Event | Tombol |
|---|---|
| `plan_ready` | Approve plan |
| `task_needs_you` karena approval | Approve once, Approve always (bila ada di `choices`), Deny |
| `task_needs_you` karena gagal | Retry task |
| `routing_needs_you` | Approve route |

`actions` juga disimpan di `notifications.actions`.

`webhookPayload` tetap mengembalikan field sekarang, ditambah:

- `blocks`: Slack Block Kit (`section` teks + `actions` dengan `button`, `value` = token aksi).
- `components`: Discord action row dengan tombol `style: 1/4`, `custom_id` = token aksi.

Slack dan Discord menolak field yang tidak dikenal di beberapa URL webhook. Karena satu URL dipakai untuk semua, `lib/notifications-store.ts` membaca `NEIRO_NOTIFY_WEBHOOK_FORMAT` (`generic` default, `slack`, `discord`) dan hanya mengirim field milik format itu. `generic` = isi sekarang + `actions`.

Token aksi: `<a>.<target>[.<requestId>]` dengan `a` kode satu huruf (`p` approve_plan, `r` approve_route, `o` once, `a` always, `d` deny, `t` retry). Telegram membatasi `callback_data` 64 byte. Bila token lebih panjang, tombol membawa `n.<notificationId>.<index>`, dan webhook membaca aksi lengkapnya dari `notifications.actions[index]`.

Telegram (`lib/telegram.ts`, baru): bila `NEIRO_TELEGRAM_BOT_TOKEN` dan `NEIRO_TELEGRAM_CHAT_ID` diisi, `supabaseNotifier` juga memanggil `sendMessage` dengan `reply_markup.inline_keyboard`. Timeout 5 detik, gagal hanya dicatat di log server. Token tidak pernah dicatat.

### Webhook masuk

`app/api/bot/webhook/route.ts` (`POST`):

1. Baca `NEIRO_BOT_WEBHOOK_SECRET`. Kosong → 503 `{ error: "Bot webhook is not configured" }`.
2. Bandingkan dengan `X-Telegram-Bot-Api-Secret-Token` atau `X-Neiro-Bot-Secret` memakai `timingSafeEqualString` dari `lib/auth.ts`. Tidak cocok → 401, tanpa membaca body lebih lanjut.
3. Batas body 64 KB.
4. Telegram: `message.text` → perintah; `callback_query.data` → token aksi. Chat id harus sama dengan `NEIRO_TELEGRAM_CHAT_ID`, selain itu diabaikan (200 kosong, agar Telegram tidak mengulang).
5. Generik: `{ text }` → perintah, `{ action }` → token aksi.
6. Jalankan lewat `lib/bot-commands.ts`, balas lewat `sendMessage` (Telegram) atau JSON `{ reply }` (generik). `callback_query` dijawab `answerCallbackQuery`.

`lib/bot-commands.ts` (murni, deps disuntik):

```ts
export type BotCommand =
  | { kind: "mission"; prompt: string } | { kind: "status"; missionId?: string }
  | { kind: "approve"; id: string } | { kind: "deny"; taskId: string }
  | { kind: "clarify"; taskId: string; answer: string } | { kind: "ask"; handle?: string; question: string }
  | { kind: "help" };
export function parseBotCommand(text: string): BotCommand;
export async function runBotCommand(cmd: BotCommand, deps: BotDeps, source: BotSource): Promise<string>;
```

- `/approve <id>`: id misi dengan status `awaiting_plan_approval` → approve plan; id task di gate rute → `approveRoute`; id task dengan approval tertunda → `choice: "once"`. Id tidak ditemukan → pesan jelas.
- `/ask`: menjalankan run seperti `/api/ask`, menyimpan baris `ask_questions` dengan `reply_to = telegram:<chatId>`, lalu membalas "Asked <bot>. I will reply here when it is done." Fungsi baru `deliverBotReplies()` di `runTick()` mencari baris dengan `reply_to` terisi, `reply_sent_at` kosong, dan run sudah selesai (status dibaca lewat `getRun`, sama seperti `app/api/questions/route.ts`). Jawaban dikirim, lalu `reply_sent_at` diisi dengan pembaruan bersyarat `reply_sent_at IS NULL` agar terkirim sekali. Jawaban lebih dari 3.500 karakter dipotong dengan tautan ke `/chat?chat=<id>`.
- Setiap aksi dicatat `safeNotify` jenis baru `bot_action` dengan `body` berisi sumber (`telegram`/`generic`).
- Semua aksi memakai fungsi yang sama dengan route dashboard (bukan memanggil route lewat HTTP).

### Proxy

`proxy.ts`: fungsi baru `isBotWebhookRequest(request)` = path `/api/bot/webhook`, metode `POST`, dan secret header cocok (`timingSafeEqualString`). Bila benar, lolos tanpa cookie dengan header sesi dihapus (seperti `isExemptPath`). Bila salah, jalur cookie biasa (hasilnya 401 untuk bot). `DASHBOARD_SECRET` tidak dipakai.

### Gambar

`lib/attachments.ts` (baru, dipakai browser dan server):

```ts
export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export function validateAttachments(input: unknown): { ok: true; images: ImageAttachment[] } | { ok: false; error: string };
```

Validasi: format `data:<type>;base64,<data>`, tipe ada di daftar, ukuran = `floor(len(data) * 3 / 4) - padding`. Server selalu memvalidasi ulang. Nama dipotong 120 karakter.

UI: `components/attach-images.tsx` (tombol klip + tempel dari clipboard + seret-lepas, pratinjau kecil dengan tombol hapus). Dipasang di `components/mission-composer.tsx` dan `components/chat-view.tsx`.

- Misi: `POST /api/missions` menerima `attachments`, disimpan di `missions.attachments`, dikirim sebagai `images` pada run planning pertama saja.
- Chat bot dan chat biasa: dikirim sebagai `images` pada `startRun`.
- Gambar besar menambah ukuran baris; daftar misi (`GET /api/missions`) tidak memilih kolom `attachments`, hanya detail misi.

---

## 9. Keamanan

| Risiko | Penanganan |
|---|---|
| Kunci bocor ke browser | Route baru hanya mengembalikan DTO yang dipilih, tidak pernah objek `Agent` mentah. Test respons route capabilities dan probe memastikan tidak ada `key_enc`/`url` |
| Webhook palsu | Secret wajib, perbandingan waktu konstan, chat id Telegram harus cocok, batas body |
| Header injection | `cleanSessionKey` membuang `\r\n\0` |
| Viewer mengubah data | `roleAllows` di proxy + cek peran di route mutasi baru |
| Gambar berbahaya | Hanya data URL gambar dengan tipe terdaftar, ukuran dibatasi, tidak pernah dirender sebagai HTML |
| Room berputar tanpa henti | Batas putaran, batas balasan, timeout giliran, pembaruan bersyarat |
| Prompt injection dari chat app | Perintah dari bot hanya memicu aksi yang sama dengan tombol dashboard. Teks bebas hanya masuk ke `prompt` misi/pertanyaan |

## 10. Pengujian

Pola test sekarang: `bun test --conditions=react-server`, file `*.test.ts` di `lib/`, fetch di-stub lewat `globalThis.fetch`.

| File | Isi |
|---|---|
| `lib/hermes.test.ts` (baru) | header session key + pembersihan, `model_options` gabungan, tidak ada `skills`/`toolsets`, input multimodal + fallback teks, pilihan approval + pemetaan boolean, `resolveHermesUnknownRun` 2xx/4xx, parsing capabilities/inventaris dua bentuk respons |
| `lib/orchestrator.test.ts` (tambah) | `sessionKey` proyek vs misi, pemulihan `unknown` (berhasil, gagal, tanpa fitur), dedupe notifikasi per `requestId`, simpan token cache dan model runtime, learned skill valid/tidak valid |
| `lib/run-events.test.ts` (baru) | subagent start/complete, `subagent.complete` tidak jadi `done`, reasoning delta digabung, commentary, `already_streamed` |
| `lib/mentions.test.ts` (baru) | handle, `@all`, `@user`, stop/pause, handle tak dikenal |
| `lib/rooms.test.ts` (baru) | batas 3 putaran, batas 10 balasan, putaran hening, mention putaran pertama, `@user` menghentikan, stop, pembaruan bersyarat yang kalah |
| `lib/bot-commands.test.ts` (baru) | parse semua perintah, `/approve` ke tiga target, perintah tak dikenal → help |
| `lib/bot-webhook.test.ts` (baru) | secret kosong 503, salah 401, chat id lain diabaikan, callback token |
| `lib/attachments.test.ts` (baru) | tipe, jumlah, ukuran, data URL rusak |
| `lib/schedules.test.ts` (baru) | `withBotPrefix`, `parseScheduleInput`, gabungan profil unik |

Pemeriksaan akhir dijalankan satu per satu karena RAM host kecil: `bun run test`, `bunx next typegen`, `bunx tsc --noEmit`, `bun run lint`, `bun run build`.

## 11. Variabel lingkungan baru

Ditambah ke `.env.example` (tanpa nilai):

```
NEIRO_BOT_WEBHOOK_SECRET=
NEIRO_TELEGRAM_BOT_TOKEN=
NEIRO_TELEGRAM_CHAT_ID=
NEIRO_NOTIFY_WEBHOOK_FORMAT=generic
```

Tidak ada yang berawalan `NEXT_PUBLIC_`.
