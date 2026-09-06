# Changelog

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
