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

```js
"sprinkles-lint/no-use-style-declared-sprinkles": [
  "error",
  {
    configPath: './path/to/your/sprinkles.config.js',
    sprinklesImportSource: '@/styles/sprinkles.css',
  },
],
```

## Autofix safety

Detection always runs. For `style(...)` calls, `--fix` is only offered when applying it keeps the file compiling and rendering the same. See the known gap below for `recipe` / `styleVariants`.

### 1. `sprinkles` import

Replacing `style({...})` with `sprinkles({...})` in a file that never imports `sprinkles` breaks compilation (`TS2304: Cannot find name 'sprinkles'`). The rule therefore:

- applies the fix as-is when the file already imports `sprinkles`,
- inserts `import { sprinkles } from '<sprinklesImportSource>'` together with the fix when the option is set,
- reports without a fix otherwise.

### 2. Override objects composed with other classes (no autofix)

```js
// Button base: sprinkles({ width: '100%' })
export const removeButton = style([
  typography,
  sprinkles({ marginLeft: 6 }),
  { width: 'auto' }, // overrides Button's width when composed via className
]);
```

`width: 'auto'` exists in sprinkles, but it must **not** be hoisted into the `sprinkles()` call. A sprinkles atom and a local `style()` rule are both single-class selectors with equal specificity, so the winner is decided by sheet order: local `style()` rules are emitted after the sprinkles sheet and win, while atoms are ordered by their position in the scale array. Moving the property flips the cascade — in the case above the button stretched to full width.

For `style([sprinkles(...), { ... }])` the rule reports `manualSeparationRequired` and leaves the code untouched. Move the property yourself only after confirming the class is not composed with another class that sets the same property.

**Known gap:** the same hoisting is still auto-fixed inside `recipe({ base: [...] })`, `recipe` variants and `styleVariants` arrays. Review `--fix` output in those places (or use the cascade-layer setup below, which makes the move safe everywhere).

### 3. Standalone `style({...})` (autofixed, verify composition)

`style({ width: 'auto' })` → `sprinkles({ width: 'auto' })` is still auto-fixed. Whether that class is later composed with another component's base class cannot be known from the file, so check call sites that pass it as `className` to a component with its own `width`.

### Recommended: put sprinkles in a cascade layer

Both risks above disappear when sprinkles atoms live in a `@layer`: unlayered styles (your local `style()` rules) always win over layered ones, regardless of sheet order.

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

### Case 2 - Using style with sprinkles in array (reported, not autofixed)

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

See [Autofix safety](#2-override-objects-composed-with-other-classes-no-autofix) for why this case is not auto-fixed.

### Case 3 - Using style with sprinkles in array, but actually doesn't need style object (reported, not autofixed)

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
