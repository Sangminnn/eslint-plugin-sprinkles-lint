# Changelog

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
