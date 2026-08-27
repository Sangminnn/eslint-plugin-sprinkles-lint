const { ESLint } = require('eslint');
const path = require('path');

// 현재 디렉토리를 플러그인 경로로 설정
const pluginPath = path.resolve(__dirname, '../..');

const eslint = new ESLint({
  useEslintrc: false,
  overrideConfig: {
    // 파서 옵션 추가
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    env: {
      es6: true,
      node: true,
    },
    // 로컬 플러그인을 직접 가져와서 사용
    plugins: ['sprinkles-lint'],
    rules: {
      'sprinkles-lint/no-use-style-declared-sprinkles': [
        'error',
        {
          configPath: './src/sprinkles.js',
        },
      ],
    },
  },
  // 플러그인 해결 경로 지정
  resolvePluginsRelativeTo: pluginPath,
});

async function runTests() {
  console.log('🔍 테스트 시작...');

  try {
    // 플러그인 로드
    require('../index');

    // 테스트 파일 검사
    const results = await eslint.lintFiles(['src/tests/test-files/*.js']);

    console.log('📁 검사한 파일 수:', results.length);

    results.forEach((result) => {
      console.log(`\n검사 파일: ${result.filePath}`);
      console.log('메시지 수:', result.messages.length);

      if (result.messages.length === 0) {
        console.log('✅ 문제 없음');
      } else {
        result.messages.forEach((msg) => {
          console.log(`❌ ${msg.ruleId || 'unknown'}: ${msg.message}`);
        });
      }
    });
  } catch (error) {
    console.error('오류 발생:', error);
  }
}

runTests().catch(console.error);
