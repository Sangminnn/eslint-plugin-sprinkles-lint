# Changelog

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
