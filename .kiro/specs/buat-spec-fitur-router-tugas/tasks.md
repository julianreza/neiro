# Router tugas dengan Laya — Tasks

Urutan di bawah dikerjakan dari atas ke bawah. Tiap tugas selesai bila kriteria "Selesai bila" terpenuhi. Acuan: `requirements.md`.

## 1. Vendor laya-ts — selesai (commit `b9fe351`)

- Salin folder `laya-ts` dari repo `NandhaKishorM/laya` (satu commit yang dipin) ke `vendor/laya-ts`.
- Tulis `vendor/laya-ts/VENDORED.md`: URL repo, SHA commit, tanggal, dan cara memperbarui.
- Tambah `"laya-ts": "file:./vendor/laya-ts"` ke `dependencies` di `package.json`, lalu `bun install`. Bila paket butuh lifecycle script, tambahkan namanya ke `trustedDependencies`.
- Baca `vendor/laya-ts` untuk memastikan tanda tangan `Agent.load(path)` dan `agent.decide(text, jsonSchema)` serta bentuk hasilnya. Catat bentuk hasil itu di `VENDORED.md`.
- **Selesai bila:** `bun install` sukses, `bun.lock` diperbarui, `import { Agent } from "laya-ts"` lolos `tsc`.

## 2. Migrasi schema — selesai

- Di `supabase/schema.sql`, tambah bagian `9. Migration: task router (Laya)` setelah bagian 8:
  - `ALTER TABLE mission_tasks ADD COLUMN IF NOT EXISTS` untuk `routing_status`, `laya_agent_id`, `human_agent_id`, `route_urgency`, `route_needs_human`, `route_confidence`, `route_reason`, `routed_at`.
  - Blok `DO $$` dengan constraint `mission_tasks_route_urgency_chk` (0–2), `mission_tasks_route_confidence_chk` (0–1), `mission_tasks_routing_status_chk` (`NULL` atau `routing`, `routed`, `awaiting`, `fallback`, `approved`, `overridden`), masing-masing di balik `IF NOT EXISTS (pg_constraint ...)`.
  - `CREATE OR REPLACE FUNCTION neiro_claim_task` yang sama dengan bagian 8.4, kecuali `WHERE ... AND stage IN ('Queued', 'Routed')`. Ulangi blok `REVOKE`/`GRANT`.
- **Selesai bila:** isi file bisa dijalankan dua kali tanpa error (cek dengan membaca: tiap perintah memakai `IF NOT EXISTS` / `OR REPLACE`).

## 3. Tipe dan store — selesai

- `lib/types.ts`: tambah `"Routed"` dan `"Awaiting routing"` ke `TaskStage`. Tambah tipe `RoutingStatus` dan field opsional di `MissionTask`: `routingStatus`, `layaAgentId`, `humanAgentId`, `routeUrgency`, `routeNeedsHuman`, `routeConfidence`, `routeReason`, `routedAt`.
- `lib/orchestrator-store.ts`:
  - `mapTaskRow` memetakan kolom baru (`null` bila kosong).
  - `TaskPatch` + `taskPatchToRow` mendukung semua field routing.
  - `TaskGuard` dapat field opsional `routingStatus`; `updateTaskIf` menambah filter `routing_status` (`.is(null)` atau `.eq`) bila diberikan.
  - Method baru `listAllEnabledAgents(): Promise<Agent[]>` (enabled, semua stage).
- `lib/test-fakes/memory-store.ts`: dukung field baru, guard `routingStatus`, `listAllEnabledAgents`, dan aturan klaim `stage` `Queued` atau `Routed`.
- `lib/demo-missions.ts`: masukkan dua stage baru ke `stages`; tambah satu contoh tugas `Routed` dan satu `Awaiting routing` dengan data routing lengkap.
- **Selesai bila:** `bunx next typegen && bunx tsc --noEmit` lolos; test lama lolos.

## 4. Modul router — selesai

- File baru `lib/task-router.ts`, baris pertama `import "server-only";`.
- Ekspor:
  - `type RouteDecision = { agentId: string; urgency: 0 | 1 | 2; needsHuman: boolean; confidence: number }`.
  - `interface TaskRouter { decide(task: MissionTask, agents: Agent[]): Promise<RouteDecision> }`.
  - `isRouterEnabled(): boolean` — `false` bila `NEIRO_ROUTER === "off"` atau `NEIRO_LAYA_MODEL_PATH` kosong.
  - `buildDecisionSchema(agents: Agent[])` — JSON Schema `{ type: "object", properties, required }` dengan `agent_id` (`type: "string"`, `enum` ID agen), `urgency` (`type: "integer"`, `minimum: 0`, `maximum: 2`), `needs_human` (`type: "boolean"`); ketiganya `required`. Tidak ada field `confidence`.
  - `buildRouteText(task)` — judul, `result`, dan `agentName`.
  - `parseDecision(result: DecisionResult, agents)` — baca `result.values` dan `result.confidence.agent_id`; `agent_id` di luar daftar atau `urgency` di luar 0–2 → lempar error; confidence hilang/bukan angka → 0.
  - `createLayaRouter()` — singleton: promise `Agent.load(process.env.NEIRO_LAYA_MODEL_PATH)` disimpan di variabel modul; bila load gagal, variabel dikosongkan agar dicoba lagi. `decide` dibungkus timeout `NEIRO_ROUTER_TIMEOUT_MS` (bawaan 5000) dan memanggil `agent.decide(text, schema, { returnDetails: true })` tanpa `minConfidence`.
  - `routeOutcome(decision)` — `"routed"` bila `confidence >= 0.7 && !needsHuman`, selain itu `"awaiting"`, plus teks `route_reason`.
- Laya hanya dimuat lewat `import("laya-ts")` dinamis di dalam `createLayaRouter`, agar tidak dimuat saat router mati.
- **Selesai bila:** `tsc` lolos; tidak ada file `"use client"` yang mengimpor `lib/task-router.ts` (cek dengan `grep`).

## 5. Integrasi orchestrator — selesai

- `lib/orchestrator.ts`:
  - `OrchestratorDeps` dapat `router: TaskRouter | null`. `resolveDeps` memakai `createLayaRouter()` bila `isRouterEnabled()`, selain itu `null`. Test bisa menyuntik router palsu.
  - Di `stepTask`, untuk `Queued` saat `d.router` ada:
    1. Tunggu dependensi `Done` (seperti sekarang).
    2. Bila `routingStatus === "routing"` dan `routedAt` lebih tua dari 5 menit → lepas ke `NULL`; selesai.
    3. Bila `routingStatus` bukan `NULL` → lewati.
    4. Kunci: `updateTaskIf(id, { stage: "Queued", runId: null, routingStatus: null }, { routingStatus: "routing", routedAt: now })`. Gagal → selesai.
    5. Ambil `listAllEnabledAgents()`, panggil `d.router.decide`, lalu tulis hasil sesuai `routeOutcome` dengan guard `routingStatus: "routing"`.
    6. Error/timeout/hasil tidak valid → `pickStageAgent("workers", task.agentName)`. Ada agen → `Routed`, `fallback`, `route_reason` = pesan error. Tidak ada → kembalikan `routingStatus` ke `NULL` dan tambah `ctx.problems`.
  - Klaim: saat router aktif, `claimTask` hanya untuk tugas `Routed`; saat mati, tetap `Queued`.
  - `stepTasks` melewati tugas `Awaiting routing` seperti `Needs you`.
  - `pickTaskAgent` untuk `Coding`: pakai agen `task.agentId` dari `listAllEnabledAgents()` bila `routingStatus` terisi dan agen masih enabled; selain itu alur lama.
  - Poll `Coding`: cari pemilik `runAgentId` di `listAllEnabledAgents()` (QA/review tetap per stage).
  - `failAttempt`: retry ke `Routed` bila `task.routingStatus` terisi, selain itu `Queued`.
- **Selesai bila:** semua test lama lolos dengan `NEIRO_ROUTER=off` dan tanpa router tersuntik.

## 6. Aksi gerbang manusia — selesai

- `app/api/missions/[id]/tasks/[taskId]/control/route.ts`:
  - Tambah `approve_route` dan `override_route` ke `validActions`.
  - Untuk dua aksi ini, cek `isAuthorizedRequest(request)` dulu → 401 bila gagal.
  - `approve_route`: update terjaga (`stage = 'Awaiting routing'`) ke `Routed`, `agent_id`/`agent_name`/`model` dari agen `laya_agent_id`, `routing_status = 'approved'`. Agen Laya sudah tidak enabled → 409 dengan pesan "Pilih agen lain".
  - `override_route`: `agentId` wajib string dan agen enabled → selain itu 400. Update terjaga ke `Routed`, `agent_id`/`agent_name`/`model` dari agen itu, `human_agent_id = agentId`, `routing_status = 'overridden'`.
  - Tidak ada baris yang cocok dengan guard → 409.
  - Setelah sukses, panggil `advanceMission(missionId)` seperti aksi lain.
- Logika update ditaruh di fungsi `approveRoute` / `overrideRoute` di `lib/orchestrator.ts` yang memakai `OrchestratorStore`, agar bisa dites dengan memory store.
- **Selesai bila:** `tsc` lolos; fungsi bisa dipanggil dari test.

## 7. UI — selesai

- `components/mission-workspace.tsx`:
  - `stageColors`: `Routed` (teal), `Awaiting routing` (kuning).
  - Komponen `TaskRouteFlow` (Pilihan 3): baris Tugas → Laya → Agen. Titik berjalan selama `routingStatus === "routing"`. Chip urgensi Rendah/Sedang/Tinggi dan chip "tanpa manusia" bila `routeNeedsHuman === false`. Chip "fallback" bila `routingStatus === "fallback"`.
  - Komponen `RoutingGateCard` (Pilihan 5) untuk tiap tugas `Awaiting routing`: garis kuning, label `.eyebrow` "Gerbang manusia", judul tugas, agen usulan di `.code-chip`, `routeReason`, skor keyakinan. Tombol `Button` flat teal "Setujui" dan `Button variant="outline"` "Ganti agen" yang membuka pilihan agen enabled per stage. Tombol nonaktif saat request berjalan; hasil lewat `toast` dari `sonner`.
  - Kirim aksi ke `POST /api/missions/[id]/tasks/[taskId]/control`.
- `app/globals.css`: keyframe titik berjalan, dimatikan di `@media (prefers-reduced-motion: reduce)`.
- Ikuti gaya yang ada: abu netral, teal, tombol flat, `.eyebrow`, `.code-chip`.
- **Selesai bila:** halaman misi menampilkan alur dan gerbang dengan data demo; `bun run lint` lolos.

## 8. Test — selesai

- File baru `lib/task-router.test.ts`: `buildDecisionSchema` (enum dari agen enabled, tanpa field `confidence`), `parseDecision` (tolak agen asing dan urgency di luar rentang; confidence hilang → 0), `routeOutcome` (batas 0.7), `isRouterEnabled`.
- File baru `lib/orchestrator-router.test.ts` dengan memory store, `fake-hermes`, dan router palsu:
  1. Routing sukses → `Routed`, agen benar, lalu `Coding` oleh agen itu.
  2. Confidence 0.5 → `Awaiting routing`, tetap tidak diklaim setelah 3 tick.
  3. `needsHuman: true`, confidence 0.95 → `Awaiting routing`, tidak diklaim.
  4. Router melempar error dan router yang tidak pernah selesai (timeout) → `Routed`, `fallback`, agen default.
  5. `overrideRoute` → `humanAgentId` dan `layaAgentId` tersimpan, tugas diklaim oleh agen manusia.
  6. Dua `advanceMission` bersamaan → `decide` dipanggil tepat sekali.
  7. Gagal QA → kembali ke `Routed`, `decide` tidak dipanggil lagi.
  8. Router `null` → alur lama `Queued` → `Coding`.
- **Selesai bila:** `bun test` lolos.

## 9. Env dan verifikasi akhir — selesai

- Tambah `NEIRO_ROUTER`, `NEIRO_LAYA_MODEL_PATH`, `NEIRO_ROUTER_TIMEOUT_MS` beserta penjelasan ke `.env.example` (buat bila belum ada; tanpa nilai rahasia).
- Jalankan, satu per satu karena RAM terbatas: `bun run lint`, `bunx next typegen && bunx tsc --noEmit`, `bun test`, lalu `NEIRO_ROUTER=off bun test`.
- Ingatkan pengguna untuk menjalankan ulang `supabase/schema.sql` di proyek Supabase sebelum tick memakai router.
- **Selesai bila:** keempat perintah lolos.
