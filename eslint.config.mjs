import sprinklesPlugin from "./src/index.js";
import { sprinklesConfig } from "./src/sprinkles.js";

export default [
  {
    plugins: {
      "vanilla-extract": sprinklesPlugin,
    },
    rules: {
      "vanilla-extract/no-use-style-declared-sprinkles": [
        "error",
        {
          sprinklesConfig,
        },
      ],
    },
  },
];
