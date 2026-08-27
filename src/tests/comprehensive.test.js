/**
 * 포괄적인 ESLint 플러그인 테스트 스위트
 * CJS 기반 sprinkles-lint 플러그인의 모든 기능을 검증
 */

const { ESLint } = require('eslint');
const { RuleTester } = require('eslint');
const path = require('path');

// 플러그인과 설정 파일 경로
const pluginPath = path.resolve(__dirname, '../..');
const configPath = path.resolve(__dirname, '../sprinkles.js');

// RuleTester 설정
const ruleTester = new RuleTester({
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  env: {
    es6: true,
    node: true,
  },
});

// 플러그인 로드
const plugin = require('../index');
const rule = plugin.rules['no-use-style-declared-sprinkles'];

console.log('🧪 ESLint Sprinkles 플러그인 포괄적 테스트 시작\n');

// 1. 플러그인 구조 검증
console.log('📋 1. 플러그인 구조 검증');
console.log('✅ 플러그인 export:', typeof plugin === 'object' ? '성공' : '실패');
console.log('✅ 메타 정보:', plugin.meta ? '존재' : '없음');
console.log('✅ 룰 export:', plugin.rules && plugin.rules['no-use-style-declared-sprinkles'] ? '성공' : '실패');
console.log('✅ 설정 export:', plugin.configs ? '존재' : '없음');

// 2. 설정 파일 검증
console.log('\n📋 2. 설정 파일 검증');
try {
  const sprinklesConfig = require('../sprinkles');
  const propertyCount = Object.keys(sprinklesConfig.sprinklesConfig).length;
  console.log(`✅ 설정 로드 성공: ${propertyCount}개 속성 정의됨`);
  console.log('✅ 주요 속성:', Object.keys(sprinklesConfig.sprinklesConfig).slice(0, 5).join(', '));
} catch (error) {
  console.error('❌ 설정 로드 실패:', error.message);
}

// 3. 룰 동작 테스트 (RuleTester 사용)
console.log('\n📋 3. 룰 동작 테스트 (RuleTester)');

const validTestCases = [
  // 유효한 케이스들
  {
    code: `sprinkles({ color: 'gray-900', fontWeight: 700 })`,
    options: [{ configPath: './src/sprinkles.js' }],
  },
  {
    code: `style({ 
      '&:hover': { opacity: 0.8 },
      transform: 'scale(1.1)'
    })`,
    options: [{ configPath: './src/sprinkles.js' }],
  },
  {
    code: `style([
      sprinkles({ color: 'gray-900', position: 'relative' }),
      { '&:hover': { opacity: 0.8 } }
    ])`,
    options: [{ configPath: './src/sprinkles.js' }],
  },
];

const invalidTestCases = [
  // 잘못된 케이스들 (auto-fix 포함)
  {
    code: `style({ color: 'gray-900', fontWeight: 700 })`,
    options: [{ configPath: './src/sprinkles.js' }],
    errors: [{ messageId: 'useSprinkles' }],
    output: `sprinkles({
    color: 'gray-900',
    fontWeight: 700
  })`,
  },
  {
    code: `style({
      color: 'gray-900',
      fontWeight: 700,
      transform: 'scale(1.1)'
    })`,
    options: [{ configPath: './src/sprinkles.js' }],
    errors: [{ messageId: 'useSprinkles' }],
    output: `style([
  sprinkles({
    color: 'gray-900',
    fontWeight: 700
  }),
  {
    transform: 'scale(1.1)'
  }
])`,
  },
];

try {
  // RuleTester에서 절대 경로 사용
  const testCasesWithAbsolutePath = {
    valid: validTestCases.map(test => ({
      ...test,
      options: [{ configPath }]
    })),
    invalid: invalidTestCases.map(test => ({
      ...test,
      options: [{ configPath }]
    }))
  };
  
  ruleTester.run('no-use-style-declared-sprinkles', rule, testCasesWithAbsolutePath);
  console.log('✅ RuleTester 테스트 모두 통과');
} catch (error) {
  console.error('❌ RuleTester 테스트 실패:', error.message);
  // 상세한 에러 정보 출력
  if (error.actual) {
    console.error('   실제 결과:', error.actual);
  }
}

// 4. 실제 ESLint 통합 테스트
console.log('\n📋 4. ESLint 통합 테스트');

async function runIntegrationTests() {
  const eslint = new ESLint({
    useEslintrc: false,
    overrideConfig: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      env: {
        es6: true,
        node: true,
      },
      plugins: ['sprinkles-lint'],
      rules: {
        'sprinkles-lint/no-use-style-declared-sprinkles': [
          'error',
          { configPath: './src/sprinkles.js' },
        ],
      },
    },
    resolvePluginsRelativeTo: pluginPath,
  });

  const testCases = [
    {
      name: '문제가 있는 style 호출',
      code: `const badStyle = style({ color: 'gray-900', fontWeight: 700 });`,
      expectErrors: true,
    },
    {
      name: '올바른 sprinkles 사용',
      code: `const goodStyle = sprinkles({ color: 'gray-900', fontWeight: 700 });`,
      expectErrors: false,
    },
    {
      name: '혼합 스타일',
      code: `const mixedStyle = style({
        color: 'gray-900',
        fontWeight: 700,
        transform: 'scale(1.1)'
      });`,
      expectErrors: true,
    },
    {
      name: '올바른 혼합 스타일',
      code: `const correctMixedStyle = style([
        sprinkles({ color: 'gray-900', fontWeight: 700 }),
        { transform: 'scale(1.1)' }
      ]);`,
      expectErrors: false,
    },
  ];

  for (const testCase of testCases) {
    try {
      const results = await eslint.lintText(testCase.code, { filePath: 'test.js' });
      const hasErrors = results[0].messages.length > 0;
      
      if (hasErrors === testCase.expectErrors) {
        console.log(`✅ ${testCase.name}: 예상대로 동작`);
        if (hasErrors) {
          console.log(`   오류 감지: ${results[0].messages[0].message}`);
        }
      } else {
        console.log(`❌ ${testCase.name}: 예상과 다른 결과`);
        console.log(`   예상: ${testCase.expectErrors ? '오류' : '정상'}, 실제: ${hasErrors ? '오류' : '정상'}`);
      }
    } catch (error) {
      console.error(`❌ ${testCase.name} 테스트 중 오류:`, error.message);
    }
  }
}

// 5. 테스트 케이스 파일들 검증
console.log('\n📋 5. 테스트 케이스 파일들 검증');

async function runTestFiles() {
  const eslint = new ESLint({
    useEslintrc: false,
    overrideConfig: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      env: {
        es6: true,
        node: true,
      },
      plugins: ['sprinkles-lint'],
      rules: {
        'sprinkles-lint/no-use-style-declared-sprinkles': [
          'error',
          { configPath: './src/sprinkles.js' },
        ],
      },
    },
    resolvePluginsRelativeTo: pluginPath,
  });

  try {
    const results = await eslint.lintFiles(['src/tests/test-files/*.js']);
    
    console.log(`📁 총 ${results.length}개 파일 검사 완료`);
    
    let totalIssues = 0;
    results.forEach((result) => {
      const fileName = path.basename(result.filePath);
      const issueCount = result.messages.length;
      totalIssues += issueCount;
      
      if (issueCount === 0) {
        console.log(`✅ ${fileName}: 문제 없음`);
      } else {
        console.log(`⚠️  ${fileName}: ${issueCount}개 이슈 발견`);
        result.messages.forEach((msg, index) => {
          console.log(`   ${index + 1}. ${msg.message}`);
        });
      }
    });
    
    console.log(`\n📊 총 발견된 이슈: ${totalIssues}개`);
  } catch (error) {
    console.error('❌ 테스트 파일 검사 중 오류:', error.message);
  }
}

// 테스트 실행
async function runAllTests() {
  await runIntegrationTests();
  await runTestFiles();
  console.log('\n🎉 모든 테스트 완료!');
}

runAllTests().catch(console.error);