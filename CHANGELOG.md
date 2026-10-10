# Changelog

## 2.20.0

### Changed

- Usage analysis is incremental. The analyzer is split into a per-file extraction (syntax only: exports, imports, how each imported binding is used) and a project-wide link step. A rescan re-reads only files whose mtime or size changed and re-links the graph from stored facts, re-resolving imports each time (resolution also depends on nested `package.json` files, symlinks and `node_modules`, so it is never carried over). A change to compiler options, the root `package.json`, or the plugin, analyzer or TypeScript version starts from scratch. Files modified within two seconds of being read are never reused. A re-analysis after one edit drops from ~1.8 s to ~50 ms on a synthetic 2,000-file project, and from ~2.4–3.7 s to ~0.5–0.8 s on a real Next.js app (~0.7–0.85 s when a file was added), where re-resolving imports and re-expanding the tsconfig `include` dominate.
- Per-file facts persist in `node_modules/.cache/sprinkles-lint/`, so a new `eslint` process continues from the previous run. Missing, unparseable, foreign-format or structurally malformed caches are discarded and trigger a full scan.
- The import resolution step uses TypeScript's module resolution cache (that step alone is >10× faster; overall full-scan time is dominated by parsing and changes little).
- Files git ignores are no longer scanned. Since 2.18.0 the analyzer walked the whole working directory, so a repository holding git worktrees or scratch copies under ignored paths had those stale copies read as consumers; their broken imports refused every proof (one Next.js app: 1,247 unresolved imports from `.worktrees/` and `.scratch/`, 9,831 files scanned instead of 1,900). The scanned set is now the tsconfig file set plus everything git does not ignore; tracked dot-directories such as `.storybook` still count, and an ignored file imported by scanned code still refuses the proof as an unscanned import. Only directories git confirms as ignored in their own right are skipped (a directory that holds nothing but ignored files is still read), and ignore rules from outside the scanned directory — parent `.gitignore` files, `info/exclude`, `core.excludesFile`, git config — are part of change detection. Git is asked only when the file set or one of those files changes. The tsconfig `include` is expanded once per re-analysis, and the tree is walked once unless the new ignore list ignores less than the previous one.
- `server-only` and `client-only` are dropped as framework-provided modules. Next.js aliases them to internal modules at build time, so they are routinely imported without being installed, which used to refuse every proof.
- The in-process freshness check also watches every `package.json` under the scanned tree. Before, switching a nested package's `types`/`exports` without touching a source left a long-lived process (editor ESLint server, watch mode) on the old verdicts until some source changed.
- `src/analyzer/usage-cache.js` no longer contains raw NUL characters (a 2.19.0 authoring slip; behavior was unaffected).

### Notes

- A differential test mutates a project step by step — edits, additions, deletions, an export rename, a nested `package.json` switching the module a directory import resolves to, an edit that preserves mtime, and a tsconfig change — and asserts after each step that the incremental result equals a fresh scan. During development the refactored engine was also compared with the 2.19.0 engine on the test projects and produced identical artifacts.

## 2.19.0

`"sprinkles-lint/no-use-style-declared-sprinkles": "error"` is now a complete configuration.

### Added

- `usageAnalysis` option with three modes. The new default, `auto`, runs the usage analysis in-process the first time a file needs a verdict and caches the verdicts (not the ASTs) for the rest of the process; a file-list sweep detects added, removed or modified files and triggers a rescan. `artifact` keeps the 2.18 flow of a precomputed file via `provenSoloClassesPath` — the right choice when each file is linted in its own process, or to share the result across CI jobs. `off` disables proofs entirely.
- `projectRoot` option, narrowing the scanned tree. The default is the working directory: a proof asserts that no consumer composes the class, so the walk covers everything ESLint was pointed at, and a nested `tsconfig.json` is used to resolve aliases without shrinking it. Narrowing is available but has to be asked for.
- `sprinklesImportSource` is derived from `tsconfig` `paths` when they map unambiguously onto the discovered sprinkles module, so the import a fix has to add no longer needs to be configured. An explicit option still wins, and an ambiguous mapping withholds the fix rather than guessing.

### Notes

- Both analysis modes call the same `analyzeProject`, and a test asserts their output is identical.
- Anything unproven or unresolvable falls back to a suggestion in every mode. Freshness is bounded rather than instantaneous: verdicts are re-derived when a scanned file, the file list, or the tsconfig chain changes, but a cached verdict is reused for up to half a second between checks, so a write from outside the lint run can be one check behind.
- Projects that used no options now get usage-aware autofixes where 2.18 only suggested. Set `usageAnalysis: 'off'` to keep the old behavior.

## 2.18.1

### Fixed

- The analyzer recorded every unresolvable specifier as a graph hole, so ordinary imports — node builtins (`fs`, `node:path`, `fs/promises`), stylesheet and image assets, and declared packages whose resolution fails on export conditions (`server-only`) — made the rule refuse the artifact, which in practice happened in every real project. Those three kinds are now dropped; everything else still counts: a failed relative path (unless it ends in an asset extension), a specifier matching a declared tsconfig `paths` pattern, a name that cannot be an npm package (`@/foo`, `~/foo`, `#foo`), and a package-shaped specifier that is not installed — which is how an undeclared `@components/*` alias or a `baseUrl`-relative `components/Foo` import stays a hole. A `.css` specifier resolving to a `.css.ts` remains a graph edge.

### Added

- `ignoredImports` in the artifact records what was dropped and why (`node-builtin`, `non-module-asset`, `external-package`). The rule does not use it for verification.

### Changed

- Analyzer test fixtures are no longer published; they carried a nested `package.json`, which declared a package boundary inside the installed plugin.

## 2.18.0

### Added

- `sprinkles-lint-analyze` bin: walks the project's import graph (TypeScript >= 4.8 required; tsconfig `paths`, re-exports, star-barrels, `require()`/dynamic imports and intra-css-file composition all handled) and emits an artifact listing every css.ts class proven to be used only standalone — the proof direction is "solo usage proven → hoist", never "composition not detected → hoist". Anything the analyzer cannot resolve is recorded in the artifact instead of being silently skipped.
- `provenSoloClassesPath` rule option: classes proven by the artifact take the real `--fix` path with no allowlist. Missing artifact → 2.17.0 behavior; an artifact with unresolved/unscanned imports, generated without a tsconfig, without recorded inputs, unreadable, or whose recorded inputs no longer match the files on disk, is refused with a warning (re-verified periodically in long-lived processes). Lossless-transform preconditions still apply, and only module-level exports can consume a proof.
- `hoistableOverrideProperties` remains as a property-level escape hatch; the artifact is consulted first.

## 2.17.0

Default behavior unchanged; the `manualSeparationRequired` cases from 2.16.0 become actionable.

### Added

- `manualSeparationRequired` reports now carry a `hoistToSprinkles` IDE suggestion (with import insertion when `sprinklesImportSource` is set). `--fix` still never applies it.
- `hoistableOverrideProperties` option: override-object properties the project declares as never set by a composed base are hoisted by `--fix`. Default `[]`.
- Neither the suggestion nor the allowlist applies to shapes the merge cannot transform losslessly (several override objects, a property on both sides, a spread inside `sprinkles()`); those stay report-only.

### Docs

- Corrected the 2.16.0 README claim that a `@layer` setup removes the cascade risk. Layers protect the unmoved override, but a hoisted value becomes an atom competing in the same layer, so they do not make the move safe.

## 2.16.0

Autofix behavior change for `no-use-style-declared-sprinkles`. Detection is unchanged; the set of cases that receive an automatic fix is narrower.

### Fixed

- `--fix` no longer inserts `sprinkles(...)` into a file that does not import `sprinkles`. When the new `sprinklesImportSource` option is set, the import is added together with the fix; otherwise the problem is reported without a fix.
- Properties inside the override object of `style([sprinkles(...), { ... }])` are no longer moved into the `sprinkles()` call. Hoisting them changes cascade order against classes composed via `className`. These cases are reported with the new `manualSeparationRequired` message and left untouched. Removing a redundant `style([...])` wrapper around a lone `sprinkles(...)` is still auto-fixed.
- The reported property list no longer includes properties that were already inside `sprinkles()`.
- `style([sprinkles({ ... })])` whose `sprinkles()` values are not in the config produced invalid output (`style([, color: ...])`) or dropped composed classes (`style([base, sprinkles({ ... })])` → `style({ ... })`). It now emits `style({ ... })` / `style([base, { ... }])`.

### Known gap

- Override-object properties inside `recipe({ base: [...] })`, `recipe` variants and `styleVariants` arrays are still hoisted into `sprinkles()` by `--fix`.

### Added

- `sprinklesImportSource` option.
- `manualSeparationRequired` message.
- README: option reference, "Autofix safety" section and a recommended `@layer` setup for sprinkles.
