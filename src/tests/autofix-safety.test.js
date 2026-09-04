/**
 * Guards the --fix output of no-use-style-declared-sprinkles.
 * Detection is covered elsewhere; these cases assert that a fix is only offered
 * when applying it keeps the file compiling and rendering the same.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ESLint } = require('eslint');
const { sha256 } = require('../analyzer/analyze');

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

// ESLint merges a suggestion's fixes into one { range, text }; applying it is a plain splice.
const applySuggestion = (code, suggestion) => code.slice(0, suggestion.fix.range[0]) + suggestion.fix.text + code.slice(suggestion.fix.range[1]);
const collapseWhitespace = (text) => text.replace(/\s+/g, ' ').trim();

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

// --- Guard follow-up: the blocked move is offered as an IDE suggestion (never under --fix) ---

test('S1 (brief T7). guarded case carries a hoistToSprinkles suggestion; applying it hoists the prop', async () => {
  const code = `${SPRINKLES_IMPORT}
const container = style([
  sprinkles({ display: 'flex' }),
  { minHeight: '100vh' },
]);`;
  const fixed = await lint(code);
  assert.strictEqual(fixed.output, undefined, '--fix must not touch it');

  const result = await lint(code, {}, { fix: false });
  assert.strictEqual(result.messages.length, 1);
  assert.strictEqual(result.messages[0].messageId, 'manualSeparationRequired');
  assert.strictEqual(result.messages[0].suggestions.length, 1);
  assert.strictEqual(result.messages[0].suggestions[0].messageId, 'hoistToSprinkles');

  const applied = applySuggestion(code, result.messages[0].suggestions[0]);
  assert.strictEqual(
    collapseWhitespace(applied),
    collapseWhitespace(`${SPRINKLES_IMPORT}\nconst container = sprinkles({ display: 'flex', minHeight: '100vh' });`),
  );
});

test('S4 (brief T10). regression case never moves under --fix, with or without the suggestion', async () => {
  const result = await lint(`${SPRINKLES_IMPORT}
const removeButton = style([
  sprinkles({ marginRight: 22 }),
  { width: 'auto', selectors: { '&:disabled': { cursor: 'default' } } },
]);`);

  assert.strictEqual(result.output, undefined);
  assert.strictEqual(result.messages[0].messageId, 'manualSeparationRequired');
  assert.strictEqual(result.messages[0].suggestions.length, 1);
});

test('S5 (brief T11). applying the suggestion also inserts the import when sprinklesImportSource is set', async () => {
  const code = `const container = style([sprinkles({ display: 'flex' }), { minHeight: '100vh' }]);`;
  const result = await lint(code, { sprinklesImportSource: '@/styles/sprinkles.css' }, { fix: false });

  assert.strictEqual(result.messages[0].suggestions.length, 1);
  const applied = applySuggestion(code, result.messages[0].suggestions[0]);
  assert.ok(applied.startsWith(SPRINKLES_IMPORT), `unexpected output:\n${applied}`);
  assert.ok(applied.includes(`minHeight: '100vh'`));
});

test('S5-b. no import and no sprinklesImportSource → report without suggestion (a suggestion needs a fix)', async () => {
  const result = await lint(`const container = style([sprinkles({ display: 'flex' }), { minHeight: '100vh' }]);`, {}, { fix: false });

  assert.strictEqual(result.messages[0].messageId, 'manualSeparationRequired');
  assert.strictEqual(result.messages[0].suggestions, undefined);
});

// --- hoistableOverrideProperties: properties the project declares safe take the real --fix path ---

test('S2 (brief T8). all movable props allowlisted → real fix, wrapper removed', async () => {
  const result = await lint(
    `${SPRINKLES_IMPORT}
const container = style([
  sprinkles({ display: 'flex' }),
  { minHeight: '100vh' },
]);`,
    { hoistableOverrideProperties: ['minHeight'] },
  );

  assert.notStrictEqual(result.output, undefined, 'allowlisted prop must be auto-fixed');
  assert.ok(result.output.includes(`minHeight: '100vh'`));
  assert.ok(!result.output.includes('style(['), `wrapper should be gone:\n${result.output}`);
  assert.strictEqual(result.messages.length, 0);
});

test('S3 (brief T9). only some movable props allowlisted → no fix, suggestion instead', async () => {
  const result = await lint(
    `${SPRINKLES_IMPORT}
const box = style([sprinkles({ display: 'flex' }), { minHeight: '100vh', width: 'auto' }]);`,
    { hoistableOverrideProperties: ['minHeight'] },
  );

  assert.strictEqual(result.output, undefined);
  assert.strictEqual(result.messages[0].messageId, 'manualSeparationRequired');
  assert.ok(result.messages[0].message.includes('width'));

  const reported = await lint(
    `${SPRINKLES_IMPORT}
const box = style([sprinkles({ display: 'flex' }), { minHeight: '100vh', width: 'auto' }]);`,
    { hoistableOverrideProperties: ['minHeight'] },
    { fix: false },
  );
  assert.strictEqual(reported.messages[0].suggestions.length, 1);
});

test('S3-b. allowlist does not unlock the regression case unless width is declared', async () => {
  const result = await lint(
    `${SPRINKLES_IMPORT}
const removeButton = style([sprinkles({ marginRight: 22 }), { width: 'auto' }]);`,
    { hoistableOverrideProperties: ['minHeight', 'cursor'] },
  );

  assert.strictEqual(result.output, undefined);
  assert.strictEqual(result.messages[0].messageId, 'manualSeparationRequired');
});

// --- Shapes the merge path cannot transform losslessly → report only, no suggestion, allowlist ignored ---

const assertReportOnly = async (code, allowlist) => {
  const fixed = await lint(code, { hoistableOverrideProperties: allowlist });
  assert.strictEqual(fixed.output, undefined, 'must not be auto-fixed even when allowlisted');
  assert.strictEqual(fixed.messages[0].messageId, 'manualSeparationRequired');
  assert.strictEqual(fixed.messages[0].suggestions, undefined, 'must not offer a lossy suggestion');
};

test('S6. same property on both sides → the override value would be dropped → report only', async () => {
  await assertReportOnly(`${SPRINKLES_IMPORT}\nconst b = style([sprinkles({ width: '100%' }), { width: 'auto' }]);`, ['width']);
});

test('S7. spread inside sprinkles() → template would collapse → report only', async () => {
  await assertReportOnly(`${SPRINKLES_IMPORT}\nconst b = style([sprinkles({ ...base, display: 'flex' }), { minHeight: '100vh' }]);`, ['minHeight']);
});

test('S8. more than one override object → later objects would be dropped → report only', async () => {
  await assertReportOnly(`${SPRINKLES_IMPORT}\nconst b = style([sprinkles({ display: 'flex' }), { minHeight: '100vh' }, { zIndex: 3 }]);`, ['minHeight']);
});

test('S9. external variables in the array survive both the suggestion and the allowlist fix', async () => {
  const code = `${SPRINKLES_IMPORT}\nconst b = style([typography, sprinkles({ display: 'flex' }), { minHeight: '100vh' }]);`;

  const reported = await lint(code, {}, { fix: false });
  const applied = applySuggestion(code, reported.messages[0].suggestions[0]);
  assert.strictEqual(collapseWhitespace(applied), collapseWhitespace(`${SPRINKLES_IMPORT}\nconst b = style([ typography, sprinkles({ display: 'flex', minHeight: '100vh' }) ]);`));

  const fixed = await lint(code, { hoistableOverrideProperties: ['minHeight'] });
  assert.strictEqual(collapseWhitespace(fixed.output), collapseWhitespace(applied));
});

// --- provenSoloClassesPath: analyzer-proven solo classes take the real --fix path ---

const VIRTUAL_CSS_PATH = 'src/tests/virtual/proven-case.css.ts';
const PROVEN_CODE = `${SPRINKLES_IMPORT}
export const container = style([sprinkles({ display: 'flex' }), { minHeight: '100vh' }]);`;

const writeArtifact = (artifact) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprinkles-proven-'));
  const artifactPath = path.join(dir, 'proven-solo-classes.json');
  fs.writeFileSync(artifactPath, JSON.stringify(artifact));
  return artifactPath;
};

const provenArtifact = (overrides = {}) => ({
  version: 1,
  sourceHash: 'x',
  tsconfigLoaded: true,
  // a real on-disk input so verification is actually exercised
  inputs: { 'package.json': sha256(fs.readFileSync('package.json', 'utf8')) },
  provenSoloClasses: { [VIRTUAL_CSS_PATH]: ['container'] },
  unproven: {},
  unresolvedImports: [],
  unscannedImports: [],
  ...overrides,
});

const lintVirtual = async (code, ruleOptions, { fix = true } = {}) => {
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
  const [result] = await eslint.lintText(code, { filePath: VIRTUAL_CSS_PATH });
  return result;
};

test('P1 (plan T12). proven-solo class → override prop is really fixed', async () => {
  const artifactPath = writeArtifact(provenArtifact());
  const result = await lintVirtual(PROVEN_CODE, { provenSoloClassesPath: artifactPath });

  assert.notStrictEqual(result.output, undefined, 'proven class must be auto-fixed');
  assert.ok(result.output.includes(`minHeight: '100vh'`));
  assert.ok(!result.output.includes('style(['), `wrapper should be gone:\n${result.output}`);
  assert.strictEqual(result.messages.length, 0);
});

test('P2 (plan T13). class not in the artifact → suggestion behavior unchanged', async () => {
  const artifactPath = writeArtifact(provenArtifact({ provenSoloClasses: { [VIRTUAL_CSS_PATH]: ['somethingElse'] } }));
  const result = await lintVirtual(PROVEN_CODE, { provenSoloClassesPath: artifactPath });

  assert.strictEqual(result.output, undefined);
  assert.strictEqual(result.messages[0].messageId, 'manualSeparationRequired');
});

test('P3 (plan T14). artifact file missing → 2.17.0 behavior (backward compatible)', async () => {
  const result = await lintVirtual(PROVEN_CODE, { provenSoloClassesPath: '/nonexistent/proven.json' });

  assert.strictEqual(result.output, undefined);
  assert.strictEqual(result.messages[0].messageId, 'manualSeparationRequired');
});

test('P4 (plan T15). stale input hash on disk → artifact refused, warning emitted', async () => {
  const artifactPath = writeArtifact(provenArtifact({ inputs: { 'package.json': sha256('outdated content') } }));

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    const result = await lintVirtual(PROVEN_CODE, { provenSoloClassesPath: artifactPath });
    assert.strictEqual(result.output, undefined, 'stale artifact must not unlock the fix');
    assert.strictEqual(result.messages[0].messageId, 'manualSeparationRequired');
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(warnings.some((message) => message.includes('stale')), 'should warn about the stale artifact');
});

test('P4-b. analyzer reported unresolved imports → artifact refused, warning emitted', async () => {
  const artifactPath = writeArtifact(provenArtifact({ unresolvedImports: [{ file: 'a.tsx', specifier: '@x/ghost.css' }] }));

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    const result = await lintVirtual(PROVEN_CODE, { provenSoloClassesPath: artifactPath });
    assert.strictEqual(result.output, undefined, 'incomplete import graph must not unlock the fix');
    assert.strictEqual(result.messages[0].messageId, 'manualSeparationRequired');
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(warnings.some((message) => message.includes('unresolved')), 'should warn about the incomplete graph');
});

test('P7. artifact with empty inputs → refused (staleness unverifiable)', async () => {
  const artifactPath = writeArtifact(provenArtifact({ inputs: {} }));
  const result = await lintVirtual(PROVEN_CODE, { provenSoloClassesPath: artifactPath });

  assert.strictEqual(result.output, undefined);
  assert.strictEqual(result.messages[0].messageId, 'manualSeparationRequired');
});

test('P7-b. artifact generated without a tsconfig → refused', async () => {
  const artifactPath = writeArtifact(provenArtifact({ tsconfigLoaded: false }));
  const result = await lintVirtual(PROVEN_CODE, { provenSoloClassesPath: artifactPath });

  assert.strictEqual(result.output, undefined);
});

test('P8. corrupt artifact → warning, suggestion fallback', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprinkles-proven-'));
  const artifactPath = path.join(dir, 'proven-solo-classes.json');
  fs.writeFileSync(artifactPath, '{ not json');

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    const result = await lintVirtual(PROVEN_CODE, { provenSoloClassesPath: artifactPath });
    assert.strictEqual(result.output, undefined);
    assert.strictEqual(result.messages[0].messageId, 'manualSeparationRequired');
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(warnings.some((message) => message.includes('could not read')), 'corrupt artifact must warn');
});

test('P6. a nested declaration sharing a proven name does not inherit the proof', async () => {
  const code = `${SPRINKLES_IMPORT}
const makeStyle = () => {
  const container = style([sprinkles({ display: 'flex' }), { minHeight: '100vh' }]);
  return container;
};`;
  const artifactPath = writeArtifact(provenArtifact());
  const result = await lintVirtual(code, { provenSoloClassesPath: artifactPath });

  assert.strictEqual(result.output, undefined, 'only module-level exports may use the proof');
  assert.strictEqual(result.messages[0].messageId, 'manualSeparationRequired');
});

test('P5. proven class still cannot bypass the lossless-transform preconditions', async () => {
  const code = `${SPRINKLES_IMPORT}
export const container = style([sprinkles({ width: '100%' }), { width: 'auto' }]);`;
  const artifactPath = writeArtifact(provenArtifact());
  const result = await lintVirtual(code, { provenSoloClassesPath: artifactPath });

  assert.strictEqual(result.output, undefined, 'duplicate-property merge loss is independent of solo usage');
  assert.strictEqual(result.messages[0].messageId, 'manualSeparationRequired');
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
