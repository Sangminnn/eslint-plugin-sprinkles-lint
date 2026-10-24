/**
 * Every style() autofix path asks the same questions before moving a property into sprinkles():
 * does a class composed into this one set it (then it stays), and is the class proven to be used
 * alone (otherwise the move is only a suggestion). Cases from composed-override-hoist-bug.md.
 *
 * Projects are written to disk because the usage proof comes from auto mode analysing them.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ESLint } = require('eslint');
const { clearUsageCache } = require('../analyzer/usage-cache');

const pluginPath = path.resolve(__dirname, '../..');
const FIXTURE_CONFIG_PATH = path.join(pluginPath, 'src/sprinkles.js');
const CSS_HEADER = `import { sprinkles } from '@/styles/sprinkles.css';
import { style } from '@vanilla-extract/css';
`;

const TSCONFIG = JSON.stringify({
  compilerOptions: { target: 'esnext', module: 'esnext', moduleResolution: 'bundler', jsx: 'preserve', baseUrl: '.', paths: { '@/*': ['src/*'] } },
  include: ['src/**/*'],
});

const writeProject = ({ css, consumer, extraFiles = {} }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sprinkles-composed-'));
  const files = {
    'tsconfig.json': TSCONFIG,
    'package.json': JSON.stringify({ name: 'composed-fixture', private: true, dependencies: { '@vanilla-extract/css': '^1.16.0' } }),
    'src/styles/sprinkles.css.ts': `export const sprinkles = (value: unknown) => value;\n`,
    'src/Txt.tsx': `export const Txt = (props: { className?: string; children?: unknown }) => <p {...props} />;\n`,
    'src/styles.css.ts': `${CSS_HEADER}${css}`,
    'src/page.tsx': `import * as styles from '@/styles.css';\nimport { Txt } from '@/Txt';\n\n${consumer}`,
    ...extraFiles,
  };
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
  return root;
};

const lintProject = async (root, { fix = true } = {}) => {
  const eslint = new ESLint({
    fix,
    cwd: root,
    useEslintrc: false,
    overrideConfig: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
      plugins: ['sprinkles-lint'],
      rules: { 'sprinkles-lint/no-use-style-declared-sprinkles': ['error', { configPath: FIXTURE_CONFIG_PATH }] },
    },
    resolvePluginsRelativeTo: pluginPath,
  });
  const [result] = await eslint.lintFiles([path.join(root, 'src/styles.css.ts')]);
  return result;
};

const lintCss = async ({ css, consumer, extraFiles }) => {
  clearUsageCache();
  const root = writeProject({ css, consumer, extraFiles });
  const fixed = await lintProject(root);
  const reported = await lintProject(root, { fix: false });
  return { output: fixed.output, messages: reported.messages };
};

const messagesOnLine = (messages, line) => messages.filter((message) => message.line === line);
// CSS_HEADER is two lines, so the first line of `css` is line 3.
const cssLine = (index) => index + 3;

const cases = [];
const test = (name, run) => cases.push({ name, run });

test('B-1. standalone style() passed to a component → suggestion only (labelText)', async () => {
  const { output, messages } = await lintCss({
    css: `export const labelText = style({ textAlign: 'center' });\n`,
    consumer: `export const Page = () => <Txt className={styles.labelText}>label</Txt>;\n`,
  });

  assert.strictEqual(output, undefined, '--fix must not move it');
  assert.strictEqual(messages.length, 1);
  assert.strictEqual(messages[0].messageId, 'unprovenUsage');
  assert.strictEqual(messages[0].suggestions.length, 1);
});

test('B-2. standalone style() used alone on an intrinsic tag → fixed', async () => {
  const { output } = await lintCss({
    css: `export const plain = style({ textAlign: 'center' });\n`,
    consumer: `export const Page = () => <p className={styles.plain}>plain</p>;\n`,
  });

  assert.notStrictEqual(output, undefined, 'a proven class keeps the autofix');
  assert.ok(output.includes(`export const plain = sprinkles({`), output);
});

test('B-3. same-file parent sets the property → the override stays in the style object (referrerDescription)', async () => {
  const { output, messages } = await lintCss({
    css: `const base = style({ width: '100%' });\nexport const child = style([base, { width: 'auto' }]);\n`,
    consumer: `export const Page = () => <p className={styles.child}>child</p>;\n`,
  });

  assert.deepStrictEqual(messagesOnLine(messages, cssLine(1)), [], 'nothing to report on the override');
  assert.ok(output === undefined || output.includes(`export const child = style([base, { width: 'auto' }]);`), output);
});

test('B-3b. CSS shorthand in the parent covers the longhand in the override', async () => {
  const { messages } = await lintCss({
    css: `const base = style({ inset: 0 });\nexport const child = style([base, { left: 0 }]);\n`,
    consumer: `export const Page = () => <p className={styles.child}>child</p>;\n`,
  });

  assert.deepStrictEqual(messagesOnLine(messages, cssLine(1)), []);
});

test('B-4. same-file parent without overlap, child passed to a component → suggestion only', async () => {
  const { output, messages } = await lintCss({
    css: `const base = style({ color: 'red' });\nexport const child = style([base, { textAlign: 'center' }]);\n`,
    consumer: `export const Page = () => <Txt className={styles.child}>child</Txt>;\n`,
  });

  const childMessages = messagesOnLine(messages, cssLine(1));
  assert.strictEqual(childMessages.length, 1);
  assert.strictEqual(childMessages[0].messageId, 'manualSeparationRequired');
  assert.strictEqual(childMessages[0].suggestions.length, 1);
  assert.ok(!output || output.includes(`export const child = style([base, { textAlign: 'center' }]);`), output);
});

test('B-5. same-file parent without overlap, proven child → fixed', async () => {
  const { output } = await lintCss({
    css: `const base = style({ color: 'red' });\nexport const child = style([base, { textAlign: 'center' }]);\n`,
    consumer: `export const Page = () => <p className={styles.child}>child</p>;\n`,
  });

  assert.ok(output && /export const child = style\(\[\s*base,\s*sprinkles\(\{\s*textAlign: 'center'/.test(output), output);
});

test('B-6. proven child, but the parent sets the same property → not moved (array with sprinkles())', async () => {
  const { output, messages } = await lintCss({
    css: `const base = style([sprinkles({ width: '100%' }), { color: 'red' }]);\nexport const child = style([base, sprinkles({ display: 'block' }), { width: 'auto' }]);\n`,
    consumer: `export const Page = () => <p className={styles.child}>child</p>;\n`,
  });

  assert.deepStrictEqual(messagesOnLine(messages, cssLine(1)), []);
  assert.ok(output === undefined || output.includes(`{ width: 'auto' }`), output);
});

test('B-7. imported parent cannot be read → suggestion only, even for a proven child', async () => {
  const { output, messages } = await lintCss({
    css: `import { base } from '@/other.css';\nexport const child = style([base, { textAlign: 'center' }]);\n`,
    consumer: `export const Page = () => <p className={styles.child}>child</p>;\n`,
    extraFiles: { 'src/other.css.ts': `import { style } from '@vanilla-extract/css';\nexport const base = style({ textAlign: 'left' });\n` },
  });

  assert.strictEqual(output, undefined);
  assert.strictEqual(messages[0].messageId, 'manualSeparationRequired');
});

test('B-8. parent uses a sprinkles shorthand whose mapping is unknown → suggestion only', async () => {
  const { output, messages } = await lintCss({
    css: `const base = style([sprinkles({ px: 16 }), { color: 'red' }]);\nexport const child = style([base, { textAlign: 'center' }]);\n`,
    consumer: `export const Page = () => <p className={styles.child}>child</p>;\n`,
  });

  const childMessages = messagesOnLine(messages, cssLine(1));
  assert.strictEqual(childMessages[0].messageId, 'manualSeparationRequired');
  assert.ok(output === undefined || output.includes(`export const child = style([base, { textAlign: 'center' }]);`), output);
});

test('B-9. class composed inside its own file is not proven: its rule reaches the composing element', async () => {
  // base's textAlign lands on whatever element gets `child`; moving it to an atom would lose to Txt's base.
  const { output, messages } = await lintCss({
    css: `const base = style({ textAlign: 'center' });\nexport const child = style([base, { color: 'red' }]);\n`,
    consumer: `export const Page = () => <Txt className={styles.child}>child</Txt>;\n`,
  });

  assert.strictEqual(output, undefined, output);
  assert.strictEqual(messagesOnLine(messages, cssLine(0))[0].messageId, 'unprovenUsage');
});

test('B-10. two override objects next to a class → never rebuilt by --fix (the template keeps one)', async () => {
  const { output, messages } = await lintCss({
    css: `const base = style({ color: 'red' });\nexport const child = style([base, { textAlign: 'center' }, { color: 'blue' }]);\n`,
    consumer: `export const Page = () => <p className={styles.child}>child</p>;\n`,
  });

  assert.ok(output === undefined || output.includes(`{ color: 'blue' }`), output);
  assert.strictEqual(messagesOnLine(messages, cssLine(1))[0].messageId, 'manualSeparationRequired');
});

test('B-11. analysis unusable (no tsconfig) → standalone style() is suggestion only', async () => {
  clearUsageCache();
  const root = writeProject({
    css: `export const plain = style({ textAlign: 'center' });\n`,
    consumer: `export const Page = () => <p className={styles.plain}>plain</p>;\n`,
  });
  fs.rmSync(path.join(root, 'tsconfig.json'));
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const result = await lintProject(root);
    assert.strictEqual(result.output, undefined);
    assert.strictEqual(result.messages[0].messageId, 'unprovenUsage');
  } finally {
    console.warn = originalWarn;
  }
});

test('B-12. destructured, reassigned or globalStyle-extended parents cannot be read → proven child is not fixed', async () => {
  const parents = [
    `const styleMap = { inner: style({ textAlign: 'left' }) };\nconst { inner } = styleMap;\n`,
    `let inner = style({ color: 'red' });\ninner = style({ textAlign: 'left' });\n`,
    `const inner = style({ color: 'red' });\nglobalStyle(\`\${inner}\`, { textAlign: 'left' });\n`,
  ];
  for (const parent of parents) {
    const { output } = await lintCss({
      css: `import { globalStyle } from '@vanilla-extract/css';\n${parent}export const c = style([inner, { textAlign: 'center' }]);\n`,
      consumer: `export const Page = () => <p className={styles.c}>c</p>;\n`,
    });
    assert.ok(output === undefined || output.includes(`export const c = style([inner, { textAlign: 'center' }]);`), `${parent}\n${output}`);
  }
});

const run = async () => {
  let failed = 0;
  for (const { name, run: runCase } of cases) {
    try {
      await runCase();
      console.log(`✅ ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`❌ ${name}`);
      console.log(`   ${error.message.split('\n').slice(0, 6).join('\n   ')}`);
    }
  }
  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  process.exit(failed > 0 ? 1 : 0);
};

run();
