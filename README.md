# ESLint Plugin for Vanilla Extract Sprinkles

An ESLint plugin that warns when declaring styles without using already defined Sprinkles when using Vanilla Extract's Sprinkles feature.

This Plugin does not support ESLint Flat Config yet.

if you use this plugin, i recommend this way.

```
// package.json
"get-sprinkles-config": "ts-node scripts/exportSprinklesConfig.ts",

// scripts/exportSprinklesConfig.js
const fs = require('fs');
const path = require('path');

async function exportConfig() {
  // dynamic import for your sprinkles.config.js
  const { sprinklesProperties } = await import('your sprinkles.config.js path');

  fs.writeFileSync(
    path.resolve(__dirname, '../.eslintrc.sprinkles.js'),
    `module.exports = ${JSON.stringify(sprinklesProperties, null, 2)};`,
  );
}

exportConfig().catch(console.error);

// then you can get .eslintrc.sprinkles.js file

"sprinkles-lint/no-use-style-declared-sprinkles": [
  "error",
  {
    "configPath": "./.eslintrc.sprinkles.js"
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

```js
// sprinkles.config.js
module.exports = {
  // can use array
  backgroundColor: ["red", "blue", "green"],

  // can use object
  flex: {
    1: "1 1 0%",
  },
};

// ✅
const style = sprinkles({
  backgroundColor: "red",
});

// ✅
const style2 = style([
  sprinkles({
    backgroundColor: "red",
  }),
  {
    display: "flex",
  },
]);

// ❌
const style3 = style({
  backgroundColor: "red",
});
```
