const sprinklesPlugin = require('./src/index.js');

// ESLint 로컬 플러그인 설정
module.exports = {
  // 플러그인을 사용할 때는 'eslint-plugin-' 접두사 없이 쓸 수 있음
  plugins: ['sprinkles-lint'],
  rules: {
    'sprinkles-lint/no-use-style-declared-sprinkles': [
      'error',
      {
        configPath: './src/sprinkles.js',
      },
    ],
  },
};
