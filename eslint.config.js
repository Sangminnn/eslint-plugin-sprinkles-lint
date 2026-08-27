const sprinklesLint = require('./src/index.js');

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
          configPath: "./src/sprinkles.js",
        }
      ],
    },
  },
];
