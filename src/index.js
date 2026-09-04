const noUseStyleDeclaredSprinkles = require("./rules/no-use-style-declared-sprinkles.js");

// 플러그인 객체 정의
const plugin = {
  meta: {
    name: "eslint-plugin-sprinkles-lint",
    version: "2.18.0",
  },
  rules: {
    "no-use-style-declared-sprinkles": noUseStyleDeclaredSprinkles,
  },
  configs: {}, // 아래에서 채워질 예정
};

// 순환 참조를 피하기 위한 설정 할당
Object.assign(plugin.configs, {
  recommended: {
    plugins: {
      "sprinkles-lint": plugin,
    },
    rules: {
      "sprinkles-lint/no-use-style-declared-sprinkles": [
        "error",
        { configPath: './src/sprinkles.js' }
      ],
    },
  },
});

module.exports = plugin;
