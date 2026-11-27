# CLAUDE.md

Instructions for Claude (and any other contributor) working in this repository.

## The one rule

**Engine vs. content.** The engine knows _how_ things work; every country, unit, number,
event and string lives in `content/` as data. If a designer would have to edit TypeScript to
change a balance number or add a country, that is a bug.

## Before starting a task

1. Read `ARCHITECTURE.md` and the relevant spec in `docs/design/`.
2. Find the task's step in `docs/ROADMAP.md` (for example "Phase 3, step 6").
3. If the spec is missing or ambiguous, write or update the spec first and ask the owner.

## Commands

- `npm run check` — must pass before every commit (typecheck, lint, tests, content validation).
- `npm test` — runs `node --test` on `engine/test` and `tools/test`.
- `npm run dev` — Vite dev server for the client.

## Engine rules (`engine/`)

- No DOM, no `window`, no Node-only APIs. It must run in a Web Worker and in Node tests.
- Deterministic: no `Math.random`, no `Date.now`, no iteration over object keys whose order
  could differ. Use the seeded generator in `engine/src/rng.ts` (`state.rng`) and integer or fixed-point math
  (`engine/src/fixed.ts`) for anything that affects game state.
- State changes only through commands applied in `step()`. The UI never mutates state.
- Large per-province or per-unit data uses typed arrays (structure of arrays).
- Every system gets tests. A rule change that alters the determinism hash in
  `engine/test/determinism.test.ts` must update the expected hash _on purpose_, with a note
  in the commit message.

## TypeScript style

- Strict mode, ES modules, relative imports **with** the `.ts` extension (Node runs the tests
  directly with type stripping, so only erasable syntax: no `enum`, no `namespace`, no
  constructor parameter properties).
- Prefer plain objects and functions over classes, except for small stateful helpers.
- Balance numbers go in `content/core/common/defines.yaml`, never in code.

## Commits

- One roadmap step (or part of one) per branch; small commits; descriptive messages.
- Never commit secrets, `node_modules/` or `dist/`.
