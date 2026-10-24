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
        'sprinkles-lint/no-use-style-declared-sprinkles': [
          'error',
          { configPath: './src/sprinkles.js', usageAnalysis: 'off', ...ruleOptions },
        ],
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
// These cases are about the import, not about usage: the allowlist marks the moved properties as
// never set by another class, so the standalone hoist is allowed without a usage proof.
const IMPORT_CASE = { hoistableOverrideProperties: ['width', 'display'] };

test('T1. no sprinkles import → report only, no fix', async () => {
  const result = await lint(`const box = style({ width: 'auto' });`, IMPORT_CASE);

  assert.strictEqual(result.messages.length, 1);
  assert.strictEqual(result.messages[0].messageId, 'useSprinkles');
  assert.strictEqual(result.output, undefined);
});

test('T1-control. sprinkles import present → fix is applied', async () => {
  const result = await lint(`${SPRINKLES_IMPORT}\nconst box = style({ width: 'auto' });`, IMPORT_CASE);

  assert.strictEqual(result.messages.length, 0, 'fixed problems should be gone');
  assert.ok(result.output.includes(`sprinkles({`));
  assert.ok(result.output.includes(`width: 'auto'`));
  assert.ok(!result.output.includes(`style(`), 'fully-sprinkles object should drop the style wrapper');
});

test('T2. sprinklesImportSource set and no import → import is inserted with the fix', async () => {
  const result = await lint(`const box = style({ width: 'auto' });`, { ...IMPORT_CASE, sprinklesImportSource: '@/styles/sprinkles.css' });

  assert.strictEqual(result.messages.length, 0);
  assert.ok(result.output.startsWith(SPRINKLES_IMPORT), `output should start with the import, got:\n${result.output}`);
  assert.ok(result.output.includes(`sprinkles({`));
});

test('T2-multi. several reports in one file → import inserted exactly once', async () => {
  const result = await lint(
    `const a = style({ width: 'auto' });\nconst b = style({ display: 'flex' });`,
    { ...IMPORT_CASE, sprinklesImportSource: '@/styles/sprinkles.css' },
  );

  assert.strictEqual(result.messages.length, 0);
  assert.strictEqual((result.output.match(/import \{ sprinkles \}/g) || []).length, 1);
  assert.strictEqual((result.output.match(/sprinkles\(\{/g) || []).length, 2);
});

test('T3. import already present → no duplicate import', async () => {
  const result = await lint(`${SPRINKLES_IMPORT}\nconst box = style({ width: 'auto' });`, {
    ...IMPORT_CASE,
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
    ...IMPORT_CASE,
    sprinklesImportSource: '@/styles/sprinkles.css',
  });

  assert.strictEqual((result.output.match(/import \{ sprinkles \}/g) || []).length, 1);
});

test('T13. directive prologue stays first when the import is inserted', async () => {
  const result = await lint(`'use client';\nconst box = style({ width: 'auto' });`, {
    ...IMPORT_CASE,
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
  const result = await lint(code, { ...IMPORT_CASE, sprinklesImportSource: '@/styles/sprinkles.css' }, { fix: false });

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

test('S6. same property on both sides → the style value is an override of the atom → left alone', async () => {
  const code = `${SPRINKLES_IMPORT}\nconst b = style([sprinkles({ width: '100%' }), { width: 'auto' }]);`;
  const result = await lint(code, { hoistableOverrideProperties: ['width'] });

  assert.strictEqual(result.output, undefined, 'the override must stay a style rule');
  assert.deepStrictEqual(result.messages, []);
});

test('S7. spread inside sprinkles() → template would collapse → report only', async () => {
  await assertReportOnly(`${SPRINKLES_IMPORT}\nconst b = style([sprinkles({ ...base, display: 'flex' }), { minHeight: '100vh' }]);`, ['minHeight']);
});

test('S8. more than one override object → merged without losing any of them', async () => {
  const result = await lint(`${SPRINKLES_IMPORT}\nconst b = style([sprinkles({ display: 'flex' }), { minHeight: '100vh' }, { zIndex: 3 }]);`, {
    hoistableOverrideProperties: ['minHeight'],
  });
  assert.ok(/sprinkles\(\{\s*display: 'flex',\s*minHeight: '100vh'\s*\}\)/.test(result.output), result.output);
  assert.ok(/zIndex: 3/.test(result.output), result.output);
});

test('S8-b. the same name in two override objects → never merged (the merge keeps the first)', async () => {
  await assertReportOnly(`${SPRINKLES_IMPORT}\nconst b = style([sprinkles({ display: 'flex' }), { minHeight: '100vh' }, { minHeight: 'auto' }]);`, ['minHeight']);
});

test('S8-c. existing sprinkles() values never move out, conditional or not', async () => {
  const conditional = await lint(`${SPRINKLES_IMPORT}\nexport const x = style([sprinkles({ display: { mobile: 'none' } }), { width: 'auto' }]);`, { hoistableOverrideProperties: ['width'] });
  assert.ok(/sprinkles\(\{\s*display: \{ mobile: 'none' \},\s*width: 'auto'\s*\}\)/.test(conditional.output), conditional.output);

  const token = await lint(`${SPRINKLES_IMPORT}\nconst p = style({ display: 'grid' });\nexport const x = style([p, sprinkles({ display: tokens.d }), { width: 'auto' }]);`, { hoistableOverrideProperties: ['width'] });
  assert.ok(/sprinkles\(\{\s*display: tokens\.d,\s*width: 'auto'\s*\}\)/.test(token.output), token.output);
});

test('S9. variables in the array survive both the suggestion and the allowlist fix', async () => {
  const code = `${SPRINKLES_IMPORT}\nconst typography = style({ fontSize: 16 });\nconst b = style([typography, sprinkles({ display: 'flex' }), { minHeight: '100vh' }]);`;

  const reported = await lint(code, {}, { fix: false });
  const guarded = reported.messages.find((message) => message.messageId === 'manualSeparationRequired');
  const applied = applySuggestion(code, guarded.suggestions[0]);
  assert.ok(
    collapseWhitespace(applied).endsWith(collapseWhitespace(`const b = style([ typography, sprinkles({ display: 'flex', minHeight: '100vh' }) ]);`)),
    applied,
  );

  const fixed = await lint(code, { hoistableOverrideProperties: ['minHeight', 'fontSize'] });
  assert.ok(collapseWhitespace(fixed.output).includes(`const b = style([ typography, sprinkles({ display: 'flex', minHeight: '100vh' }) ]);`), fixed.output);
});

test('S9-b. a composed class the rule cannot read keeps the allowlist from applying (suggestion only)', async () => {
  const code = `${SPRINKLES_IMPORT}\nimport { typography } from './typography.css';\nconst b = style([typography, sprinkles({ display: 'flex' }), { minHeight: '100vh' }]);`;
  const fixed = await lint(code, { hoistableOverrideProperties: ['minHeight'] });
  assert.strictEqual(fixed.output, undefined, 'typography may set minHeight; the override stays a style rule');

  const reported = await lint(code, { hoistableOverrideProperties: ['minHeight'] }, { fix: false });
  assert.strictEqual(reported.messages[0].messageId, 'manualSeparationRequired');
  assert.strictEqual(reported.messages[0].suggestions.length, 1);
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
        'sprinkles-lint/no-use-style-declared-sprinkles': [
          'error',
          { configPath: './src/sprinkles.js', usageAnalysis: 'artifact', ...ruleOptions },
        ],
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

  assert.strictEqual(result.output, undefined, 'an override of the composed atom stays put, proven or not');
  assert.deepStrictEqual(result.messages, []);
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

// --- Hoist guard: shapes and inputs the guard must survive (review of the composed-override fix) ---

test('G1. nested array next to sprinkles() → template would drop it → no fix, no suggestion', async () => {
  const code = `${SPRINKLES_IMPORT}\nconst x = style({ color: 'red' });\nconst base = style([[x], sprinkles({ display: 'flex' }), { textAlign: 'center' }]);`;
  const result = await lint(code, { hoistableOverrideProperties: ['textAlign'] });
  assert.strictEqual(result.output, undefined, 'the nested array must survive');

  const reported = await lint(code, { hoistableOverrideProperties: ['textAlign'] }, { fix: false });
  const guarded = reported.messages.find((message) => message.messageId === 'manualSeparationRequired');
  assert.ok(guarded && guarded.suggestions === undefined);
});

test('G2. spread next to sprinkles() → no fix even when allowlisted', async () => {
  const result = await lint(`${SPRINKLES_IMPORT}\nconst b = style([...rest, sprinkles({ display: 'flex' }), { textAlign: 'center' }]);`, {
    hoistableOverrideProperties: ['textAlign'],
  });
  assert.strictEqual(result.output, undefined);
});

test('G3. longhand next to a shorthand that stays in style → stays too (order inside one object)', async () => {
  const result = await lint(`${SPRINKLES_IMPORT}\nconst a = style({ margin: '0 auto', marginRight: 0 });`, { hoistableOverrideProperties: ['marginRight'] });
  assert.strictEqual(result.output, undefined, 'marginRight as an atom would lose to margin');
});

test('G4. logical property in the parent covers the physical one in the override', async () => {
  const result = await lint(
    `${SPRINKLES_IMPORT}\nconst base = style({ insetInlineStart: 4 });\nconst c = style([base, sprinkles({ display: 'flex' }), { left: 0 }]);`,
    { hoistableOverrideProperties: ['left'] },
  );
  assert.strictEqual(result.output, undefined);
});

test("G5. a bare '&' selector competes like the top level", async () => {
  const result = await lint(
    `${SPRINKLES_IMPORT}\nconst base = style({ selectors: { '&': { textAlign: 'left' } } });\nconst c = style([base, sprinkles({ display: 'flex' }), { textAlign: 'center' }]);`,
    { hoistableOverrideProperties: ['textAlign'] },
  );
  assert.strictEqual(result.output, undefined);
});

test('G6. numeric and Object.prototype keys, array holes and object spreads do not crash the rule', async () => {
  const inputs = [
    `const base = style({ 1: 'x', constructor: 'y' });\nexport const c = style([base, { textAlign: 'center' }]);`,
    `const c = style([, { textAlign: 'center' }]);`,
    `const c = style([base, { ...x, textAlign: 'center' }]);`,
  ];
  for (const input of inputs) {
    const result = await lint(`${SPRINKLES_IMPORT}\n${input}`, {}, { fix: false });
    assert.ok(!result.messages.some((message) => message.fatal || /Error/.test(message.message)), `${input}\n${JSON.stringify(result.messages)}`);
  }
});

// --- recipe() and styleVariants(): the same guard inside the call ---

test('R1. recipe variant overriding base keeps the override as a style rule', async () => {
  const result = await lint(`${SPRINKLES_IMPORT}\nexport const card = recipe({\n  base: { cursor: 'grab' },\n  variants: { disabled: { true: { cursor: 'default' } } },\n});`);
  assert.strictEqual(result.output, undefined, 'the variant would lose to base once it is an atom');
  assert.deepStrictEqual(result.messages, []);
});

test('R2. two variant groups setting the same property are left as they are', async () => {
  const result = await lint(
    `${SPRINKLES_IMPORT}\nexport const button = recipe({\n  variants: {\n    align: { start: { textAlign: 'left' } },\n    emphasis: { strong: { textAlign: 'center', display: 'flex' } },\n  },\n});`,
  );
  assert.ok(result.output.includes(`align: { start: { textAlign: 'left' } }`), result.output);
  assert.ok(/strong: \[\s*sprinkles\(\{\s*display: 'flex'\s*\}\),\s*\{\s*textAlign: 'center'\s*\}\s*\]/.test(result.output), result.output);
});

test('R3. recipe variant without overlap is still fixed', async () => {
  const result = await lint(`${SPRINKLES_IMPORT}\nexport const card = recipe({\n  base: { cursor: 'grab' },\n  variants: { tone: { center: { textAlign: 'center' } } },\n});`);
  assert.ok(result.output && result.output.includes(`center: sprinkles({`), result.output);
});

test('R4. styleVariants array: the override of a same-file class stays a style rule', async () => {
  const result = await lint(
    `${SPRINKLES_IMPORT}\nconst base = style({ textAlign: 'left' });\nexport const tone = styleVariants({ center: [base, { textAlign: 'center' }] });`,
  );
  assert.ok(!result.output || result.output.includes(`center: [base, { textAlign: 'center' }]`), result.output);
  assert.ok(!result.messages.some((message) => message.line === 3));
});

test('R5. styleVariants array next to a class the rule cannot read → suggestion only', async () => {
  const result = await lint(`${SPRINKLES_IMPORT}\nexport const tone = styleVariants({ center: [importedBase, { textAlign: 'center' }] });`);
  assert.strictEqual(result.output, undefined);

  const reported = await lint(`${SPRINKLES_IMPORT}\nexport const tone = styleVariants({ center: [importedBase, { textAlign: 'center' }] });`, {}, { fix: false });
  assert.strictEqual(reported.messages[0].messageId, 'manualSeparationRequired');
  assert.strictEqual(reported.messages[0].suggestions.length, 1);
});

test('R6. a known overlap stays out of the suggestion even when another composed class is unreadable', async () => {
  const code = `${SPRINKLES_IMPORT}\nconst localBase = style({ textAlign: 'left' });\nconst c = style([importedBase, localBase, sprinkles({ display: 'flex' }), { textAlign: 'center', width: 'auto' }]);`;
  const reported = await lint(code, {}, { fix: false });
  const guarded = reported.messages.find((message) => message.messageId === 'manualSeparationRequired');
  const applied = applySuggestion(code, guarded.suggestions[0]);
  assert.ok(/sprinkles\(\{\s*display: 'flex',\s*width: 'auto'\s*\}\)/.test(applied), applied);
  assert.ok(/\{\s*textAlign: 'center'\s*\}/.test(applied), applied);
});

test('R7. recipe variant with a selector keeps the selector block intact', async () => {
  const result = await lint(
    `${SPRINKLES_IMPORT}\nexport const link = recipe({\n  variants: { tone: { muted: { display: 'flex', ':hover': { textAlign: 'center' } } } },\n});`,
  );
  assert.ok(result.output && /':hover': \{\s*textAlign: 'center'\s*\}|':hover': \{\s*"textAlign": "center"\s*\}|':hover': \{ textAlign: 'center' \}/.test(result.output), result.output);
  assert.ok(!/':hover': sprinkles/.test(result.output), result.output);
});

test('R8. a variant array declaring a name twice is never merged by --fix (the merge keeps the first)', async () => {
  const result = await lint(
    `${SPRINKLES_IMPORT}\nexport const box = recipe({\n  variants: { size: { sm: [sprinkles({ display: 'flex' }), { width: 'auto' }, { width: '100%' }] } },\n});`,
  );
  assert.strictEqual(result.output, undefined);
});

test('R9. properties already in sprinkles() never move out (a conditional value is not a style rule)', async () => {
  const unchanged = await lint(`${SPRINKLES_IMPORT}\nexport const box = recipe({\n  variants: { t: { a: [sprinkles({ display: { mobile: 'none', desktop: 'flex' } }), { width: '50%' }] } },\n});`);
  assert.strictEqual(unchanged.output, undefined);
  assert.deepStrictEqual(unchanged.messages, []);

  const moved = await lint(`${SPRINKLES_IMPORT}\nexport const box = recipe({\n  variants: { t: { a: [sprinkles({ display: { mobile: 'none', desktop: 'flex' } }), { width: 'auto' }] } },\n});`);
  assert.ok(/sprinkles\(\{\s*display: \{ mobile: 'none', desktop: 'flex' \},\s*width: 'auto'\s*\}\)/.test(moved.output), moved.output);
});

test('R10. variant groups, options or recipe options the rule cannot read block --fix', async () => {
  const inputs = [
    `variants: { size: sizes, tone: { a: { display: 'flex' } } }`,
    `variants: { ...shared, tone: { a: { display: 'flex' } } }`,
    `variants: { size: { ...sizeOptions }, tone: { a: { display: 'flex' } } }`,
  ];
  for (const variants of inputs) {
    const result = await lint(`${SPRINKLES_IMPORT}\nexport const box = recipe({\n  ${variants},\n});`);
    assert.strictEqual(result.output, undefined, variants);
  }
  const spreadOptions = await lint(`${SPRINKLES_IMPORT}\nexport const box = recipe({\n  ...shared,\n  variants: { tone: { a: { display: 'flex' } } },\n});`);
  assert.strictEqual(spreadOptions.output, undefined);
});

test('R11. base keeps what a non-inline variant value also sets (that value is declared before base)', async () => {
  const inputs = [
    `const primary = style({ color: 'red' });\nexport const box = recipe({ base: { color: 'gray-800' }, variants: { tone: { primary } } });`,
    `export const box = recipe({ base: { display: 'flex' }, variants: { hidden: { yes: sprinkles({ display: 'none' }) } } });`,
    `export const box = recipe({ base: { display: 'flex' }, compoundVariants: [{ variants: {}, style: sprinkles({ display: 'none' }) }] });`,
  ];
  for (const input of inputs) {
    const result = await lint(`${SPRINKLES_IMPORT}\n${input}`);
    assert.strictEqual(result.output, undefined, input);
  }
});

test('R12. a name declared on both sides of a variant array is left alone without an empty report', async () => {
  const result = await lint(`${SPRINKLES_IMPORT}\nexport const box = recipe({ base: [sprinkles({ display: 'flex' }), { display: 'grid' }] });`);
  assert.strictEqual(result.output, undefined);
  assert.deepStrictEqual(result.messages, []);
});

test('R13. style() as a variant value is checked once, against base, and keeps its wrapper', async () => {
  const code = `${SPRINKLES_IMPORT}\nexport const box = recipe({\n  base: { display: 'grid' },\n  variants: { t: { a: style({ display: 'flex', width: 'auto' }) } },\n});`;
  const reported = await lint(code, {}, { fix: false });
  assert.strictEqual(reported.messages.length, 1, JSON.stringify(reported.messages));

  const result = await lint(code);
  assert.ok(/a: style\(\[\s*sprinkles\(\{\s*width: 'auto'\s*\}\),\s*\{\s*display: 'flex'\s*\}\s*\]\)/.test(result.output), result.output);
});

test('R14. style([sprinkles(...)]) as base is unwrapped once', async () => {
  const code = `${SPRINKLES_IMPORT}\nexport const box = recipe({ base: style([sprinkles({ display: 'flex' })]) });`;
  const reported = await lint(code, {}, { fix: false });
  assert.strictEqual(reported.messages.length, 1);
  assert.strictEqual(reported.messages[0].messageId, 'removeStyle');

  const result = await lint(code);
  assert.ok(result.output.includes(`base: sprinkles({ display: 'flex' })`), result.output);
});

test('R15. styleVariants mapper written as a function expression is checked', async () => {
  const result = await lint(`${SPRINKLES_IMPORT}\nexport const tone = styleVariants(map, function () { return { display: 'flex' }; });`, {}, { fix: false });
  assert.strictEqual(result.messages.length, 1);
});

test('S8-d. a movable property in a later override object is still found', async () => {
  const result = await lint(`${SPRINKLES_IMPORT}\nexport const x = style([sprinkles({ cursor: 'pointer' }), { margin: v }, { marginRight: 0, width: 'auto' }]);`, {
    hoistableOverrideProperties: ['width', 'marginRight'],
  });
  assert.ok(/sprinkles\(\{\s*cursor: 'pointer',\s*width: 'auto'\s*\}\)/.test(result.output), result.output);
  assert.ok(/marginRight: 0/.test(result.output) && !/sprinkles\(\{[^)]*marginRight/.test(result.output), result.output);
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
      console.log(`   ${error.message.split('\n')[0]}`);
    }
  }

  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  process.exit(failed > 0 ? 1 : 0);
};

run();
