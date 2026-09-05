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
| `configPath` | `string` | Path to the exported sprinkles config (see STEP 1–3). |
| `sprinklesImportSource` | `string` | Module specifier used when `--fix` has to add `import { sprinkles } from '...'` to a file that does not import it yet (e.g. `'@/styles/sprinkles.css'`). Without it, files that do not import `sprinkles` are reported but **not** auto-fixed. |
| `provenSoloClassesPath` | `string` | Path to the artifact produced by `sprinkles-lint-analyze`. Classes proven to be used only standalone are hoisted by `--fix` without any allowlist (see [Usage-aware hoisting](#usage-aware-hoisting-sprinkles-lint-analyze)). |
| `hoistableOverrideProperties` | `string[]` | Properties the project knows are never set by any composed component base. When every movable property of an override object is in this list, `--fix` hoists it into `sprinkles()`; otherwise the case is only reported with an IDE suggestion (see [Autofix safety §2](#2-override-objects-composed-with-other-classes-no-autofix-by-default)). Default `[]`. |

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

Detection always runs. For `style(...)` calls, `--fix` is only offered when applying it keeps the file compiling and rendering the same — unless the project opts a property in via `hoistableOverrideProperties`. See the known gap below for `recipe` / `styleVariants`.

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

Three ways to move the property without retyping it, in the order the rule consults them:

- **Usage-aware proof (recommended)** — run `sprinkles-lint-analyze` and point `provenSoloClassesPath` at its output. A class proven to be used only standalone has no competing class on the same element, so `--fix` hoists it. See [Usage-aware hoisting](#usage-aware-hoisting-sprinkles-lint-analyze).

- **IDE suggestion** — the report carries a `hoistToSprinkles` quick-fix (when the file imports `sprinkles` or `sprinklesImportSource` is set — the same precondition as `--fix`). `--fix` never applies suggestions; you check the call sites, then apply it per case from your editor.
- **`hoistableOverrideProperties`** — if the project knows a property is never declared by any component base (`minHeight`, `objectFit`, `cursor`, …), list it in the option and `--fix` hoists it automatically. Only override objects whose *every* movable property is listed are fixed; the rest stay suggestions. The default is an empty list, so nothing moves unless the project says so.

Neither path is offered for shapes the transformation cannot handle losslessly — more than one override object, a property declared on both sides, or a spread inside `sprinkles()`. Those are reported only.

**Known gap:** the same hoisting is still auto-fixed inside `recipe({ base: [...] })`, `recipe` variants and `styleVariants` arrays, and `hoistableOverrideProperties` has no effect there. Review `--fix` output in those places.

### 3. Standalone `style({...})` (autofixed, verify composition)

`style({ width: 'auto' })` → `sprinkles({ width: 'auto' })` is still auto-fixed. Whether that class is later composed with another component's base class cannot be known from the file, so check call sites that pass it as `className` to a component with its own `width`.

### Usage-aware hoisting (`sprinkles-lint-analyze`)

The composition hazard lives outside the linted file, so the rule alone cannot tell a dangerous override from a simple non-separation. vanilla-extract closes that gap: class names are build-time hashes, so **every consumer must import the class** — walking the import graph yields the complete consumer list, and "no usage found" genuinely means unused. The analyzer uses this to *prove* solo usage instead of trying to *detect* composition (a detection miss would hoist and regress; a proof miss only leaves a suggestion).

```bash
# before lint (e.g. as a CI step); requires `typescript` >= 4.8 in the project
npx sprinkles-lint-analyze --root . --tsconfig tsconfig.json --out .sprinkles-lint/proven-solo-classes.json
```

The analyzer scans every `.ts/.tsx/.js/.jsx/.mjs/.cjs` file under `--root` — a full directory walk in addition to the tsconfig file set, dot-directories like `.storybook` included, so consumers outside `include` are still seen. A fixed list of build directories (`node_modules`, `dist`, `build`, `coverage`, `storybook-static`, `.git`, `.next`, `.turbo`, `.yarn`) is skipped and recorded in the artifact. A tsconfig is required (aliases are unresolvable without one; the rule refuses an artifact generated without it). `--exclude glob,glob` removes files from the scan — **an excluded file's compositions become invisible and can turn into false proofs**, so exclude only files that never render classes; excluded paths are recorded in the artifact.

```js
"sprinkles-lint/no-use-style-declared-sprinkles": ["error", {
  "configPath": "./sprinkles.config.js",
  "sprinklesImportSource": "@/styles/sprinkles.css",
  "provenSoloClassesPath": ".sprinkles-lint/proven-solo-classes.json"
}]
```

A class is **proven** only when every reference the analyzer sees is `className={styles.x}` alone on an intrinsic tag (lowercase, no dot — `<div>`, `<span>`, …), or when it has no reference at all. The invariant behind that claim: every reference to a css binding either records a verdict or poisons its module — passed to a component, composed via `clsx`/conditional/array/template, aliased to a variable or via `export { x as y }`, `styleVariants` member access, sent through a non-`className` prop or a spread, referenced inside its own css.ts, re-exported locally or as `export * as ns`, reached by `require()`/dynamic `import()`/default or namespace-of-barrel import, or by dynamic access (`styles[key]` marks the whole file) — all unproven with the reason recorded. A verdict that cannot be attributed to a known export poisons everything reachable from that module.

What the analyzer cannot pin down does not stay silent either: every unresolvable specifier that could reach project code and every resolvable-but-unscanned project file is written into the artifact, and **the rule refuses such an artifact entirely** (warning, suggestion-only fallback) — likewise one generated without a tsconfig, with no recorded inputs, or unreadable. Staleness is checked against disk: when any recorded input no longer matches its hash the artifact is refused until the analyzer is re-run (re-verified at most every 10 seconds in long-lived processes such as editor lint servers), which is why the intended setup is regenerating the artifact right before lint. An unresolved import only counts against you when it could actually hide project code. Three kinds are dropped and listed under `ignoredImports` for debugging:

| Dropped | Why it cannot hide a css module |
|---|---|
| Node builtins — `fs`, `node:path`, `fs/promises` | Cannot import project files |
| Non-module assets — `.css`, `.svg`, `.png`, `.json`, … | Cannot host a vanilla-extract class. A `.css` specifier that resolves to a `.css.ts` never reaches this test: TypeScript substitutes the extension, so it stays a real graph edge |
| Packages declared in `package.json` or present in `node_modules` — `server-only` | Resolution can fail on export conditions; the package still cannot import your css modules |

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

### Case 1 - Default case (using style only)

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

// to-be
const testStyle3 = sprinkles({
  // etc ...
  color: 'gray-100' // auto transform and remove empty style object
})
```
