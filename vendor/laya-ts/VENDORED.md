# laya-ts (vendored)

- Source: https://github.com/NandhaKishorM/laya, folder `laya-ts/`
- Commit: `b9fe351ce81e2d974bca2bf219c1e4030c0a05ea` (committed 2026-10-26T08:29:05+05:30)
- Vendored: 2026-10-27
- License: Apache-2.0 (`LICENSE`)
- Why vendored: `laya-ts` is not published on npm.

## What is here

- `src/` — upstream source, unchanged.
- `dist/` — built from `src/` with this project's TypeScript (`tsc -p vendor/laya-ts/tsconfig.json`). Committed so `bun install` needs no build step.
- `tsconfig.json`, `README.md` — upstream, unchanged.
- `package.json` — trimmed from upstream:
  - removed `scripts` (no `prepack` build on install), `devDependencies`, `onnxruntime-web` (server-only use);
  - `onnxruntime-node` pinned to exactly `1.31.1` (upstream: `^1.20.0`).
- Upstream `tests/`, `examples/`, `fixtures/`, `scripts/` are not copied.

Installed in the app as `"laya-ts": "file:./vendor/laya-ts"`. `vendor/` is excluded from `tsconfig.json` and ESLint.

`onnxruntime-node`'s postinstall stays blocked by Bun (not in `trustedDependencies`). It only downloads extra GPU binaries on Linux; the macOS/Linux/Windows CPU binaries ship inside the package.

## API used by neiro

```ts
import { Agent } from "laya-ts";

const agent = await Agent.load(modelDirOrRepo, { numThreads, revision, expectedSha256, signal });
const r = await agent.decide(text, schema, { returnDetails: true });
// r.values:           { agent_id: "backend-worker", urgency: 1, needs_human: false }
// r.confidence:       { agent_id: 0.91, urgency: 0.77, needs_human: 0.95 }
// r.answerConfidence: { agent_id: 0.91 | null, ... }  (max(p) per field)
```

Schema fields may only be: a string `enum` (choice), a `boolean`, or an `integer` with integer `minimum`/`maximum` (score). A free `number` field such as `confidence: { type: "number" }` is rejected with `SchemaError`; confidence comes from `returnDetails`, not from the schema.

## Updating

1. `git clone --depth 1 --filter=blob:none --sparse https://github.com/NandhaKishorM/laya.git` then `git sparse-checkout set laya-ts`.
2. Replace `src/`, `tsconfig.json`, `README.md`, `LICENSE`; keep this `package.json` shape, re-check upstream `optionalDependencies`.
3. `rm -rf vendor/laya-ts/dist && ./node_modules/.bin/tsc -p vendor/laya-ts/tsconfig.json`.
4. `bun install`, update the commit SHA and date above.
