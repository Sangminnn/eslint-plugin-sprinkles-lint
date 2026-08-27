/**
 * Guards the --fix output of no-use-style-declared-sprinkles.
 * Detection is covered elsewhere; these cases assert that a fix is only offered
 * when applying it keeps the file compiling and rendering the same.
 */

const assert = require('assert');
const path = require('path');
const { ESLint } = require('eslint');

const pluginPath = path.resolve(__dirname, '../..');
const SPRINKLES_IMPORT = `import { sprinkles } from '@/styles/sprinkles.css';`;

const lint = async (code, ruleOptions = {}, { fix = true } = {}) => {
  const eslint = new ESLint({
    fix,
    useEslintrc: false,
    overrideConfig: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      plugins: ['sprinkles-lint'],
      rules: {
        'sprinkles-lint/no-use-style-declared-sprinkles': ['error', { configPath: './src/sprinkles.js', ...ruleOptions }],
      },
    },
    resolvePluginsRelativeTo: pluginPath,
  });

  const [result] = await eslint.lintText(code, { filePath: 'test.js' });
  return result;
};

const cases = [];
const test = (name, run) => cases.push({ name, run });

// --- Fix 1: never emit sprinkles(...) into a file that does not import it ---

test('T1. no sprinkles import → report only, no fix', async () => {
  const result = await lint(`const box = style({ width: 'auto' });`);

  assert.strictEqual(result.messages.length, 1);
  assert.strictEqual(result.messages[0].messageId, 'useSprinkles');
  assert.strictEqual(result.output, undefined);
});

test('T1-control. sprinkles import present → fix is applied', async () => {
  const result = await lint(`${SPRINKLES_IMPORT}\nconst box = style({ width: 'auto' });`);

  assert.strictEqual(result.messages.length, 0, 'fixed problems should be gone');
  assert.ok(result.output.includes(`sprinkles({`));
  assert.ok(result.output.includes(`width: 'auto'`));
  assert.ok(!result.output.includes(`style(`), 'fully-sprinkles object should drop the style wrapper');
});

test('T2. sprinklesImportSource set and no import → import is inserted with the fix', async () => {
  const result = await lint(`const box = style({ width: 'auto' });`, { sprinklesImportSource: '@/styles/sprinkles.css' });

  assert.strictEqual(result.messages.length, 0);
  assert.ok(result.output.startsWith(SPRINKLES_IMPORT), `output should start with the import, got:\n${result.output}`);
  assert.ok(result.output.includes(`sprinkles({`));
});

test('T2-multi. several reports in one file → import inserted exactly once', async () => {
  const result = await lint(
    `const a = style({ width: 'auto' });\nconst b = style({ display: 'flex' });`,
    { sprinklesImportSource: '@/styles/sprinkles.css' },
  );

  assert.strictEqual(result.messages.length, 0);
  assert.strictEqual((result.output.match(/import \{ sprinkles \}/g) || []).length, 1);
  assert.strictEqual((result.output.match(/sprinkles\(\{/g) || []).length, 2);
});

test('T3. import already present → no duplicate import', async () => {
  const result = await lint(`${SPRINKLES_IMPORT}\nconst box = style({ width: 'auto' });`, {
    sprinklesImportSource: '@/styles/sprinkles.css',
  });

  assert.strictEqual(result.messages.length, 0);
  assert.strictEqual((result.output.match(/import \{ sprinkles \}/g) || []).length, 1);
});

// --- Fix 2: properties in an override object composed with other classes stay where they are ---

test('T4. override object with movable property → manualSeparationRequired, no fix', async () => {
  const result = await lint(`${SPRINKLES_IMPORT}
const removeButton = style([
  someTypography,
  sprinkles({ marginRight: 22, color: 'gray-900' }),
  {
    width: 'auto',
    selectors: { '&:disabled': { cursor: 'default' } },
  },
]);`);

  assert.strictEqual(result.messages.length, 1);
  assert.strictEqual(result.messages[0].messageId, 'manualSeparationRequired');
  assert.strictEqual(result.output, undefined, 'override object must not be rewritten');
  assert.ok(result.messages[0].message.includes('width'));
  assert.ok(!result.messages[0].message.includes('marginRight'), 'guard message lists override-object props only');
  assert.ok(!result.messages[0].message.includes('color'), 'guard message lists override-object props only');
});

test('T4-regression. brief case with sprinkles values outside the config still reports width only', async () => {
  const result = await lint(`${SPRINKLES_IMPORT}
const removeButton = style([
  someTypography,
  sprinkles({ marginLeft: 6, color: 'gray-600' }),
  {
    width: 'auto',
    selectors: { '&:disabled': { cursor: 'default' } },
  },
]);`);

  assert.strictEqual(result.messages.length, 1);
  assert.strictEqual(result.messages[0].messageId, 'manualSeparationRequired');
  assert.strictEqual(result.output, undefined);
  assert.ok(result.messages[0].message.includes('width'));
  assert.ok(!result.messages[0].message.includes('marginLeft'));
});

test('T5. override object without sprinkles values → no report', async () => {
  const result = await lint(`${SPRINKLES_IMPORT}
const box = style([sprinkles({ width: 'auto' }), { transform: 'scale(1.1)' }]);`);

  assert.strictEqual(result.messages.length, 0);
  assert.strictEqual(result.output, undefined);
});

test('T6. removeStyle path is untouched: style([sprinkles(...)]) → sprinkles(...)', async () => {
  const result = await lint(`${SPRINKLES_IMPORT}
const box = style([sprinkles({ width: 'auto' })]);`);

  assert.strictEqual(result.messages.length, 0, 'removeStyle should have been fixed');
  assert.ok(result.output.includes(`const box = sprinkles({ width: 'auto' })`));
});

test('T9. override object + invalid sprinkles value → no fix, no broken output', async () => {
  const result = await lint(`${SPRINKLES_IMPORT}
const box = style([sprinkles({ color: 'notInConfig' }), { transform: 'scale(1.1)' }]);`);

  assert.strictEqual(result.output, undefined);
  assert.ok(result.messages.every((message) => !message.fatal), 'output must stay parseable');
});

// --- sprinkles() holding values outside the config (no override object) is rewritten to style() ---

test('T10. style([sprinkles({ invalid })]) → style({ invalid }) that parses', async () => {
  const result = await lint(`${SPRINKLES_IMPORT}
const box = style([sprinkles({ color: 'notInConfig' })]);`);

  assert.ok(result.messages.every((message) => !message.fatal), 'output must stay parseable');
  assert.ok(result.output.includes(`style({\n  color: 'notInConfig'\n})`), `unexpected output:\n${result.output}`);
});

test('T11. style([base, sprinkles({ invalid })]) keeps the composed class', async () => {
  const result = await lint(`${SPRINKLES_IMPORT}
const box = style([base, sprinkles({ color: 'notInConfig' })]);`);

  assert.ok(result.messages.every((message) => !message.fatal), 'output must stay parseable');
  assert.ok(result.output.includes(`style([base, {\n  color: 'notInConfig'\n}])`), `unexpected output:\n${result.output}`);
});

// --- import detection / insertion edge cases ---

test('T12. sprinkles import declared below the call (hoisted) → no duplicate import', async () => {
  const result = await lint(`const box = style({ width: 'auto' });\n${SPRINKLES_IMPORT}`, {
    sprinklesImportSource: '@/styles/sprinkles.css',
  });

  assert.strictEqual((result.output.match(/import \{ sprinkles \}/g) || []).length, 1);
});

test('T13. directive prologue stays first when the import is inserted', async () => {
  const result = await lint(`'use client';\nconst box = style({ width: 'auto' });`, {
    sprinklesImportSource: '@/styles/sprinkles.css',
  });

  assert.ok(result.output.startsWith(`'use client';\n${SPRINKLES_IMPORT}`), `unexpected output:\n${result.output}`);
});

// --- Fix 3: the message only names props that are about to move into sprinkles() ---

test('T7. recipe base: props already inside sprinkles() are not listed', async () => {
  const result = await lint(
    `${SPRINKLES_IMPORT}
const button = recipe({
  base: [sprinkles({ width: 'auto' }), { color: 'gray-900' }],
});`,
    {},
    { fix: false },
  );

  assert.strictEqual(result.messages.length, 1);
  assert.strictEqual(result.messages[0].messageId, 'useSprinkles');
  assert.ok(result.messages[0].message.includes(`'color'`));
  assert.ok(!result.messages[0].message.includes('width'));
});

test('T8. styleVariants array: props already inside sprinkles() are not listed', async () => {
  const result = await lint(
    `${SPRINKLES_IMPORT}
const variants = styleVariants({
  primary: [sprinkles({ width: 'auto' }), { color: 'gray-900' }],
});`,
    {},
    { fix: false },
  );

  assert.strictEqual(result.messages.length, 1);
  assert.strictEqual(result.messages[0].messageId, 'useSprinkles');
  assert.ok(result.messages[0].message.includes(`'color'`));
  assert.ok(!result.messages[0].message.includes('width'));
});

// --- runner ---

const run = async () => {
  let failed = 0;

  for (const { name, run: runCase } of cases) {
    try {
      await runCase();
      console.log(`✅ ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`❌ ${name}`);
      console.log(`   ${error.message.split('\n')[0]}`);
    }
  }

  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  process.exit(failed > 0 ? 1 : 0);
};

run();
