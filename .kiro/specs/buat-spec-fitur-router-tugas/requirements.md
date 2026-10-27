# Router tugas dengan Laya — Requirements (quick spec)

## Tujuan

Sebelum orchestrator mengklaim tugas, Laya memilih agen pekerja untuk tugas itu.
Pilihan yang yakin langsung jalan. Pilihan yang ragu, atau yang butuh manusia,
berhenti di gerbang manusia. Laya hanya memilih; orchestrator
(`lib/orchestrator.ts`) tetap satu-satunya yang menjalankan tugas.

## Alur stage

```
Queued (agent_id kosong)
  └─ Laya memutuskan ──┬─ confidence ≥ 0.7 dan needs_human = false → Routed → klaim → Coding …
                       ├─ confidence < 0.7 atau needs_human = true → Awaiting routing
                       │      ├─ Setujui    → Routed (agen Laya)
                       │      └─ Ganti agen → Routed (agen manusia)
                       └─ error / timeout → Routed (agen default, routing_status = fallback)
```

## Kriteria terima

### Schema (`supabase/schema.sql`, bagian migrasi baru, idempotent)

- `mission_tasks` dapat kolom baru lewat `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`:
  - `routing_status TEXT` — `NULL` (belum dirouting), `routing`, `routed`, `awaiting`, `fallback`, `approved`, `overridden`.
  - `laya_agent_id TEXT` — pilihan asli Laya (tidak pernah ditimpa).
  - `human_agent_id TEXT` — pilihan manusia saat "Ganti agen".
  - `route_urgency INT` (0–2), `route_needs_human BOOLEAN`, `route_confidence REAL` (0–1).
  - `route_reason TEXT` — alasan yang ditampilkan di gerbang.
  - `routed_at TIMESTAMPTZ`.
- Constraint `CHECK` untuk `route_urgency` 0–2, `route_confidence` 0–1, dan nilai `routing_status`, dibuat di blok `DO $$ ... IF NOT EXISTS (pg_constraint) $$` seperti pola 8.1.
- `neiro_claim_task` di-`CREATE OR REPLACE` agar menerima `stage IN ('Queued', 'Routed')`. Stage `Awaiting routing` tidak pernah bisa diklaim.
- Menjalankan `schema.sql` dua kali tidak error.

### Tipe & store

- `TaskStage` di `lib/types.ts` dapat `"Routed"` dan `"Awaiting routing"`; `MissionTask` dapat field routing (camelCase) yang dipetakan di `mapTaskRow`.
- `TaskPatch` + `taskPatchToRow` di `lib/orchestrator-store.ts` mendukung semua kolom routing.
- `lib/test-fakes/memory-store.ts` meniru kolom baru dan aturan klaim baru (`Queued` atau `Routed`, bukan `Awaiting routing`).
- Daftar stage di `lib/demo-missions.ts` dan warna stage di `components/mission-workspace.tsx` memuat dua stage baru.

### Router (server saja)

- `laya-ts` divendor ke `vendor/laya-ts` dari repo `NandhaKishorM/laya` pada satu commit yang dipin (SHA dicatat di `vendor/laya-ts/VENDORED.md`), lalu dipasang lewat `"laya-ts": "file:./vendor/laya-ts"` di `package.json`. Bila paket butuh lifecycle script, namanya ditambahkan ke `trustedDependencies`.
- Modul baru `lib/task-router.ts` diawali `import "server-only"`. Tidak ada file client (`"use client"`) yang mengimpornya, langsung maupun tidak langsung.
- Model Laya dimuat sekali per proses lewat `Agent.load(NEIRO_LAYA_MODEL_PATH)` dalam singleton (promise di-cache; load gagal tidak di-cache selamanya, dicoba lagi pada tick berikut).
- Skema keputusan dibuat per panggilan dari semua agen `enabled = true` (semua stage), lewat method store baru `listAllEnabledAgents()`: `agent_id` berupa enum ID agen itu, `urgency` integer 0–2, `needs_human` boolean. Skema tidak punya field `confidence`: Laya hanya menerima pilihan, boolean, dan integer berbatas. Confidence diambil dari `agent.decide(text, schema, { returnDetails: true })` sebagai `result.confidence.agent_id` (0–1). Nilai yang hilang atau bukan angka dianggap 0, jadi tugas masuk gerbang manusia. `minConfidence` tidak dipakai, agar `agent_id` tidak berubah jadi `null`. Tidak ada ID agen yang di-hardcode.
- Input teks ke Laya: judul tugas, `result` (deskripsi tugas), dan `agent_name` (specialty dari planner).
- Router dipanggil dari `stepTasks` hanya untuk tugas `stage = 'Queued'`, `routing_status IS NULL`, dan dependensi sudah `Done`. Tugas yang sudah dirouting tidak pernah memanggil Laya lagi, termasuk di tick berikutnya.
- Sebelum memanggil Laya, tick mengunci tugas dengan update terjaga `routing_status: NULL → 'routing'`. Tick yang kalah tidak memanggil Laya. Kunci `routing` yang lebih tua dari 5 menit dilepas kembali ke `NULL`.
- Hasil:
  - `confidence ≥ 0.7` dan `needs_human = false` → `stage = 'Routed'`, `agent_id` + `agent_name` + `model` diisi dari agen terpilih, `laya_agent_id` diisi, `routing_status = 'routed'`.
  - `confidence < 0.7` atau `needs_human = true` → `stage = 'Awaiting routing'`, `laya_agent_id` + skor + `route_reason` diisi, `routing_status = 'awaiting'`. `route_reason` menyebut pemicunya, mis. "Keyakinan 0.54 di bawah 0.7" atau "Laya menandai perlu manusia".
  - Laya error, timeout (`NEIRO_ROUTER_TIMEOUT_MS`, bawaan 5000), atau `agent_id` di luar enum → agen default dari `pickStageAgent("workers", task.agentName)` yang sudah ada, `stage = 'Routed'`, `routing_status = 'fallback'`, `route_reason` berisi pesan error. Tidak ada agen pekerja sama sekali → tugas tetap `Queued`, `routing_status = NULL`, masalah dicatat di `ctx.problems`.
- Klaim di `stepTasks` memakai tugas `Routed` saat router aktif. Agen di stage `Coding` adalah `task.agentId` hasil routing, apa pun stage agen itu (bukan pencarian specialty ulang), selama agen itu masih enabled; kalau tidak, pakai alur pemilihan lama.
- Saat mem-poll run `Coding`, pemilik run dicari berdasarkan `run_agent_id` di antara semua agen enabled, bukan hanya stage `workers`/`orchestrator`. Tanpa ini, run milik agen QA/reviewer/PM yang dipilih Laya dianggap "no longer enabled".
- Stage QA check dan Final review tetap memakai agen stage `qa` dan `reviewer` seperti sekarang.
- Gagal QA/review lalu retry → tugas kembali ke `Routed` (bukan `Queued`) dengan routing yang sama; Laya tidak dipanggil ulang.

### Saklar env

- `NEIRO_ROUTER=off` (atau `NEIRO_LAYA_MODEL_PATH` tidak diset) → router tidak dimuat sama sekali, tugas `Queued` langsung diklaim seperti sekarang, retry kembali ke `Queued`. Perilaku identik dengan sebelum fitur ini.
- Variabel baru (`NEIRO_ROUTER`, `NEIRO_LAYA_MODEL_PATH`, `NEIRO_ROUTER_TIMEOUT_MS`) didokumentasikan di `.env.example` (atau README bila `.env.example` tidak ada).

### Gerbang manusia (API)

- `app/api/missions/[id]/tasks/[taskId]/control/route.ts` dapat aksi `approve_route` dan `override_route` (body `{ agentId }`).
- Kedua aksi wajib lolos `isAuthorizedRequest`; jika tidak → 401.
- `approve_route`: hanya untuk tugas `Awaiting routing` → `Routed`, agen = `laya_agent_id`, `routing_status = 'approved'`.
- `override_route`: `agentId` harus agen yang enabled, stage apa pun (selain itu 400) → `Routed`, agen = `agentId`, `human_agent_id = agentId`, `laya_agent_id` tetap, `routing_status = 'overridden'`.
- Update terjaga pada `stage = 'Awaiting routing'`; tugas yang sudah berpindah stage → 409.

### UI (`components/mission-workspace.tsx`)

- **Alur tugas (Pilihan 3):** baris Tugas → Laya → Agen per tugas. Titik berjalan di jalur saat `routing_status = 'routing'`; diam setelah selesai. Chip urgensi (Rendah / Sedang / Tinggi untuk 0/1/2) dan chip "tanpa manusia" saat `route_needs_human = false`. Animasi mati di bawah `prefers-reduced-motion: reduce`.
- **Gerbang manusia (Pilihan 5):** untuk tiap tugas `Awaiting routing`, kartu bergaris kuning berisi judul tugas, agen usulan Laya, `route_reason`, dan skor. Tombol flat teal "Setujui" dan tombol outline "Ganti agen" (membuka pilihan semua agen enabled, dikelompokkan per stage). Tombol nonaktif selama permintaan berjalan; error tampil lewat toast `sonner`.
- Gaya mengikuti yang ada: abu netral, primary teal, tombol flat (`components/ui/button.tsx`), label pakai `.eyebrow`, ID agen/tugas pakai `.code-chip`. Data demo diberi contoh tugas `Routed` dan `Awaiting routing`.

### Test (`bun test`)

- Test baru, memakai `lib/test-fakes/memory-store.ts` dan router palsu yang diinjeksi lewat `OrchestratorDeps` (Laya asli tidak dimuat di test):
  1. Routing sukses → `Routed` dengan agen yang benar, lalu diklaim ke `Coding` oleh agen itu.
  2. Confidence rendah → `Awaiting routing`, tidak pernah diklaim di tick berikutnya.
  3. `needs_human = true` dengan confidence tinggi → `Awaiting routing`, tidak pernah diklaim.
  4. Fallback (error dan timeout) → `Routed` dengan agen default, `routing_status = 'fallback'`, tugas tetap jalan.
  5. Ganti agen → `human_agent_id` dan `laya_agent_id` tersimpan, tugas diklaim oleh agen manusia.
  6. Dua tick bersamaan → Laya dipanggil tepat sekali per tugas.
  7. Retry setelah gagal QA → kembali ke `Routed`, Laya tidak dipanggil lagi.
- Semua test lama lolos dengan `NEIRO_ROUTER=off`.
- `bun run lint`, `bunx next typegen && bunx tsc --noEmit`, dan `bun test` lolos.

## Di luar cakupan

- Melatih atau menyetel model Laya.
- Dashboard evaluasi akurasi Laya (data `laya_agent_id` vs `human_agent_id` hanya disimpan).
- Merouting stage QA/review; hanya stage `Coding` yang dirouting.
