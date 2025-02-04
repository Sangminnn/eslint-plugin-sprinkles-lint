# ESLint Plugin for Vanilla Extract Sprinkles

An ESLint plugin that warns when declaring styles without using already defined Sprinkles when using Vanilla Extract's Sprinkles feature.

This Plugin does not support ESLint Flat Config yet.

if you use this plugin, i recommend this way.

### STEP 1. Export sprinkles.config.js to .eslintrc.sprinkles.js

```
// scripts/exportSprinklesConfig.js

const fs = require('fs');
const path = require('path');

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

### STEP 2. Run script to export sprinkles.config.js to your .eslintrc.sprinkles.js

```
// package.json

"get-sprinkles-config": "ts-node scripts/exportSprinklesConfig.ts",
```

### STEP 3. Add rule to your .eslintrc.js

```
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
  marginTop: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  cursor: ["pointer"],
  // can use array
  backgroundColor: ["red", "blue", "green"],

  // can use object
  flex: {
    1: "1 1 0%",
  },
};
```

### Case 1 - Default case (using style only)

```js
// as-is
const testStyle = style({
  backgroundColor: "red",
});

// to-be
const testStyle = sprinkles({
  backgroundColor: "red",
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
  cursor: "pointer",
  backgroundColor: "red",
  marginTop: 1,
});
```
