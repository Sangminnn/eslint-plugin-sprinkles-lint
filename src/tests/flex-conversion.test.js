const { RuleTester } = require('eslint');
const rule = require('../rules/no-use-style-declared-sprinkles');

const SPRINKLES_IMPORT = `import { sprinkles } from '@/styles/sprinkles.css';\n`;

// Mock sprinkles config with flex property
const mockConfig = {
  sprinklesConfig: {
    flex: {
      '1': '1 1 0%',
    },
    display: ['flex', 'block', 'none'],
    color: {
      'gray-800': '#333333',
      'gray-900': '#2D2D2D',
    },
  },
};

const ruleTester = new RuleTester({
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
});

console.log('🧪 Flex Type Conversion Test 시작\n');

ruleTester.run('no-use-style-declared-sprinkles (flex conversion)', rule, {
  valid: [
    {
      code: `const s = sprinkles({ flex: '1' })`,
      options: [mockConfig],
    },
    {
      code: `const s = style([sprinkles({ flex: '1' }), { ':hover': { color: 'red' } }])`,
      options: [mockConfig],
    },
  ],
  invalid: [
    {
      code: `${SPRINKLES_IMPORT}const s = style({ flex: 1 })`,
      output: `${SPRINKLES_IMPORT}const s = sprinkles({
    flex: '1'
  })`,
      options: [mockConfig],
      errors: [{ messageId: 'useSprinkles' }],
    },
    {
      code: `${SPRINKLES_IMPORT}const s = style({ flex: 1, display: 'flex' })`,
      output: `${SPRINKLES_IMPORT}const s = sprinkles({
    flex: '1',
    display: 'flex'
  })`,
      options: [mockConfig],
      errors: [{ messageId: 'useSprinkles' }],
    },
    {
      code: `${SPRINKLES_IMPORT}const s = style([{ flex: 1 }])`,
      output: `${SPRINKLES_IMPORT}const s = sprinkles({
    flex: '1'
  })`,
      options: [mockConfig],
      errors: [{ messageId: 'useSprinkles' }],
    },
    {
      code: `${SPRINKLES_IMPORT}const s = style({ flex: 1, color: 'gray-800' })`,
      output: `${SPRINKLES_IMPORT}const s = sprinkles({
    flex: '1',
    color: 'gray-800'
  })`,
      options: [mockConfig],
      errors: [{ messageId: 'useSprinkles' }],
    },
  ],
});

console.log('✅ Flex Type Conversion Test 완료\n');
