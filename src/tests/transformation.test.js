/**
 * 실제 코드 변환 과정을 상세히 검증하는 테스트
 */

const { ESLint } = require('eslint');
const path = require('path');

const pluginPath = path.resolve(__dirname, '../..');

async function testTransformation() {
  console.log('🔄 코드 변환 과정 상세 검증 테스트\n');

  const eslint = new ESLint({
    fix: true, // 자동 수정 활성화
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
      name: '단순 style → sprinkles 변환',
      input: `const styles = style({ color: 'gray-900', fontWeight: 700 });`,
      expected: `const styles = sprinkles({ color: 'gray-900', fontWeight: 700 });`,
    },
    {
      name: '혼합 속성 → style + sprinkles 분리',
      input: `const mixedStyle = style({
  color: 'gray-900',
  fontWeight: 700,
  transform: 'scale(1.1)',
  cursor: 'pointer'
});`,
      expected: `style([
  sprinkles({
    color: 'gray-900',
    fontWeight: 700,
    cursor: 'pointer'
  }),
  {
    transform: 'scale(1.1)'
  }
])`,
    },
    {
      name: '배열에서 sprinkles 속성 추출',
      input: `const arrayStyle = style([
  { color: 'gray-900', position: 'relative' },
  { '&:hover': { opacity: 0.8 } }
]);`,
      expected: 'sprinkles로 변환될 것으로 예상',
    },
    {
      name: 'recipe base 객체 변환',
      input: `const buttonRecipe = recipe({
  base: {
    color: 'gray-900',
    fontWeight: 700,
    borderRadius: 6,
    '&:hover': { opacity: 0.8 }
  }
});`,
      expected: 'recipe base가 sprinkles + 나머지로 분리',
    },
  ];

  for (const testCase of testCases) {
    console.log(`📝 ${testCase.name}`);
    console.log('━'.repeat(50));
    
    try {
      const results = await eslint.lintText(testCase.input, { filePath: 'test.js' });
      const result = results[0];
      
      console.log('🔹 원본 코드:');
      console.log(testCase.input);
      
      if (result.messages.length > 0) {
        console.log('\n🚨 감지된 문제:');
        result.messages.forEach((msg, index) => {
          console.log(`   ${index + 1}. ${msg.message}`);
          console.log(`      위치: ${msg.line}:${msg.column}`);
        });
        
        if (result.output) {
          console.log('\n✨ 자동 수정 결과:');
          console.log(result.output);
          
          // 변환 성공 여부 확인
          if (testCase.expected && typeof testCase.expected === 'string' && testCase.expected.includes('sprinkles')) {
            const hasExpectedTransform = result.output.includes('sprinkles');
            console.log(`\n✅ 변환 검증: ${hasExpectedTransform ? '성공 - sprinkles 변환됨' : '실패 - sprinkles 변환 안됨'}`);
          } else {
            console.log('\n✅ 변환 완료 (패턴 확인 필요)');
          }
        } else {
          console.log('\n❌ 자동 수정 결과 없음');
        }
      } else {
        console.log('\n✅ 문제 없음 - 변환 불필요');
      }
      
    } catch (error) {
      console.error(`❌ 테스트 실행 오류: ${error.message}`);
    }
    
    console.log('\n' + '='.repeat(60) + '\n');
  }
}

async function testSpecificTransformations() {
  console.log('🧪 특정 변환 패턴 검증\n');

  const eslint = new ESLint({
    fix: true,
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

  // 변환 전후 비교를 위한 테스트
  const transformTests = [
    {
      name: '색상 값 매핑',
      before: `style({ color: 'gray-900' })`,
      expectedPattern: /sprinkles\(\s*\{\s*color:\s*['"]gray-900['"].*\}\s*\)/,
    },
    {
      name: '폰트 굵기 변환',
      before: `style({ fontWeight: 700 })`,
      expectedPattern: /sprinkles\(\s*\{\s*fontWeight:\s*700.*\}\s*\)/,
    },
    {
      name: '위치 속성 변환',
      before: `style({ position: 'relative', display: 'flex' })`,
      expectedPattern: /sprinkles\(\s*\{[\s\S]*position:\s*['"]relative['"][\s\S]*display:\s*['"]flex['"][\s\S]*\}\s*\)/,
    },
  ];

  for (const test of transformTests) {
    console.log(`🔍 ${test.name}`);
    
    try {
      const results = await eslint.lintText(test.before, { filePath: 'test.js' });
      const result = results[0];
      
      if (result.output) {
        const matches = test.expectedPattern.test(result.output);
        console.log(`   변환 전: ${test.before}`);
        console.log(`   변환 후: ${result.output}`);
        console.log(`   패턴 매치: ${matches ? '✅ 성공' : '❌ 실패'}`);
      } else {
        console.log(`   ⚠️  자동 수정 없음`);
      }
    } catch (error) {
      console.error(`   ❌ 오류: ${error.message}`);
    }
    
    console.log('');
  }
}

// 테스트 실행
async function runAllTransformationTests() {
  await testTransformation();
  await testSpecificTransformations();
  console.log('🎉 모든 변환 테스트 완료!');
}

runAllTransformationTests().catch(console.error);