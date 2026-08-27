/**
 * 라이브 변환 과정을 실시간으로 보여주는 테스트
 */

const { ESLint } = require('eslint');
const path = require('path');

const pluginPath = path.resolve(__dirname, '../..');

async function demonstrateTransformations() {
  console.log('🎬 실시간 코드 변환 시연\n');

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

  const demos = [
    {
      title: '🎯 시나리오 1: 단순 style → sprinkles 변환',
      code: `const btnStyle = style({ color: 'gray-900', fontWeight: 700 });`,
      description: 'sprinkles에 정의된 속성들만 있는 경우'
    },
    {
      title: '🎯 시나리오 2: 혼합 속성 분리',
      code: `const cardStyle = style({
  color: 'gray-900',
  backgroundColor: 'white',
  boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
  borderRadius: 6
});`,
      description: 'sprinkles 속성과 일반 CSS가 섞인 경우'
    },
    {
      title: '🎯 시나리오 3: Recipe 베이스 변환',
      code: `const buttonRecipe = recipe({
  base: {
    position: 'relative',
    display: 'flex',
    fontWeight: 700,
    cursor: 'pointer',
    '&:hover': { opacity: 0.8 }
  }
});`,
      description: 'recipe의 base 객체에서 sprinkles 속성 분리'
    },
    {
      title: '🎯 시나리오 4: 배열 스타일 변환',
      code: `const complexStyle = style([
  { color: 'gray-900', position: 'relative' },
  { '&:focus': { outline: 'none' } }
]);`,
      description: '배열 내 객체에서 sprinkles 속성 추출'
    }
  ];

  for (let i = 0; i < demos.length; i++) {
    const demo = demos[i];
    console.log(`${demo.title}`);
    console.log(`📄 ${demo.description}`);
    console.log('━'.repeat(70));
    
    console.log('📥 변환 전:');
    console.log(demo.code);
    
    try {
      const results = await eslint.lintText(demo.code, { filePath: `demo${i+1}.js` });
      const result = results[0];
      
      if (result.messages.length > 0) {
        console.log('\n🚨 ESLint 감지 결과:');
        result.messages.forEach((msg, idx) => {
          console.log(`   ${idx + 1}. ${msg.message}`);
          console.log(`      라인 ${msg.line}, 컬럼 ${msg.column}`);
        });
        
        if (result.output) {
          console.log('\n📤 자동 변환 후:');
          console.log(result.output);
          
          // 변환 분석
          console.log('\n🔍 변환 분석:');
          if (result.output.includes('sprinkles(')) {
            console.log('   ✅ sprinkles() 함수 호출로 변환됨');
          }
          if (result.output.includes('style([')) {
            console.log('   ✅ 혼합 스타일을 배열로 분리함');
          }
          if (result.output !== demo.code) {
            console.log('   ✅ 코드가 성공적으로 변환됨');
          }
        } else {
          console.log('\n⚠️  자동 수정 결과가 생성되지 않았습니다');
        }
      } else {
        console.log('\n✅ 이미 올바른 형태 - 변환 불필요');
      }
      
    } catch (error) {
      console.error(`\n❌ 처리 오류: ${error.message}`);
    }
    
    console.log('\n' + '='.repeat(80) + '\n');
  }
}

async function showBeforeAfterComparison() {
  console.log('📊 변환 전후 비교표\n');

  const eslint = new ESLint({
    fix: true,
    useEslintrc: false,
    overrideConfig: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      env: { es6: true, node: true },
      plugins: ['sprinkles-lint'],
      rules: {
        'sprinkles-lint/no-use-style-declared-sprinkles': ['error', { configPath: './src/sprinkles.js' }],
      },
    },
    resolvePluginsRelativeTo: pluginPath,
  });

  const comparisons = [
    `style({ color: 'gray-900' })`,
    `style({ fontWeight: 700, backgroundColor: 'white' })`,
    `style({ position: 'relative', transform: 'scale(1.1)' })`,
    `style({ display: 'flex', flexDirection: 'row', cursor: 'pointer' })`
  ];

  console.log('| 변환 전 | 변환 후 | 상태 |');
  console.log('|---------|---------|------|');
  
  for (const code of comparisons) {
    try {
      const results = await eslint.lintText(code, { filePath: 'comparison.js' });
      const result = results[0];
      
      const before = code.replace(/\s+/g, ' ');
      const after = result.output ? result.output.replace(/\s+/g, ' ') : '변경 없음';
      const status = result.messages.length > 0 ? '🔄 변환됨' : '✅ 정상';
      
      console.log(`| \`${before}\` | \`${after}\` | ${status} |`);
    } catch (error) {
      console.log(`| \`${code}\` | 오류 발생 | ❌ 실패 |`);
    }
  }
  console.log('');
}

// 테스트 실행
async function runLiveDemo() {
  await demonstrateTransformations();
  await showBeforeAfterComparison();
  console.log('🎭 라이브 변환 시연 완료!');
}

runLiveDemo().catch(console.error);