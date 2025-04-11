# ESLint Plugin for Vanilla Extract Sprinkles

An ESLint plugin that warns when declaring styles without using already defined Sprinkles when using Vanilla Extract's Sprinkles feature.

This Plugin does not support ESLint Flat Config yet.

Shorthands also supported.

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

```json
// package.json

"export-sprinkles": "tsx scripts/exportSprinklesConfig.ts",
```

### STEP 4. Add rule to your .eslintrc.js

```js
// .eslintrc.js

"sprinkles-lint/no-use-style-declared-sprinkles": [
  "error",
  {
    "configPath": `${YOUR_CONFIG_FILE_PATH}`
  }
]
```

## Installation

```bash
// npm
npm install eslint-plugin-sprinkles-lint

// yarn
yarn add eslint-plugin-sprinkles-lint

// pnpm
pnpm add eslint-plugin-sprinkles-lint
```

## Usage

```js
// .eslintrc.js
module.exports = {
  plugins: ["sprinkles-lint"],
  rules: {
    "sprinkles-lint/no-use-style-declared-sprinkles": "error",
  },
};
```

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

### Case 2 - Using style with sprinkles in array

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

// to-be
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

### Case 3 - Using style with sprinkles in array, but actually doesn't need style object

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

// to-be

// remove style object and use sprinkles only
const testStyle = sprinkles({
  cursor: "pointer"
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
    cursor: "pointer",
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
    cursor: "pointer",
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
    cursor: "pointer"
  },
});
// to-be
const testStyle2 = recipe({
  // remove style object and use sprinkles only
  base: sprinkles({
    backgroundColor: "red",
  }),
  variants: sprinkles({
    cursor: "pointer",
  }),
});
```
