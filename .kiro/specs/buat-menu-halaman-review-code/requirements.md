# Menu Code review

## Tujuan

Tambah menu **Code review** di neiro (route `/reviews`), meniru alur Code Review Sage: satu PR GitHub direview oleh agent reviewer, hasilnya dibaca di app, dan komentar baru dikirim ke GitHub kalau operator memintanya.

Ada dua sumber review:

1. **Manual**: operator menempel URL PR GitHub, lalu agent reviewer meriview PR itu.
2. **Otomatis dari misi**: misi mode **Build something new** atau **Fix a bug** yang tugasnya sampai tahap `Final review` wajib punya PR dulu. neiro commit dan push branch misi (`neiro/<mission>`), membuka draft PR, lalu review agent reviewer untuk tugas itu tercatat dan tampil di halaman Code review. Misi `Quick plan` dan misi lama tanpa mode tetap berjalan seperti sekarang (review tanpa PR).

## Kriteria penerimaan

### Menu dan halaman

- Menu `Code review` (ikon `ScanSearch` dari lucide-react) ada di `navigation` di `components/dashboard-shell.tsx`, tepat setelah `Projects`, route `/reviews`.
- Halaman `/reviews` lebar penuh, gaya neumorphism yang sudah ada di `app/globals.css`, tanpa `max-width`.
- Kiri: daftar review, terbaru di atas. Tiap baris: repo `owner/repo`, nomor dan judul PR, sumber (`Manual` atau nama misi), status, verdict, jumlah temuan per tingkat.
- Filter daftar: semua / manual / dari misi, dan status.
- Kanan: detail review terpilih. Isi: link PR, branch head dan base, file yang berubah (jumlah baris +/-), verdict, ringkasan, dan temuan.
- Tiap temuan berisi: tingkat (`blocker`, `major`, `minor`, `nit`), file dan baris, masalah, akibatnya (sebab -> mekanisme -> akibat ke user/sistem), dan saran perbaikan.
- Temuan diurutkan dari tingkat tertinggi. File dengan temuan `blocker` atau `major` tampil paling atas (mirip Focus Report).
- Saat review masih berjalan, status bergerak (animasi) dan halaman memperbarui diri tanpa reload manual.

### Review manual by PR

- Form di atas daftar menerima URL `https://github.com/<owner>/<repo>/pull/<n>`. URL lain ditolak dengan pesan jelas, dan tidak ada perintah yang dijalankan.
- Data PR diambil lewat `gh` CLI (`gh pr view`, `gh pr diff`) dengan `execFile` (argv, bukan shell), di server saja.
- Review dijalankan oleh agent `enabled` dengan stage `reviewer` lewat runtime agent itu (Hermes atau OMP), seperti tahap `Final review` di `lib/orchestrator.ts`.
- Agent diberi diff PR, judul, deskripsi, dan diminta menjawab dalam format terstruktur (verdict + daftar temuan). Jawaban yang tidak bisa diurai disimpan sebagai teks mentah dan review berstatus `failed` dengan alasan.
- Status review: `queued`, `fetching`, `reviewing`, `done`, `failed`. Review `failed` atau `done` bisa dijalankan ulang dengan tombol `Review again`; versi lama tetap tersimpan.
- Kalau `gh` tidak ada atau belum login, atau PR tidak bisa dibaca, review berstatus `failed` dengan pesan yang menyebut sebabnya.
- Kalau tidak ada agent reviewer yang `enabled`, form menolak dan memberi tahu operator untuk menyalakan satu di `/agents`.

### Review otomatis dari misi Build dan Fix

- Misi menyimpan modenya (`build`, `fix`, `plan`) di kolom baru `mode`, dikirim oleh `components/project-composer.tsx` saat `POST /api/missions`. Langkah PR di bawah hanya berjalan untuk `build` dan `fix`.
- Saat tugas misi itu pindah ke `Final review`, sebelum run reviewer dimulai, neiro:
  1. commit perubahan yang belum di-commit di worktree misi (`git add -A`, lalu `git commit -m "neiro: <judul tugas>"`; dilewati kalau tidak ada perubahan),
  2. push branch misi ke `origin` (`git push origin neiro/<mission>`, nama branch literal, tidak pernah ke `main`/`master`),
  3. membuka **draft** PR dari branch misi ke `baseBranch` misi (atau branch default repo) lewat `gh pr create --draft`, atau memakai PR yang sudah terbuka untuk branch itu,
  4. menyimpan URL dan nomor PR di misi.
- Semua perintah `git` dan `gh` lewat `execFile` (argv, bukan shell).
- Satu misi = satu PR. Tugas berikutnya yang sampai `Final review` hanya push ulang ke PR yang sama.
- Review tugas itu dibuat sebagai baris review dengan sumber = misi dan tugas, berisi data PR, lalu agent reviewer yang dipilih orchestrator mengerjakannya.
- Hasil review tetap ditulis ke artifact `review_report` yang sudah ada (`dedupeKey review:<taskId>:<retries>`), jadi alur lulus/gagal/retry di orchestrator tidak berubah.
- Kalau push atau pembuatan PR gagal (folder bukan git worktree, tidak ada remote `origin`, `gh` belum login), tugas pindah ke `Needs you` dengan alasan yang jelas, dan run reviewer tidak dimulai.
- Halaman misi `/projects/[id]` menampilkan link PR dan link ke review di `/reviews`.

### Kirim ke GitHub

- Tidak ada yang dikirim ke PR secara otomatis.
- Di detail review, operator bisa mencentang temuan lalu menekan `Post to GitHub`. neiro membuat review GitHub berisi komentar per baris untuk temuan yang dicentang (lewat `gh api`). Temuan yang sudah dikirim ditandai.

### Data dan akses

- Tabel baru `code_reviews` lewat migrasi baru di `supabase/migrations/` (idempoten, pola sama dengan migrasi lain). Menyimpan: repo, nomor PR, URL, judul, head/base, sumber (`manual`/`mission`), `mission_id`, `task_id`, agent, model, runtime, status, verdict, ringkasan, temuan (JSON), output mentah, token, waktu.
- Misi mendapat kolom `mode`, `pr_url` dan `pr_number`.
- User dengan role `viewer` bisa membaca halaman tetapi tidak bisa memulai review, menjalankan ulang, atau `Post to GitHub`. Semua route API butuh login.
- Token dari run review ikut tercatat di `agent_token_usage` agar Dashboard tetap benar.

### Verifikasi

- `bun run lint` dan `bunx next typegen && bunx tsc --noEmit` lulus.
- Ada tes unit untuk: validasi URL PR, penguraian jawaban agent (valid, rusak), urutan temuan, dan langkah PR di orchestrator (PR baru, PR sudah ada, gagal -> `Needs you`) dengan `gh`/`git` palsu.
