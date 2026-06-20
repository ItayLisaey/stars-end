# stars-end

A lightweight, Playwright-only, Gemini-first library for driving a browser with
natural language. You give it a Playwright `Page` and instructions; it locates
elements visually, performs actions, reads structured data, and can run an
autonomous planning loop.

## Commands

| Task                 | Command                              |
| -------------------- | ------------------------------------ |
| Run tests            | `pnpm test`                          |
| Watch tests          | `pnpm test:watch`                    |
| Typecheck            | `pnpm typecheck`                     |
| Build (emit `dist/`) | `pnpm build`                         |
| Lint                 | `pnpm lint`                          |
| Format               | `pnpm fmt` (check: `pnpm fmt:check`) |
| Verify packaging     | `pnpm check:exports`                 |
| Cut a release        | `pnpm changeset` → merge to `main`   |

Live model tests under `test/live/` are opt-in and require
`GOOGLE_GENERATIVE_AI_API_KEY`; they are excluded from the default run.

## Architecture

The one load-bearing abstraction is `locate(instruction) -> { x, y }` in CSS
pixels. Everything composes from it:

- **instant action** = build context → locate → one driver call
- **planning** = plan → resolve each action's locate → execute

```
src/
  agent.ts            public Agent class (wraps a Playwright Page)
  config.ts           model factory + env
  types.ts            public geometry/result types
  errors.ts           typed error classes

  driver/             PageDriver interface + the Playwright driver, keyboard,
                      DOM-quiet helper. Only this folder imports `playwright`.
  model/              model-tier abstraction, AI SDK call wrappers, Gemini
                      adapter/options, grounding tier, JSON fallback parser
  geometry/           pure coordinate pipeline (normalized → pixel → CSS) + tests
  insight/            locate / query / assert / waitFor, system prompts,
                      two-stage deep-locate, in-page crop helper
  planner/            act() loop, action space, XML response parser, executor,
                      step history, planning prompt
  cache/              xpath-keyed locate cache (YAML)
  extractor/          getXpathsByPoint (injected into the page)
  trace/              JSONL trace sink
  index.ts            package entry — exposes only the public Agent + types
```

### Conventions

- Direct imports to specific files; no barrel `index.ts` re-exports (the package
  entry is the only exception).
- Files use kebab-case names.
- **Relative imports must carry explicit `.js` extensions** (e.g.
  `import { x } from "./foo.js"`). The package is ESM-only and built with `tsc`
  under `NodeNext` resolution; without extensions the emitted `dist` throws
  `ERR_MODULE_NOT_FOUND` in real Node (bundler-based vitest hides this). Verify
  packaging with `pnpm check:exports` (publint + arethetypeswrong).
- `zod` and `playwright` are peer dependencies — both surface in the public API
  (zod schemas in `query`, the Playwright `Page` in the constructor), so the
  consumer owns the single instance.
- `*.injected.ts` files are serialized into the browser via `page.evaluate` and
  must be self-contained (no module-scope references). `vitest.config.ts` sets
  `esbuild.keepNames: false` so injected functions don't pick up a `__name`
  helper that doesn't exist in the page.
- Coordinate spaces are kept distinct: normalized (model output), image pixels
  (screenshot), and CSS pixels (Playwright input, `cssPx = imagePx / dpr`).
  The geometry module is pure and fully unit-tested — treat it as the source of
  truth for any coordinate change.
- Tooling: `oxlint` for linting, `oxfmt` for formatting (pin `oxfmt` to `^0.55`).
