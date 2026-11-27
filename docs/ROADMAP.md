# Roadmap

The full plan lives in the project's "Grand Strategy Browser Game — Build Plan" doc. This file
tracks progress in the repo. Every phase ends with a playable build and a gate that must pass
before the next phase starts.

| Phase | Name                                | Gate                                               | Status      |
| ----- | ----------------------------------- | -------------------------------------------------- | ----------- |
| 0     | Foundations                         | CI green; a broken mod shows clear errors          | In progress |
| 1     | Map on screen                       | 60 fps pan; repaint under 5 ms                     | Not started |
| 2     | Time, orders and saving             | Reloaded save matches the uninterrupted state hash | Not started |
| 3     | Land warfare                        | 1939 Germany vs. Poland is fun for 30 minutes      | Not started |
| 4     | Economy and production              | Factories visibly sustain armies                   | Not started |
| 5     | Research, politics, focuses, events | A focus tree works as a pure mod                   | Not started |
| 6     | Diplomacy and war goals             | War and peace through diplomacy alone              | Not started |
| 7     | AI and AI decision paths            | AI-vs-AI war looks historical in most seeded runs  | Not started |
| 8     | Whole world at full scale           | Full map; one game day under 50 ms                 | Not started |
| 9     | Naval, air and deep supply          | Sea Lion and Barbarossa play well                  | Not started |
| 10    | Modding toolkit and modern day      | Modern-day scenario ships as a pure mod            | Not started |
| 11    | Polish and release                  | Strangers can pick it up                           | Not started |

## Phase 0 — Foundations

- [x] 1. Repo, TypeScript strict, Vite, ESLint, Prettier, test runner
- [x] 2. CI on GitHub Actions; deploy to GitHub Pages
- [x] 3. `ARCHITECTURE.md` and `CLAUDE.md`
- [x] 4. Engine skeleton: seeded RNG, fixed-point math, game state, `step()`
- [x] 5. Determinism harness: run from a seed, hash, compare; save/reload check
- [x] 6. Content loader: `mod.json`, YAML, Zod validation, merge by ID, errors with file and record

Remaining for the Phase 0 gate: the first CI run on GitHub must be green, and GitHub Pages
must be enabled (Settings → Pages → Source: GitHub Actions).
