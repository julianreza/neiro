# OMP macOS feasibility PoC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** DRAFT — bukan izin implementasi, instalasi, OAuth, inference, commit atau push.

**Goal:** Membuktikan satu sesi OMP/ChatGPT subscription pada repo contoh dapat dikendalikan lewat protokol terstruktur, dengan approval fail-closed, pembatalan terverifikasi, evidence file/tes, dan reopen tanpa replay tool.

**Architecture:** Harness terminal Python standard library mengelola satu child OMP lewat stdin/stdout dan membaca stderr terpisah. Harness adalah alat PoC sementara, bukan keputusan runtime produk SwiftUI. Tool policy dan private data directory harus lolos discovery sebelum proses engine diizinkan berjalan.

**Tech Stack:** Python standard library + unittest untuk harness; OMP v18.12.6 (`45c35e40c46166dc726ccc52f5d27f40f2449f99`); Git; macOS arm64 untuk acceptance final. Tidak ada ai-memory atau UI produk pada PoC ini.

**Spec:** `../specs/2026-10-23-omp-desktop-design.md`

## Global Constraints

- Pribadi, lokal, MacBook M1 arm64; SwiftUI tetap target produk.
- Satu engine, satu provider ChatGPT subscription, satu sesi aktif.
- Semua output uji di bawah adalah EXPECTED; belum dijalankan.
- Jangan membaca/menyalin token provider atau memakai auth personal secara implisit.
- Approval per-call eksplisit; tanpa yolo, auto-approve, persistent/session-wide grant.
- Tanpa ambient extensions/MCP/custom commands/eval/task/browser/computer pada tahap ini.
- Approved shell bukan sandbox; penggunaan awal hanya fixture benign.
- Tidak ada reset/stash/checkout/clean atau replay otomatis setelah crash.
- Tidak ada installation/login/inference sebelum izin eksekusi terpisah.
- Tidak ada commit/push tanpa izin terpisah. Rencana ini tidak menyisipkan commit otomatis.
- Produk dan memory integration menunggu hasil PoC; jangan menambah fitur untuk membuat demo terlihat lengkap.

## Review Focus

1. Stream terpotong, invalid UTF-8 atau v2 chunks rusak: gagal eksplisit dan tidak kehilangan correlation diam-diam — Task 2.
2. Config project/ambient tool memperluas execution surface atau auth discovery menyentuh state personal: block launch sebelum live — Task 1 dan 3.
3. Approval timeout/disconnect/late answer atau option label berubah: tidak ada efek tertolak dan tidak ada stale approval — Task 3 dan 6.
4. Abort ack tetapi grandchild/queued work masih hidup: Stop tetap unverified dan task baru diblokir — Task 4 dan 6.
5. Repo dirty/concurrent edits atau crash setelah efek file: baseline tidak hilang, attribution ambiguous terlihat, resume tidak replay — Task 5 dan 6.

## Proposed files

Semua file di bawah PROPOSED; belum dibuat. Ikuti nama/interface ini hanya jika draft disetujui. Python package terletak di `poc/omp/`; tests dijalankan dari root repo dengan `python -m unittest discover -s poc/omp/tests -v`.

- `poc/omp/README.md`: lifecycle/operator instructions, expected/live evidence distinction.
- `poc/omp/contract.json`: versi, flags/config paths terverifikasi, inventory/discovery policy, sumber. Tidak berisi secrets atau OAuth URLs.
- `poc/omp/discover_contract.py`: generate/report contract dari inspeksi source/version yang telah diizinkan, tanpa inference.
- `poc/omp/contracts.py`: host-owned dataclasses/states; bukan tipe upstream buatan.
- `poc/omp/protocol.py`: bounded JSONL/v2 decoding dan request correlation.
- `poc/omp/engine.py`: private cwd/state spawn, pipe reader/writer dan command ids.
- `poc/omp/approval.py`: pending choice registry dan fail-closed replies.
- `poc/omp/lifecycle.py`: admission, Stop, EOF, process-group escalation.
- `poc/omp/evidence.py`: baseline, file delta dan test-result records.
- `poc/omp/main.py`: operator commands, explicit auth/live consent, one-session harness.
- `poc/omp/tests/test_contract.py`, `test_protocol.py`, `test_approval.py`, `test_lifecycle.py`, `test_evidence.py`.
- `poc/omp/tests/support/fake_engine.py`: clearly labelled local protocol test double; never evidence of OMP behavior.
- `docs/superpowers/research/omp-launch-contract.md`: Task 1 result.
- `docs/superpowers/research/omp-poc-results.md`: actual run evidence and verdict.

Temporary fixtures and raw run artifacts use OS/cache scratch location (in current Hermes environment use TMPDIR), not tracked repo or system temp hardcoding. No credential files in test fixtures.

## Task 1: Resolve launch/auth/approval restrictions before any engine execution

**Files:** create contract report, contracts.py, discover_contract.py, contract.json, test_contract.py, README.

**Interfaces:** produces host `LaunchContract` fields: executable path, expected version, mode, verified argument list, private engine data path, fixture cwd, active tools, forbidden discovery paths, source refs and unresolved blockers. `validate_contract(contract: LaunchContract) -> list[str]` returns blocking reasons. Empty list is permitted only when every required item is verified. Upstream flags/config keys other than cited approval mode are intentionally NOT invented here.

- [ ] Read pinned CLI parser, settings precedence, auth discovery and tool registration source; list exact syntax for private agentDir, config, mode, allowlist and disabling discovery. Inspect credential fallback/import paths without reading actual credential files. Record every source permalink.
- [ ] Write `test_rejects_unresolved_contract`, `test_rejects_yolo_or_auto_approve`, `test_rejects_ambient_tools`, `test_rejects_personal_auth_discovery`, `test_rejects_unreviewed_project_config` asserting validation blocks launch. Add one fully specified host fixture accepted by validation; synthetic fixture is not verified upstream evidence.
- [ ] Run `python -m unittest discover -s poc/omp/tests -p test_contract.py -v`; expect RED before validator implementation.
- [ ] Implement validator and read-only contract report generation. No subprocess launch until all evidence-backed requirements are resolved. Per-tool prompt policies must cover tools that otherwise explicitly allow themselves.
- [ ] Rerun tests; expect PASS. Independently review actual argv/config against pinned source, not just tests written for assumptions.
- [ ] Write go/no-go: CLI route if restrictions are enforceable; otherwise STOP this path and request design decision about minimal SDK bridge or stronger containment. Do not silently change engine or introduce bridge dependencies.

**Acceptance / G0:** user approves draft; operator provides macOS/Xcode details; provider-use assessment is recorded honestly; private state/tool/discovery contract has no unresolved live-safety blockers. Download/install and auth still require explicit permission. If provider terms cannot be settled from reliable sources, report uncertainty and request decision; user consent cannot override provider prohibition.

## Task 2: Bounded protocol transport and turn reconstruction

**Files:** create protocol.py, test_protocol.py; extend contracts.py.

**Interfaces:** host `FrameDecoder.feed(data: bytes) -> list[dict]`, `FrameDecoder.finish() -> None`; raises `ProtocolError` for invalid/incomplete data. `RequestRegistry.register(request_id: str) -> None`, `resolve(frame: dict) -> str | None`. `TurnState.apply(frame: dict) -> None` exposes accepted/result/settled independently. These are proposed host interfaces, not claims about OMP SDK.

- [ ] Capture canonical schemas from pinned docs/rpc-types and create hand-authored test vectors labelled synthetic. Include ready/response/message_update/prompt_result/session_settled and exact v2 chunk contract. Never fabricate a real capture.
- [ ] Tests assert split UTF-8 and split/coalesced JSONL reconstruct identical objects; invalid UTF-8 and incomplete EOF raise; chunk wrong id/order/count/size/base64 raises; negotiated limits enforced before allocating; request ids resolve out of order; unknown id does not resolve another request; stale session events do not mutate new turn.
- [ ] Tests assert prompt admission and agent_end alone never mark session done; completed prompt with sessionSettled false remains pending settlement; prompt error is not erased by command success; local-only agentInvoked false does not wait for a nonexistent run.
- [ ] Run `python -m unittest discover -s poc/omp/tests -p test_protocol.py -v`; expect RED.
- [ ] Implement streaming decoder and bounded reconstruction using standard library. JSONL boundary is LF, not generic Unicode line splitting. Preserve unknown event names as unsupported diagnostics, not completion. Keep stderr outside protocol.
- [ ] Run same command; expect PASS, and full suite PASS. Document memory bounds/ready negotiation and failure behavior.

**Acceptance / G1:** synthetic protocol suite passes. This proves host behavior against test vectors only, not real OMP compatibility.

## Task 3: Private process launch, engine-managed login, and approval round trip

**Files:** create engine.py, approval.py, main.py, test_approval.py, support/fake_engine.py; extend test_contract.py and README.

**Interfaces:** `EngineProcess.start(contract: LaunchContract) -> None`, `send(command: dict) -> str`, `close_input() -> None`, `read_event() -> dict`; `ApprovalRegistry.add(frame: dict) -> None`, `reply(request_id: str, option: str | None) -> dict`, `cancel_all() -> list[dict]`. Exact upstream response encoding must be derived from verified UI request/response schema, not these host signatures.

- [ ] Create local fake engine explicitly for offline tests. It records harmless requested marker actions and never calls providers. Ensure results always identify test double.
- [ ] Tests assert start rejects invalid contract/second active session; stdout drained concurrently with stderr; no shell string construction from paths/URL; logs exclude auth-frame payload/URLs; commands require ready/compatible negotiation.
- [ ] Approval tests assert only exact currently offered allow-once option can authorize; deny/cancel/timeout/unknown option/unknown id/session-wide grant attempt fail closed; duplicate/late response never authorizes; disconnect cancels pending approval and blocks fresh task admission. Test first option is never implicitly selected.
- [ ] Run approval and contract tests; expect RED. Implement only transport/host controls needed to pass; rerun to PASS.
- [ ] After G0 and explicit runtime permission, obtain verified version without login. Request further consent before login/inference. Discover login provider and model IDs via protocol, not guessed strings. Operator opens OAuth URL privately; engine owns token lifecycle. Secret-input requirement is a blocker.
- [ ] Record status only (provider label, selected model id, success/error category), never token/auth URL/raw login payload. Confirm model access with one consented benign request on fixture. Test auth failure/login cancellation separately. True expiry/refresh is manual/pending unless actually observed; never edit/read token store to simulate it.

**Acceptance / G2:** real engine starts under isolated policy, engine-managed login and consented inference succeed; required approval appears through structured frames and deny is verified in Task 6. Auth source/permission uncertainty remains visible. No API-key fallback without user approval.

## Task 4: Stop and shutdown with observable failure states

**Files:** create lifecycle.py, test_lifecycle.py; extend engine.py/main.py and fake engine.

**Interfaces:** `StopController.request_stop() -> None`, `observe(frame: dict) -> None`, `poll() -> str` returns cancelling/stopped/unverified/failed. Constructor receives clock/process controls for deterministic tests. Exposes pending approvals and admission lock through host components from Task 3. Preserve abort/abort_bash differences from pinned upstream.

- [ ] Write tests for abort during streaming, pending approval, explicit bash, natural completion racing abort, stdout backpressure, EOF, stuck engine, child/grandchild, queued continuation and late responses. Assert no new task accepted while cancelling or unverified.
- [ ] Simulated abort ack without process/settlement confirmation must not return stopped. Assert 10-second cancellation deadline then TERM to owned process group, then 5 seconds to KILL; never signal unrelated processes. A detached mock child yields unverified until explicitly accounted for.
- [ ] Run lifecycle tests; expect RED. Implement admission locking, pending-dialog cancellation and bounded shutdown; rerun to PASS.
- [ ] Run local benign process-tree test on available host with test double, checking PIDs and heartbeat cessation. Clearly label Linux results non-macOS and mock results non-OMP.
- [ ] On Mac after permission, repeat with real tool execution in Task 6. Document engine-specific limitations, queue clearing and persistence consequences; do not use SIGKILL success as proof of graceful persistence.

**Acceptance:** test-double suite passes; real macOS Stop remains pending until Task 6. Stopped is never inferred from abort response alone. Escaped descendants or unknown queue behavior block repo-real use.

## Task 5: Evidence, dirty baseline, and reopen without tool replay

**Files:** create evidence.py, test_evidence.py; extend main.py/contracts.py.

**Interfaces:** `capture_baseline(repo: Path) -> Baseline`, `compare_to_baseline(repo: Path, baseline: Baseline) -> ChangeReport`, `record_test(command: list[str], cwd: Path, exit_code: int | None, output: str, cancelled: bool) -> TestEvidence`. Host serialization uses explicit version fields and minimal metadata. Session reopen uses only verified OMP native session commands and references; no native-session file parser unless separately justified.

- [ ] Tests create disposable Git fixture with committed file, staged and unstaged modifications, untracked file and symlink. Assert baseline records relevant original content/status, task delta is separate, paths with spaces work, and no reset/stash/checkout/clean is run. Conflicting concurrent edit yields ambiguous attribution.
- [ ] Test pass/fail/cancelled/not-run evidence separately; absence of exit code is never pass. Do not treat assistant text as execution evidence.
- [ ] Test process crash after marker write: persisted host reference can reopen native history but never sends tool/prompt automatically. An invalid/stale session reference fails explicitly and does not open arbitrary unrelated session silently.
- [ ] Run evidence tests; expect RED. Implement minimal reporting and reopen path; rerun to PASS.
- [ ] Full suite: `python -m unittest discover -s poc/omp/tests -v`; expect all PASS. Log exact command/output in results after execution, not before.

**Acceptance:** fixture dirty state protected, evidence differentiates actual execution from prose, and reopen does not itself replay effects. Concurrent edit attribution is explicitly limited.

## Task 6: Real macOS acceptance and verdict

**Files:** write actual `docs/superpowers/research/omp-poc-results.md`; amend README with validated commands, no secrets.

**Consumes:** verified LaunchContract, host harness from Tasks 2–5, explicit install/login/inference consent, MacBook M1 operator.
**Produces:** per-scenario actual evidence, PASS/FAIL/BLOCKED/NOT-RUN status and go/no-go decision.

- [ ] Record actual OS/architecture, Xcode availability, Python harness version and OMP version, private state configuration and active inventory. Refuse mismatched runtime version until contract re-reviewed.
- [ ] Run offline full suite on Mac; save command and actual summary. No pass by inference from Linux.
- [ ] Run real happy path: login, discover/select model, repo task with explicit requested edit/test, approve once, view streamed events, verify file diff and actual test output, wait settlement, close/reopen session and continue with a new user-authorized prompt.
- [ ] Deny a benign marker-file write, deny benign shell action, and simulate UI loss while approval is pending. Verify requested markers/effects do not occur after wait/reconnect. Use deterministic tool forcing only if upstream supports it; otherwise record requested action not exercised as NOT-RUN, not pass.
- [ ] Stop streaming, Stop pending approval, Stop long-running benign test/tool with child/grandchild heartbeat. Verify no subsequent tool admission, owned descendants exit, heartbeats cease, late result/queue does not restart work. If not demonstrable, verdict remains PARTIAL/BLOCKED.
- [ ] Kill engine after a benign file effect; reopen and check history plus filesystem without automatic replay. Repeat dirty baseline and concurrent-edit scenario.
- [ ] Check shutdown drain, persistence notice/nonzero handling, auth cancellation and unavailable model behavior. Provider quota/network failure only counted if actually observed or clearly labelled simulated host tests.
- [ ] Write evidence without secrets: versions, scenario, expected/actual, safe event names/request ids, file delta, command/cwd/exit code, process observations, redacted error category. Avoid raw auth frames, repo secrets or unverifiable invented output.
- [ ] Review all acceptance criteria against evidence. VALIDATED only if every required real scenario was exercised successfully. PARTIAL for constraints/unexercised scenarios; INVALIDATED/BLOCKED for incompatible required boundaries. No UI/memory work hides a failing safety gate.

**G3:** sufficient real macOS evidence for the agreed narrow threat model, no mandatory scenario left unverified. No claim of broad sandboxing; actual repo use requires separate explicit review of remaining ambient shell/network risks.

## Roadmap only — not implementation tasks

1. ai-memory local PoC: pin release, verify MCP/extension in OMP RPC, one capture producer, scope/exclusion tests, outage/recovery, deletion semantics. No token reuse, remote server, embeddings or LLM consolidation initially.
2. SwiftUI minimal: port proven protocol contract to Swift; project/model/session/approval/Stop/diff/test surfaces; no Python requirement implied for product.
3. Claude, Antigravity and API key: separate eligibility/terms/login/model/inference/re-auth gates; not automatic parity with ChatGPT.
4. Product runtime: app-private data locations, Finder environment, supply-chain checksums, license notices, pin/migration/update rollback. Determine app minimum macOS and Bundle Identifier with user.
5. Packaging: .app/.dmg, signing entitlements and notarization appropriate to intended distribution; verify on actual Mac, not Linux.

## Self-review and approval boundary

Coverage: user flow assigned Tasks 1–6; five Review Focus cases mapped to owning tests. Signatures are host-only and consistent; unknown upstream CLI setup remains a discovery task with a blocking output, not a guessed command. Production UI, memory, multi-provider and packaging intentionally remain roadmap.

This draft resolves small recommendations (Python throwaway harness and Stop deadlines) openly. It does not resolve Mac access/version, provider permission or CLI isolation by assumption. No implementation begins until user approves design and plan; execution involving installation, OAuth or inference requires separate explicit permission.
