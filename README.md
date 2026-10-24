# ESLint Plugin for Vanilla Extract Sprinkles

An ESLint plugin that warns when declaring styles without using already defined Sprinkles when using Vanilla Extract's Sprinkles feature.

✅ **ESLint Flat Config 지원** - Legacy `.eslintrc` 및 최신 `eslint.config.js` 모두 지원

✅ **Shorthands 지원** - px, py, mx, my 등 단축 속성 지원

and If you're directly using values that exist in your sprinkles config, this lint rule will automatically convert them to their corresponding sprinkles keys.

```js
// ex

const sprinklesConfig = {
  color: {
    'gray-100': '#fafafa',
    'gray-200': '#f0f0f0',
    // .. 
  }
}

// as-is
const yourStyleAsIs = style({
  color: '#fafafa'
})

// to-be
const yourStyleToBe = sprinkles({
  color: 'gray-100'
})
```


# Guide

if you use this plugin, i recommend this way.

### STEP 1. Split your config file

i recommend you to use separated config file and using this to import in your sprinkles.css.ts 

```ts
export const sprinklesProperties = {
  position: ['absolute', 'relative', 'fixed', 'sticky'],
  display: ['none', 'flex', 'inline-flex', 'block', 'inline', 'grid'],
  flexDirection: ['row', 'column'],
  justifyContent: ['stretch', 'flex-start', 'center', 'flex-end', 'space-around', 'space-between'],
  alignItems: ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'],
  fontWeight: [500, 700],
  lineHeight: ['normal', 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6]
} as const;

export const colorSprinklesProperties = {
  color: theme.colors,
  backgroundColor: theme.colors,
} as const;

type Shorthands = Record<string, Array<keyof typeof sprinklesProperties>>;

export const shorthands = {
  p: ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight'],
  px: ['paddingLeft', 'paddingRight'],
  py: ['paddingTop', 'paddingBottom']
} satisfies Shorthands;

```

### STEP 2. Export sprinkles.config.js to .eslintrc.sprinkles.js


- if you don't want shorthands

```js
// scripts/exportSprinklesConfig.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function exportConfig() {
  // dynamic import for your sprinkles.config.js
  const { sprinklesProperties } = await import(`${YOUR_SPRINKLES_CONFIG_PATH}`);

  fs.writeFileSync(
    path.resolve(__dirname, `${YOUR_CONFIG_FILE_PATH}`),
    `module.exports = ${JSON.stringify(sprinklesProperties, null, 2)};`,
  );
}

exportConfig().catch(console.error);
```

- if you want shorthands

```js
// scripts/exportSprinklesConfig.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function exportConfig() {
  const { sprinklesProperties, shorthands } = await import('../src/constants/sprinkles');

  fs.writeFileSync(
    path.resolve(__dirname, '../.eslintrc.sprinkles.js'),
    `module.exports = {
      properties: ${JSON.stringify(sprinklesProperties, null, 2)},
      shorthands: ${JSON.stringify(Object.keys(shorthands), null, 2)}
    };`,
  );
}

exportConfig().catch(console.error);
```

### STEP 3. Run script to export sprinkles.config.js to your .eslintrc.sprinkles.js. With [tsx](https://www.npmjs.com/package/tsx), you can run ESM script in Node.js

```js
// package.json

"export-sprinkles": "tsx scripts/exportSprinklesConfig.ts",
```

### STEP 4. Add rule to your ESLint config

**Flat Config (eslint.config.js)**:
```js
// eslint.config.js
const sprinklesLint = require('eslint-plugin-sprinkles-lint');

module.exports = [
  {
    files: ["**/*.js", "**/*.jsx", "**/*.ts", "**/*.tsx"],
    plugins: {
      "sprinkles-lint": sprinklesLint,
    },
    rules: {
      "sprinkles-lint/no-use-style-declared-sprinkles": [
        "error",
        {
          configPath: `${YOUR_CONFIG_FILE_PATH}`
        }
      ],
    },
  },
];
```

**Legacy Config (.eslintrc.js)**:
```js
// .eslintrc.js
module.exports = {
  plugins: ["sprinkles-lint"],
  rules: {
    "sprinkles-lint/no-use-style-declared-sprinkles": [
      "error",
      {
        configPath: `${YOUR_CONFIG_FILE_PATH}`
      }
    ]
  }
};
```

## Installation

```bash
# npm
npm install eslint-plugin-sprinkles-lint

# yarn
yarn add eslint-plugin-sprinkles-lint

# pnpm
pnpm add eslint-plugin-sprinkles-lint
```

## Usage

### ESLint Flat Config (eslint.config.js) - 권장

```js
// eslint.config.js
const sprinklesLint = require('eslint-plugin-sprinkles-lint');

module.exports = [
  {
    files: ["**/*.js", "**/*.jsx", "**/*.ts", "**/*.tsx"],
    plugins: {
      "sprinkles-lint": sprinklesLint,
    },
    rules: {
      "sprinkles-lint/no-use-style-declared-sprinkles": [
        "error",
        {
          configPath: './path/to/your/sprinkles.config.js'
        }
      ],
    },
  },
];
```

### Legacy Config (.eslintrc.js)

```js
// .eslintrc.js
module.exports = {
  plugins: ["sprinkles-lint"],
  rules: {
    "sprinkles-lint/no-use-style-declared-sprinkles": [
      "error",
      {
        configPath: './path/to/your/sprinkles.config.js'
      }
    ],
  },
};
```

### Options

| Option | Type | Description |
|---|---|---|
Every option is optional — `"error"` on its own is a complete configuration.

| Option | Type | Description |
|---|---|---|
| `usageAnalysis` | `'auto' \| 'artifact' \| 'off'` | How the rule learns which classes are used standalone. `auto` (default) analyses the project in-process; `artifact` reads a file written by `sprinkles-lint-analyze`; `off` skips proofs and only suggests. See [Usage-aware hoisting](#usage-aware-hoisting). |
| `projectRoot` | `string` | Narrows the scanned tree to this directory. Defaults to the working directory, which is what keeps a proof honest — see [the note on narrowing](#usage-aware-hoisting). |
| `configPath` | `string` | Path to the exported sprinkles config (see STEP 1–3). Omit it to let the plugin discover `sprinkles.css.ts` itself. |
| `sprinklesImportSource` | `string` | Module specifier used when `--fix` has to add `import { sprinkles } from '...'`. Derived from your `tsconfig` `paths` when it maps unambiguously onto the discovered sprinkles module; set it explicitly when it does not. |
| `provenSoloClassesPath` | `string` | Artifact produced by `sprinkles-lint-analyze`; implies `usageAnalysis: 'artifact'`. |
| `hoistableOverrideProperties` | `string[]` | Properties the project knows are never set by any composed component base. When every movable property of an object is in this list, `--fix` hoists it into `sprinkles()` without a usage proof — as long as every composed class in the same array could be read and none of them sets the property; otherwise the case is only reported with an IDE suggestion (see [Autofix safety §2](#2-override-objects-composed-with-other-classes-no-autofix-by-default)). Default `[]`. |

```js
"sprinkles-lint/no-use-style-declared-sprinkles": [
  "error",
  {
    configPath: './path/to/your/sprinkles.config.js',
    sprinklesImportSource: '@/styles/sprinkles.css',
    hoistableOverrideProperties: ['minHeight', 'cursor', 'objectFit'],
  },
],
```

## Autofix safety

Detection always runs. `--fix` is only offered when applying it keeps the file compiling and rendering the same. The rule rests on one cascade fact: an override must stay a `style()` rule. A local rule is emitted after the sprinkles sheet and beats an atom; once the override is itself an atom it loses to any `style()` rule for the same property, and against another atom the winner is just the order of the scale array.

### 1. `sprinkles` import

Replacing `style({...})` with `sprinkles({...})` in a file that never imports `sprinkles` breaks compilation (`TS2304: Cannot find name 'sprinkles'`). The rule therefore:

- applies the fix as-is when the file already imports `sprinkles`,
- inserts `import { sprinkles } from '<sprinklesImportSource>'` together with the fix when the option is set,
- reports without a fix otherwise.

### 2. Override objects composed with other classes (no autofix by default)

```js
// Button base: sprinkles({ width: '100%' })
export const removeButton = style([
  typography,
  sprinkles({ marginLeft: 6 }),
  { width: 'auto' }, // overrides Button's width when composed via className
]);
```

`width: 'auto'` exists in sprinkles, but it must **not** be hoisted into the `sprinkles()` call. A sprinkles atom and a local `style()` rule are both single-class selectors with equal specificity, so the winner is decided by sheet order: local `style()` rules are emitted after the sprinkles sheet and win, while atoms are ordered by their position in the scale array. Moving the property flips the cascade — in the case above the button stretched to full width.

**Why `--fix` skips this shape.** A local `style()` rule is emitted after the sprinkles sheet, so for normal declarations it beats an atom for the same property. Once the value is moved into `sprinkles()` it becomes an atom too: the contest is now decided by the order of the scale array, and the author has lost the only way to say "this must win". The competing class (a component base, for example) lives in another file the rule cannot see — and a file that overrides a composed class looks byte-for-byte identical to one that simply forgot to use sprinkles. So for `style([sprinkles(...), { ... }])` the rule reports `manualSeparationRequired` and, by default, leaves the code untouched.

What the rule does about it, for `style()`, `recipe()` and `styleVariants()` alike:

- **Properties something else on the element is known to set stay where they are.** The rule reads the classes composed next to the object when they are declared in the same file (`const base = style(...)`, followed through arrays, `style()` calls and `sprinkles()` calls), plus CSS shorthands (`margin` covers `marginTop`; logical properties cover both physical sides), `@media`/`@supports`/`@container` blocks and `selectors: { '&': … }`. A property that overlaps is not reported at all: it is a deliberate override. The same holds inside one object (`marginRight` next to `margin` stays) and against the `sprinkles()` call in the same array.
- **Values already inside `sprinkles()` never move out**, so a conditional value (`{ mobile, desktop }`) or a token never becomes a style rule.
- **When a composed class cannot be read** — imported, a call result, a spread, a destructured, reassigned or `globalStyle`-extended binding, or a sprinkles shorthand whose mapping the plugin does not know — the move is offered as a suggestion only, whatever the options say.
- In `recipe()`, a variant value competes with `base` and with every value of every *other* group (groups apply together; values of one group never do). `base` competes with variant and compound values that are not inline objects (classes declared before the recipe, `sprinkles()` atoms). Inline variants are generated after `base` and keep winning once `base` is an atom.

When nothing overlaps and every composed class could be read, three ways remain to move the property, in the order the rule consults them:

- **Usage-aware proof (default)** — the rule analyses the project and hoists a class it can prove is only ever used standalone, because then no competing class shares the element. Nothing to configure. See [Usage-aware hoisting](#usage-aware-hoisting).

- **IDE suggestion** — the report carries a `hoistToSprinkles` quick-fix (when the file imports `sprinkles` or `sprinklesImportSource` is set — the same precondition as `--fix`). `--fix` never applies suggestions; you check the call sites, then apply it per case from your editor.
- **`hoistableOverrideProperties`** — if the project knows a property is never declared by any component base (`minHeight`, `objectFit`, `cursor`, …), list it in the option and `--fix` hoists it automatically. Only objects whose *every* movable property is listed are fixed; the rest stay suggestions. The list speaks for what the rule cannot see on the element (component bases); it does not override a composed class the rule can read and finds overlapping, nor make an unreadable one safe. The default is an empty list, so nothing moves unless the project says so.

Neither path is offered for shapes the transformation cannot handle losslessly — the same name in two override objects, an element the template would drop (a nested array, a spread), or a spread or computed key inside `sprinkles()`. Those are reported only.

`recipe()` and `styleVariants()` values never carry a usage proof (they are reached through calls and member access), so only the structural checks above apply to them. A recipe class passed as `className` to a component can still meet that component's base; review those call sites.

### 3. Standalone `style({...})` (fixed only when proven)

`style({ width: 'auto' })` meets whatever else its element gets — a component's base class, another class in `clsx()` — and nothing in the file says which. So `--fix` only rewrites it to `sprinkles({ width: 'auto' })` when the class is proven to be used standalone (or its properties are listed in `hoistableOverrideProperties`). Otherwise it is reported as `unprovenUsage` with the same `hoistToSprinkles` suggestion. A class referenced inside its own css.ts (composed into another class there) is never proven: its rules reach every element that gets the composing class.

Upgrading from 2.20 or earlier can therefore leave errors that `--fix` no longer clears, wherever the analysis cannot prove a class (no tsconfig, imports it cannot follow, `usageAnalysis: 'off'`, or real composition). Apply the suggestion after checking the call sites, or list the property in `hoistableOverrideProperties`.

### Usage-aware hoisting

The composition hazard lives outside the linted file, so the rule alone cannot tell a dangerous override from a simple non-separation. vanilla-extract closes that gap: class names are build-time hashes, so **every consumer must import the class** — walking the import graph yields the complete consumer list, and "no usage found" genuinely means unused. The rule uses this to *prove* solo usage instead of trying to *detect* composition (a detection miss would hoist and regress; a proof miss only leaves a suggestion).

```js
// this is the whole configuration
"sprinkles-lint/no-use-style-declared-sprinkles": "error"
```

In the default `auto` mode the rule runs that analysis itself, the first time a file actually needs a verdict, and keeps the verdicts in memory for the rest of the process. A verdict is requested when a `style()` class has a property to move, so a lint of files where nothing would move costs nothing. Requires `typescript` >= 4.8 in the project.

**Incremental by design.** The first scan reads every file once and keeps, per file, the small set of syntax facts the analysis needs (exports, imports, how each imported class is used) — not the source or the AST. After that, a change re-reads only the files whose mtime or size moved and re-links the graph from the stored facts. Imports are re-resolved on every re-link rather than remembered, because resolution also depends on things that are not scanned sources (a nested `package.json`'s `types`/`exports`, symlinks, `node_modules`). A change to compiler options, the root `package.json`, or the plugin, analyzer or TypeScript version starts over.

The facts are also written to `node_modules/.cache/sprinkles-lint/`, so a new process — `yarn lint`, lint-staged — continues from the previous run instead of rescanning. A cache that is missing, unreadable, of another format, or structurally malformed is discarded and the scan starts over; the check is structural, the same trust as any other file in `node_modules`. Projects without a `node_modules` directory get no disk cache.

| | Synthetic 2,000-file project | Real Next.js app (1,900 scanned files, 4,700 distinct imports) |
|---|---|---|
| First scan | ~1–2 s | ~2.4–3.7 s |
| Re-analysis after editing one file (same process) | ~50 ms | ~0.5–0.8 s |
| Re-analysis after adding a file (asks git again) | ~80 ms | ~0.7–0.85 s |
| New process, one file edited, disk cache present | ~0.35 s including Node, ESLint and TypeScript start-up | not measured |

On real projects a re-analysis is dominated by work that is redone on purpose rather than by parsing: expanding the tsconfig `include`, walking the tree, and re-resolving every import (resolution depends on files that are not sources, so it is never carried over).

Change detection compares mtime and size, as `eslint --cache` does by default. A file whose mtime falls within two seconds of when it was read is never reused (it could still be rewritten within the same clock tick on filesystems with coarse timestamps). A tool that deliberately rewrites a file while preserving both mtime and size (`cp -p`, `rsync -t` of same-sized content) is not noticed until the file changes again.

**What gets scanned.** Every source file TypeScript's tsconfig includes, plus every source file under the working directory that git does not ignore — tracked dot-directories such as `.storybook` included. Git-ignored trees (worktrees, scratch copies, build output) are skipped: they hold stale copies of the sources whose broken imports would otherwise refuse every proof. Only directories git confirms as ignored in their own right are skipped — a directory that merely contains nothing but ignored files (a lone `.DS_Store`) is still read. Ignore rules from above the scanned directory, `info/exclude`, `core.excludesFile` and every git config file git reads (including `[include]`d ones) count, and editing any of them triggers a rescan. An ignored file that scanned code imports still shows up as an unscanned import and refuses the proof. Outside a git repository, without git, or when the scanned directory is itself ignored by an enclosing repository, the whole tree is read.

The trade-off: a git-ignored file that is outside the tsconfig `include`, is imported by no scanned file, and composes a class itself is not seen. That is a generated or local file acting as its own entry point; if your project has such files, include them in tsconfig.

**Why the whole working directory.** A proof states that *no* consumer composes the class, which is only true if every consumer was looked at. The scanned tree is therefore the directory ESLint runs in — never the package the file happens to live in — even when a nested `tsconfig.json` exists (that nested config is still used to resolve `@/…`, it just does not shrink the walk). Consumers whose imports the graph cannot follow, such as another package's alias, show up as unresolved and disable proofs for the whole run rather than being quietly excluded.

`projectRoot` narrows that tree. It is a statement by you that nothing outside it composes these classes, so use it only when that holds — for a monorepo package linted on its own, for instance.

**Freshness.** A change to any scanned file, an added or deleted file, any `package.json` under the scanned tree, or an edit to the tsconfig chain triggers a rescan. Between checks there is a short window (half a second) in which cached verdicts are reused without re-reading the file list; a write landing inside that window from outside the lint run — a `git pull`, a code generator — is picked up on the next check rather than immediately.

#### `artifact` mode — precomputed verdicts

When every file is linted in its own short-lived process (`lint-staged` one file at a time) the scan cannot be amortised, and in CI you may prefer to compute it once and cache the result. Run the analyzer up front and point the rule at its output:

```bash
npx sprinkles-lint-analyze --root . --tsconfig tsconfig.json --out .sprinkles-lint/proven-solo-classes.json
```

```js
"sprinkles-lint/no-use-style-declared-sprinkles": ["error", {
  "provenSoloClassesPath": ".sprinkles-lint/proven-solo-classes.json"
}]
```

Both modes call the same analysis and reach the same verdicts; only the timing differs. `usageAnalysis: 'off'` disables proofs entirely and leaves every guarded case as a suggestion.

The analyzer scans every `.ts/.tsx/.js/.jsx/.mjs/.cjs` file under `--root` — a full directory walk in addition to the tsconfig file set, dot-directories like `.storybook` included, so consumers outside `include` are still seen. A fixed list of build directories (`node_modules`, `dist`, `build`, `coverage`, `storybook-static`, `.git`, `.next`, `.turbo`, `.yarn`) is skipped and recorded in the artifact. A tsconfig is required (aliases are unresolvable without one; the rule refuses an artifact generated without it). `--exclude glob,glob` removes files from the scan — **an excluded file's compositions become invisible and can turn into false proofs**, so exclude only files that never render classes; excluded paths are recorded in the artifact.

A class is **proven** only when every reference the analyzer sees is `className={styles.x}` alone on an intrinsic tag (lowercase, no dot — `<div>`, `<span>`, …), or when it has no reference at all. The invariant behind that claim: every reference to a css binding either records a verdict or poisons its module — passed to a component, composed via `clsx`/conditional/array/template, aliased to a variable or via `export { x as y }`, `styleVariants` member access, sent through a non-`className` prop or a spread, referenced inside its own css.ts, re-exported locally or as `export * as ns`, reached by `require()`/dynamic `import()`/default or namespace-of-barrel import, or by dynamic access (`styles[key]` marks the whole file) — all unproven with the reason recorded. A verdict that cannot be attributed to a known export poisons everything reachable from that module.

What the analyzer cannot pin down does not stay silent either: every unresolvable specifier that could reach project code and every resolvable-but-unscanned project file is written into the artifact, and **the rule refuses such an artifact entirely** (warning, suggestion-only fallback) — likewise one generated without a tsconfig, with no recorded inputs, or unreadable. Staleness is checked against disk: when any recorded input no longer matches its hash the artifact is refused until the analyzer is re-run (re-verified at most every 10 seconds in long-lived processes such as editor lint servers), which is why the intended setup is regenerating the artifact right before lint. An unresolved import only counts against you when it could actually hide project code. Three kinds are dropped and listed under `ignoredImports` for debugging:

| Dropped | Why it cannot hide a css module |
|---|---|
| Node builtins — `fs`, `node:path`, `fs/promises` | Cannot import project files |
| Non-module assets — `.css`, `.svg`, `.png`, `.json`, … | Cannot host a vanilla-extract class. A `.css` specifier that resolves to a `.css.ts` never reaches this test: TypeScript substitutes the extension, so it stays a real graph edge |
| Packages declared in `package.json` or present in `node_modules` — `server-only` | Resolution can fail on export conditions; the package still cannot import your css modules |

`server-only` and `client-only` are also dropped (reason `framework-module`): Next.js aliases them to internal modules at build time, so they are commonly imported without being installed.

Everything else is recorded as unresolved and refuses the artifact: a failed relative path, a specifier matching a declared tsconfig `paths` pattern, a name that cannot be an npm package (`@/foo`, `~/foo`, `#foo`), and a package-shaped specifier that is not actually installed — that last one is how an undeclared `@components/*` alias or a `baseUrl`-relative import such as `components/Foo` is caught.

Two consequences worth knowing. A failed **relative** path ending in an asset extension (`./missing.css`) is dropped by the asset rule before the relative rule is reached — deliberate, since that is exactly the shape of a plain stylesheet import. And a project alias that both collides with an installed package name and is missing from tsconfig `paths` would be dropped, so declare every alias in `paths`.

The lossless-transform preconditions above still apply to proven classes; proof of solo usage never bypasses them, and only module-level `export const` declarations can consume a proof.

### Cascade layers: what they do and do not solve

Putting sprinkles atoms in a `@layer` guarantees that unlayered normal declarations — your local `style()` rules — win over atoms regardless of sheet order (`!important` reverses layer order, so it is the one exception). That makes the *unmoved* override pattern (`style([sprinkles(...), { width: 'auto' }])`) robust.

It does **not** make hoisting safe: once the override is moved into `sprinkles()`, both competitors are atoms in the same layer and the winner is again the scale-array order. Layers are therefore not a substitute for the guard above or for `hoistableOverrideProperties`.

```ts
// sprinkles.css.ts
import { layer } from '@vanilla-extract/css';
import { defineProperties, createSprinkles } from '@vanilla-extract/sprinkles';

export const sprinklesLayer = layer();

const properties = defineProperties({
  '@layer': sprinklesLayer,
  properties: { /* ... */ },
});

export const sprinkles = createSprinkles(properties);
```

`layer()` and the `'@layer'` option of `defineProperties` are documented in the vanilla-extract docs ([layer](https://vanilla-extract.style/documentation/api/layer/), [sprinkles](https://vanilla-extract.style/documentation/packages/sprinkles/)). Cascade layers are not polyfilled — check your browser support matrix.

## Example

### Default Setting

```js
// sprinkles.config.js
module.exports = {
  properties: {
    marginTop: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    cursor: ["pointer"],
    // can use array
    backgroundColor: ["red", "blue", "green"],
  
    // can use object
    flex: {
      1: "1 1 0%",
    },
  },
  shorthands: ["p", "px", "py"],
};
```

### Case 1 - Default case (using style only, fixed when the class is proven standalone)

```js
// as-is
const testStyle = style({
  backgroundColor: "red",
  px: 1
});

// to-be
const testStyle = sprinkles({
  backgroundColor: "red",
  px: 1 // lint aware 'px' in sprinkles (by shorthands)
});
```

### Case 2 - Using style with sprinkles in array (reported, not autofixed by default)

```js
// as-is
const testStyle = style([
  sprinkles({
    backgroundColor: "red",
    marginTop: 5,
  }),
  {
    marginTop: 1,
    display: "flex",
  },
]);

// reported: `'marginTop' can move to Sprinkles, but it sits in an override object ...`
// move it manually once you have confirmed the class is not overriding a composed class:
const testStyle = style([
  sprinkles({
    backgroundColor: "red",
    marginTop: 1, // you can also remove duplicated property
  }),
  {
    display: "flex",
  },
]);
```

See [Autofix safety](#2-override-objects-composed-with-other-classes-no-autofix-by-default) for why this case is not auto-fixed.

### Case 3 - Using style with sprinkles in array, but actually doesn't need style object (reported, not autofixed by default)

```js
// as-is
const testStyle = style([
  sprinkles({
    cursor: "pointer",
  }),
  {
    backgroundColor: "red", // already defined in sprinkles
    marginTop: 1, // already defined in sprinkles
  },
]);

// reported: `'backgroundColor, marginTop' can move to Sprinkles, but it sits in an override object ...`
// after moving them manually, the wrapper becomes removable (Style wrapper should be removed — autofixed):
const testStyle = sprinkles({
  cursor: "pointer",
  backgroundColor: "red",
  marginTop: 1,
});
```

### Case 4 - Using Recipe

```js
// as-is
const testStyle = recipe({
  base: {
    backgroundColor: "red",
  },
  variants: {
    cursor: "pointer"
  },
});

// to-be
const testStyle = recipe({
  // remove base style object and use sprinkles only
  base: sprinkles({
    backgroundColor: "red",
  }),
  variants: {
    true: sprinkles({
      cursor: "pointer",
    })
  },
});
```

### Case 5 - Using style with sprinkles in recipe

```js
// as-is
const testStyle2 = recipe({
  base: style([{
    backgroundColor: "red",
  }]),
  variants: {
    cursor: "pointer"
  },
});

// to-be
const testStyle2 = recipe({
  // remove style object and use sprinkles only
  base: sprinkles({
    backgroundColor: "red",
  }),
  variants: {
    true: sprinkles({
      cursor: "pointer",
    })
  },
});
```

### Case 6 - Using style with sprinkles in recipe, but actually doesn't need style object

```js
// as-is
const testStyle2 = recipe({
  base: [sprinkles({
    backgroundColor: "red",
  }), {

  }],
  variants: {
    true: sprinkles({
      cursor: "pointer",
    })
  },
});
// to-be
const testStyle2 = recipe({
  // remove style object and use sprinkles only
  base: sprinkles({
    backgroundColor: "red",
  }),
  variants: {
    true: sprinkles({
      cursor: "pointer",
    })
  },
});
```

### Case 7 - Using style value in sprinkles not key

```js
const testStyle3 = style([
  sprinkles({
    // etc ...
  }),
  {
    color: '#fafafa' // you have '#fafafa' in sprinkles, and that is 'gray-100' (gray-100: #fafafa)
  }
])

// to-be (when the class is proven standalone or `color` is allowlisted; otherwise a suggestion)
const testStyle3 = sprinkles({
  // etc ...
  color: 'gray-100' // auto transform and remove empty style object
})
```
