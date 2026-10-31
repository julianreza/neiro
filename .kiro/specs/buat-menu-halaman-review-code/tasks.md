# Tasks: Menu Code review

Urut dari atas. Tiap tugas selesai kalau kriteria "Selesai" terpenuhi. Host RAM rendah: jalankan tes satu file sekali jalan (`bun test --conditions=react-server lib/<file>.test.ts`).

## 1. Migrasi database

- Buat `supabase/migrations/20261030000400_code_reviews.sql` (idempoten, `if not exists`, pola sama dengan `20261030000300_ask_model.sql`).
- Tabel `code_reviews`: `id uuid pk default gen_random_uuid()`, `repo text not null` (`owner/repo`), `pr_number int not null`, `pr_url text not null`, `pr_title text`, `head_ref text`, `base_ref text`, `files jsonb` (path, additions, deletions), `source text not null check (source in ('manual','mission'))`, `mission_id text null references missions on delete set null`, `task_id text null references mission_tasks on delete set null`, `task_attempt int null`, `agent_id text null references agents on delete set null`, `model text`, `runtime text`, `run_id text`, `status text not null default 'queued' check (status in ('queued','fetching','reviewing','done','failed'))`, `verdict text null check (verdict in ('approve','request_changes','comment'))`, `summary text`, `findings jsonb not null default '[]'`, `raw_output text`, `error text`, `tokens int not null default 0`, `posted_at timestamptz`, `created_by text`, `created_at`, `updated_at`.
- Index `(created_at desc)` dan `(mission_id)`.
- `missions`: tambah `mode text null check (mode in ('build','fix','plan'))`, `pr_url text null`, `pr_number int null`.
- Nama tabel task dan kolom FK dicek di `supabase/migrations/20261028000000_baseline.sql` sebelum menulis.
- **Selesai:** file migrasi ada, dijalankan dua kali di SQL Editor tanpa error.
- Tambahan setelah desain dipilih: `supabase/migrations/20261030000500_code_review_design.sql` menambah kolom `design jsonb` (Problem / Why it matters / Solution fit).

## 2. Tipe dan store

- `lib/types.ts`: tambah `ReviewSeverity = "blocker" | "major" | "minor" | "nit"`, `ReviewFinding` (`id`, `severity`, `file`, `line`, `problem`, `consequence`, `suggestion`, `posted: boolean`), `ReviewStatus`, `ReviewVerdict`, `CodeReview` (semua kolom tabel, camelCase). `Mission` dapat `mode`, `prUrl`, `prNumber`.
- `lib/orchestrator-store.ts`: `mapMissionRow` membaca kolom baru; `MissionPatch` menerima `prUrl`/`prNumber`.
- `lib/mission-input.ts`: terima `mode` (`build`/`fix`/`plan`, lainnya null); `app/api/missions/route.ts` menyimpannya.
- `components/project-composer.tsx`: kirim `mode` di body `POST /api/missions`.
- `lib/code-reviews-store.ts` (server-only): `listReviews(filter)`, `getReview(id)`, `createReview(row)`, `updateReview(id, patch)`, `listActiveReviews()` (status `queued`/`fetching`/`reviewing`), `findReviewForTask(taskId, retries)`.
- **Selesai:** `bunx tsc --noEmit` lulus.

## 3. Modul GitHub dan git (`lib/github-pr.ts`, server-only)

- `parsePrUrl(url)`: hanya `https://github.com/<owner>/<repo>/pull/<n>` (owner/repo `[A-Za-z0-9_.-]+`, n bilangan bulat > 0). Selain itu `null`.
- `fetchPr(ref)`: `gh pr view <n> --repo <owner/repo> --json title,body,headRefName,baseRefName,files,url` dan `gh pr diff <n> --repo <owner/repo>`, lewat `execFile`. Diff dipotong di 200 KB dengan tanda terpotong.
- `ensureMissionPr(mission, taskTitle)`: di `mission.worktreePath`: `git status --porcelain`; kalau ada perubahan `git add -A` lalu `git commit -m "neiro: <taskTitle>"`; `git push origin <workBranch>` (tolak kalau branch `main`/`master` atau tidak diawali `neiro/`); cari PR terbuka `gh pr list --head <workBranch> --state open --json number,url`; kalau tidak ada `gh pr create --draft --head <workBranch> --base <baseBranch atau default> --title <mission.title> --body <ringkasan misi>`. Kembalikan `{ url, number }` atau lempar error berisi sebab (`not a git worktree`, `no origin remote`, `gh not logged in`, pesan stderr).
- `postReviewComments(ref, findings)`: `gh api repos/<owner>/<repo>/pulls/<n>/reviews` method POST, `event=COMMENT`, satu komentar per temuan (`path`, `line`, `body`). Body dikirim lewat `--input` dari stdin, bukan di argv.
- Semua fungsi menerima runner `exec` yang bisa diganti di tes.
- **Selesai:** `lib/github-pr.test.ts` lulus: URL valid/tidak valid, PR baru, PR sudah ada, tidak ada perubahan (tanpa commit), branch terlarang ditolak, error `gh` diteruskan.

## 4. Prompt dan pengurai hasil (`lib/code-review.ts`)

- `buildReviewPrompt(pr, diff, extra?)`: minta agent menjawab satu blok JSON `{ "verdict", "summary", "findings": [{ "severity", "file", "line", "problem", "consequence", "suggestion" }] }`, dengan aturan: tiap temuan wajib punya akibat (sebab -> mekanisme -> akibat), jangan ubah file apa pun.
- `parseReviewOutput(text)`: ambil blok JSON terakhir, validasi field dan tingkat; temuan tidak valid dibuang; hasil `{ ok: true, verdict, summary, findings }` atau `{ ok: false, error }`.
- `sortFindings(findings)` dan `focusFiles(findings, files)`: urut `blocker > major > minor > nit`, lalu file, lalu baris.
- `reviewPassed(verdict, findings)`: lulus kalau tidak ada `blocker`/`major` dan verdict bukan `request_changes`.
- **Selesai:** `lib/code-review.test.ts` lulus: JSON valid, JSON rusak, teks tanpa JSON, temuan campur valid/tidak valid, urutan.

## 5. Mesin review manual (`lib/code-review-runner.ts`)

- `advanceCodeReviews(deps)`: untuk tiap review aktif dengan `source = 'manual'`:
  - `queued` -> klaim (`fetching`), `fetchPr`, simpan data PR, pilih agent `enabled` stage `reviewer` (pola `pickTaskAgent`), `startRun` dari `lib/agent-runtime.ts` dengan prompt tugas 4 dan `cwd` netral, simpan `run_id`, `agent_id`, `model`, `runtime`, status `reviewing`.
  - `reviewing` -> `getRun`; kalau selesai, `parseReviewOutput`, simpan hasil, token, status `done` atau `failed` + `error`; catat token ke `agent_token_usage` lewat `store.recordTokenUsage` (`lib/orchestrator-store.ts`).
  - Error apa pun -> `failed` dengan pesan.
- `lib/tick.ts` `runTick()` memanggil `advanceCodeReviews` setelah `advanceActiveMissions`; error masuk `errors`.
- **Selesai:** `lib/code-review-runner.test.ts` lulus dengan store, runtime dan `gh` palsu (`lib/test-fakes`): alur sukses, tanpa agent reviewer, `gh` gagal, output rusak.

## 6. Langkah PR di orchestrator

- `lib/orchestrator.ts`, saat tugas di `Final review` belum punya run dan misi `mode` `build`/`fix`:
  1. `ensureMissionPr`; simpan `prUrl`/`prNumber` di misi kalau baru.
  2. Gagal -> tugas ke `Needs you` dengan `result` berisi sebab, tanpa run reviewer.
  3. Sukses -> buat baris `code_reviews` (`source = 'mission'`, `mission_id`, `task_id`, data PR dari `fetchPr`) kalau `findReviewForTask` belum ada untuk percobaan ini.
  4. Prompt reviewer ditambah link PR dan diff PR, dan format JSON tugas 4.
- Saat run reviewer selesai: `parseReviewOutput`, perbarui baris `code_reviews` (status, verdict, temuan, token). Artifact `review_report` tetap ditulis seperti sekarang; lulus/gagal tetap memakai logika yang ada, ditambah `reviewPassed` kalau JSON terurai.
- Misi `plan` dan `mode = null` tidak berubah perilakunya.
- `lib/needs-you.ts` menampilkan alasan PR gagal.
- **Selesai:** kasus baru di `lib/orchestrator.test.ts` lulus: PR baru, PR sudah ada, gagal -> `Needs you`, misi `plan` tanpa PR. Tes orchestrator lama tetap lulus.

## 7. API

- `app/api/reviews/route.ts`: `GET` daftar (query `source`, `status`), `POST { url }` buat review manual (tolak URL tidak valid 400, tanpa agent reviewer 409).
- `app/api/reviews/[id]/route.ts`: `GET` detail.
- `app/api/reviews/[id]/rerun/route.ts`: `POST` buat baris baru dari PR yang sama (versi lama tetap).
- `app/api/reviews/[id]/post/route.ts`: `POST { findingIds }` panggil `postReviewComments`, tandai `posted`, isi `posted_at`.
- Semua route pakai helper auth di `lib/auth.ts`; `POST` ditolak 403 untuk role `viewer`. `params` di-`await`.
- **Selesai:** `app/api/reviews` tes auth (pola `lib/auth-route.test.ts`): tanpa login 401, viewer 403, URL salah 400.

## 8. Halaman `/reviews`

- Baca skill UI yang wajib (frontend-design-workflow, frontend-design, design-taste-frontend, web-design-guidelines, ui-ux-pro-max) sebelum mulai.
- Tunjukkan 3-6 mockup `mcwidget` bernomor dulu, tunggu Reza memilih, baru tulis kode.
- **Dipilih:** layout Opsi A "Setia ke Sage" (kiri: repo, tab All/Manual/Missions, New review, daftar; kanan: judul PR, tab Review/Files/Raw answer, bar, chip filter, Design gate + Ship-readiness summary, kartu temuan Observation/Evidence/Consequence/Suggestion, Select for post, Dismiss, Post this one). Saat review berjalan dipakai Opsi C: robot bergerak, langkah Queued → Reading the PR → Reviewing, bar bergaris, daftar file. Tombol utama memakai `Button` default neiro (teal).
- Temuan mendapat field `category`, `observation`, `evidence`, `dismissed`; route baru `POST /api/reviews/[id]/dismiss`.
- `app/(dashboard)/reviews/page.tsx` merender `components/code-review-board.tsx`.
- Menu `{ href: "/reviews", label: "Code review", icon: ScanSearch }` di `components/dashboard-shell.tsx` setelah `Projects`.
- Isi: form URL PR, filter, daftar kiri, detail kanan (link PR, head/base, file +/-, verdict, ringkasan, temuan terurut dengan file fokus di atas, centang + `Post to GitHub`, `Review again`). Polling tiap 5 detik selama ada review aktif. Status aktif beranimasi, menghormati `prefers-reduced-motion`.
- Lebar penuh, neumorphism dari `app/globals.css`, dropdown pakai `components/ui/picker.tsx`, label eyebrow lewat class `.eyebrow`, ID mesin di `.code-chip`.
- Viewer: form dan tombol aksi disembunyikan.
- **Selesai:** halaman tampil di dev server, review manual bisa dimulai dan hasil tampil tanpa reload.

## 9. Link dari misi

- `/projects/[id]` (`components/project-mission-control.tsx` atau `components/mission-workspace.tsx`): tampilkan chip link PR (`prUrl`) dan link `Open review` ke `/reviews?id=<reviewId>` di tugas yang punya review.
- `/reviews` membaca `?id=` untuk membuka detail itu.
- **Selesai:** dari misi Build, klik link membuka review yang benar.

## 10. Penutup

- `.env.example`: tidak ada variabel baru (pakai `gh` yang sudah login); tulis catatan singkat di README bahwa `gh auth login` dibutuhkan untuk Code review.
- Jalankan `bun run lint`, lalu `bunx next typegen && bunx tsc --noEmit`, lalu tes baru satu per satu.
- **Selesai:** semua lulus, tidak ada commit sebelum Reza minta.
