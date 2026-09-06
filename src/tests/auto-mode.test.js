/**
 * `usageAnalysis` modes (plan cases V-1 … V-8).
 *
 * These build throwaway projects on disk because auto mode analyses the real filesystem: the point
 * of the mode is that no artifact file and no option are needed, and that the verdicts follow the
 * project as it changes.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ESLint } = require('eslint');
const { getScanCount } = require('../analyzer/analyze');
const { clearUsageCache, expireUsageCacheTimers, SIGNATURE_TTL_MS } = require('../analyzer/usage-cache');

const pluginPath = path.resolve(__dirname, '../..');
const FIXTURE_CONFIG_PATH = path.join(pluginPath, 'src/sprinkles.js');
const SPRINKLES_IMPORT = `import { sprinkles } from '@/styles/sprinkles.css';`;

const CSS_MODULE = `${SPRINKLES_IMPORT}
import { style } from '@vanilla-extract/css';

export const container = style([sprinkles({ display: 'flex' }), { minHeight: '100vh' }]);
`;

const SOLO_CONSUMER = `import * as styles from '@/styles.css';

export const Page = () => <div className={styles.container}>solo</div>;
`;

const COMPOSED_CONSUMER = `import * as styles from '@/styles.css';
import { Button } from '@/Button';

export const Page = () => <Button className={styles.container}>composed</Button>;
`;

const BUTTON = `export const Button = (props: { className?: string; children?: unknown }) => <button {...props} />;\n`;

const TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: 'esnext',
      module: 'esnext',
      moduleResolution: 'bundler',
      jsx: 'preserve',
      baseUrl: '.',
      paths: { '@/*': ['src/*'] },
    },
    include: ['src/**/*'],
  },
  null,
  2,
);

const PACKAGE_JSON = JSON.stringify({ name: 'auto-mode-fixture', private: true, dependencies: { '@vanilla-extract/css': '^1.16.0' } }, null, 2);

const writeProject = (extraFiles = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sprinkles-auto-'));
  const files = {
    'tsconfig.json': TSCONFIG,
    'package.json': PACKAGE_JSON,
    'src/styles.css.ts': CSS_MODULE,
    'src/styles/sprinkles.css.ts': `export const sprinkles = (value: unknown) => value;\n`,
    'src/Button.tsx': BUTTON,
    'src/page.tsx': SOLO_CONSUMER,
    ...extraFiles,
  };
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
  return root;
};

const lintProject = async (root, ruleOptions = {}, { fix = true, target = 'src/styles.css.ts' } = {}) => {
  const eslint = new ESLint({
    fix,
    cwd: root,
    useEslintrc: false,
    overrideConfig: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      plugins: ['sprinkles-lint'],
      rules: {
        'sprinkles-lint/no-use-style-declared-sprinkles': ruleOptions === null
          ? 'error'
          : ['error', { configPath: FIXTURE_CONFIG_PATH, ...ruleOptions }],
      },
    },
    resolvePluginsRelativeTo: pluginPath,
  });
  const [result] = await eslint.lintFiles([path.join(root, target)]);
  return result;
};

const SPRINKLES_MODULE = `export const sprinklesProperties = {
  display: ['none', 'flex', 'block'],
  minHeight: ['100vh'],
} as const;
`;

const cases = [];
const test = (name, run) => cases.push({ name, run });

test('V-1. no options at all → a proven-solo class is hoisted by --fix', async () => {
  clearUsageCache();
  const root = writeProject();
  const result = await lintProject(root);

  assert.notStrictEqual(result.output, undefined, 'auto mode must produce a fix');
  assert.ok(result.output.includes(`minHeight: '100vh'`));
  assert.ok(!result.output.includes('style(['), `wrapper should be gone:\n${result.output}`);
  assert.strictEqual(result.messages.length, 0);
});

test('V-2. auto and artifact agree on the same project (shared engine)', async () => {
  clearUsageCache();
  const root = writeProject();
  const autoResult = await lintProject(root);

  const { analyzeProject } = require('../analyzer/analyze');
  const artifact = analyzeProject({ rootDir: root });
  const artifactPath = path.join(root, 'proven.json');
  fs.writeFileSync(artifactPath, JSON.stringify(artifact));

  clearUsageCache();
  const artifactResult = await lintProject(root, { provenSoloClassesPath: artifactPath });

  assert.strictEqual(artifactResult.output, autoResult.output, 'both modes must produce identical output');
  assert.strictEqual(artifactResult.messages.length, autoResult.messages.length);
});

test('V-3. a second lint in the same process reuses the cache (no rescan)', async () => {
  clearUsageCache();
  const root = writeProject();

  await lintProject(root);
  const afterFirst = getScanCount();
  await lintProject(root);

  assert.strictEqual(getScanCount(), afterFirst, 'the cached verdicts must be reused');
});

test('V-4. editing a consumer into a composition flips the class to unproven', async () => {
  clearUsageCache();
  const root = writeProject();
  assert.notStrictEqual((await lintProject(root)).output, undefined, 'starts proven');

  const consumer = path.join(root, 'src/page.tsx');
  fs.writeFileSync(consumer, COMPOSED_CONSUMER);
  const future = new Date(Date.now() + 5_000);
  fs.utimesSync(consumer, future, future);
  expireUsageCacheTimers();

  const scansBefore = getScanCount();
  const result = await lintProject(root);

  assert.ok(getScanCount() > scansBefore, 'a changed consumer must trigger a rescan');
  assert.strictEqual(result.output, undefined, 'composed class must no longer be hoisted');
  assert.strictEqual(result.messages[0].messageId, 'manualSeparationRequired');
});

test('V-5. adding a new consumer file flips the class to unproven', async () => {
  clearUsageCache();
  const root = writeProject();
  assert.notStrictEqual((await lintProject(root)).output, undefined, 'starts proven');

  fs.writeFileSync(path.join(root, 'src/late.tsx'), COMPOSED_CONSUMER);
  expireUsageCacheTimers();
  const result = await lintProject(root);

  assert.strictEqual(result.output, undefined, 'a newly added composition must be seen');
  assert.strictEqual(result.messages[0].messageId, 'manualSeparationRequired');
});

test('V-6. an import the graph cannot follow disables proofs entirely', async () => {
  clearUsageCache();
  const root = writeProject({ 'src/broken.tsx': `import { x } from '@/does/not/exist';\n\nexport const Broken = () => <i className={x} />;\n` });
  const result = await lintProject(root);

  assert.strictEqual(result.output, undefined, 'an incomplete graph must not prove anything');
  assert.strictEqual(result.messages[0].messageId, 'manualSeparationRequired');
});

test('V-7. usageAnalysis: off behaves like 2.17.0 (suggestion only)', async () => {
  clearUsageCache();
  const root = writeProject();
  const result = await lintProject(root, { usageAnalysis: 'off' });

  assert.strictEqual(result.output, undefined);
  assert.strictEqual(result.messages[0].messageId, 'manualSeparationRequired');
});

test('V-8. an existing provenSoloClassesPath config still selects artifact mode', async () => {
  clearUsageCache();
  const root = writeProject({ 'src/page.tsx': COMPOSED_CONSUMER });

  // The artifact claims the class is proven while the project says otherwise: if the rule were
  // silently running auto mode, this would report instead of fixing.
  const artifactPath = path.join(root, 'proven.json');
  const { analyzeProject, sha256 } = require('../analyzer/analyze');
  const real = analyzeProject({ rootDir: root });
  fs.writeFileSync(
    artifactPath,
    JSON.stringify({ ...real, provenSoloClasses: { 'src/styles.css.ts': ['container'] }, unproven: {}, sha256: sha256('x') }),
  );

  const result = await lintProject(root, { provenSoloClassesPath: artifactPath });
  assert.notStrictEqual(result.output, undefined, 'artifact mode must be in charge, not auto');
  assert.ok(result.output.includes(`minHeight: '100vh'`));
});

test('V-TTL. within the freshness window the cached verdicts are reused (documented trade-off)', async () => {
  clearUsageCache();
  const root = writeProject();
  assert.notStrictEqual((await lintProject(root)).output, undefined, 'starts proven');

  // Same change as V-4, but without letting the freshness window lapse: one lint run is meant to
  // see one snapshot of the project, so the verdict is intentionally not re-derived here.
  fs.writeFileSync(path.join(root, 'src/page.tsx'), COMPOSED_CONSUMER);
  const scansBefore = getScanCount();
  const result = await lintProject(root);

  assert.strictEqual(getScanCount(), scansBefore, 'no rescan inside the window');
  assert.notStrictEqual(result.output, undefined, 'the cached proof is still applied');
  assert.ok(SIGNATURE_TTL_MS <= 2_000, 'the window must stay within the couple of seconds the design allows');
});

// A monorepo laid out so the linted package has its own tsconfig with `paths` while a consumer
// lives in a sibling package — the shape that must never yield a proof by default.
const writeMonorepo = () => {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'sprinkles-mono-'));
  const packageDir = path.join(outer, 'packages/ui');
  fs.mkdirSync(path.join(packageDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(outer, 'apps/web/src'), { recursive: true });

  fs.writeFileSync(path.join(outer, 'tsconfig.json'), JSON.stringify({ references: [{ path: './packages/ui' }] }));
  fs.writeFileSync(path.join(outer, 'package.json'), PACKAGE_JSON);
  fs.writeFileSync(path.join(packageDir, 'tsconfig.json'), TSCONFIG);
  fs.writeFileSync(path.join(packageDir, 'package.json'), PACKAGE_JSON);
  fs.writeFileSync(path.join(packageDir, 'src/styles.css.ts'), CSS_MODULE);
  fs.mkdirSync(path.join(packageDir, 'src/styles'), { recursive: true });
  fs.writeFileSync(path.join(packageDir, 'src/styles/sprinkles.css.ts'), SPRINKLES_MODULE);
  fs.writeFileSync(path.join(packageDir, 'src/Button.tsx'), BUTTON);
  fs.writeFileSync(
    path.join(outer, 'apps/web/src/Page.tsx'),
    `import * as styles from '../../../packages/ui/src/styles.css';
import { Button } from '../../../packages/ui/src/Button';

export const Page = () => <Button className={styles.container}>composed elsewhere</Button>;
`,
  );
  return { outer, packageDir };
};

test('V-mono. a consumer in a sibling package is seen, so the class is not proven', async () => {
  clearUsageCache();
  const { outer } = writeMonorepo();
  const result = await lintProject(outer, {}, { target: 'packages/ui/src/styles.css.ts' });

  assert.strictEqual(result.output, undefined, 'a cross-package composition must never be hoisted');
  assert.strictEqual(result.messages[0].messageId, 'manualSeparationRequired');
});

test('V-projectRoot. narrowing the scanned tree is only possible by asking for it explicitly', async () => {
  clearUsageCache();
  const { outer } = writeMonorepo();

  // Same tree as V-mono: the only difference is that the project boundary is stated, which excludes
  // the sibling consumer from the walk and lets the class be proven inside that boundary.
  const result = await lintProject(outer, { projectRoot: 'packages/ui' }, { target: 'packages/ui/src/styles.css.ts' });

  assert.notStrictEqual(result.output, undefined, 'an explicit projectRoot defines the closed world');
  assert.ok(result.output.includes(`minHeight: '100vh'`));
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
