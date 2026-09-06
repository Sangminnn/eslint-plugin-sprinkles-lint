/**
 * Performance guard for auto mode.
 *
 * The mode trades a one-off project scan for zero configuration, so the two numbers that decide
 * whether that trade is acceptable are pinned here: how long the first scan takes, and what a lint
 * costs once the verdicts are cached (a file-list sweep, not a scan).
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeProject, isSignatureStale, getScanCount } = require('../analyzer/analyze');

const CSS_MODULE_COUNT = 400;
const CONSUMER_COUNT = 1_600;
const FIRST_SCAN_BUDGET_MS = 5_000;
const CACHED_SWEEP_BUDGET_MS = 100;

const buildProject = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sprinkles-perf-'));
  fs.mkdirSync(path.join(root, 'src/style'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/comp'), { recursive: true });

  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { target: 'esnext', module: 'esnext', moduleResolution: 'bundler', jsx: 'preserve', baseUrl: '.', paths: { '@/*': ['src/*'] } },
      include: ['src/**/*'],
    }),
  );
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'perf', private: true, dependencies: { '@vanilla-extract/css': '^1.16.0' } }));

  for (let index = 0; index < CSS_MODULE_COUNT; index += 1) {
    fs.writeFileSync(
      path.join(root, 'src/style', `s${index}.css.ts`),
      `import { style } from '@vanilla-extract/css';\nexport const box${index} = style({ minHeight: '100vh' });\n`,
    );
  }
  for (let index = 0; index < CONSUMER_COUNT; index += 1) {
    const moduleIndex = index % CSS_MODULE_COUNT;
    fs.writeFileSync(
      path.join(root, 'src/comp', `c${index}.tsx`),
      `import * as st from '@/style/s${moduleIndex}.css';\nexport const C${index} = () => <div className={st.box${moduleIndex}}>{${index}}</div>;\n`,
    );
  }
  return root;
};

const measure = (label, run) => {
  const startedAt = process.hrtime.bigint();
  const value = run();
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  console.log(`   ${label}: ${elapsedMs.toFixed(0)}ms`);
  return { value, elapsedMs };
};

const run = () => {
  const root = buildProject();
  const fileCount = CSS_MODULE_COUNT + CONSUMER_COUNT;
  console.log(`🏗  ${fileCount} files in ${root}`);

  let failed = 0;
  const check = (name, condition, detail) => {
    if (condition) {
      console.log(`✅ ${name}`);
    } else {
      failed += 1;
      console.log(`❌ ${name}`);
      console.log(`   ${detail}`);
    }
  };

  const scan = measure('first scan', () => analyzeProject({ rootDir: root, collectFileHashes: false }));
  check(
    `first scan of ${fileCount} files stays under ${FIRST_SCAN_BUDGET_MS}ms`,
    scan.elapsedMs < FIRST_SCAN_BUDGET_MS,
    `took ${scan.elapsedMs.toFixed(0)}ms`,
  );

  assert.strictEqual(Object.values(scan.value.provenSoloClasses).flat().length, CSS_MODULE_COUNT, 'every class is used solo, so all should be proven');
  assert.strictEqual(scan.value.unresolvedImports.length, 0);

  const sweep = measure('cached sweep', () => isSignatureStale(scan.value.signature, { rootDir: root }));
  check(
    `a cached lint sweeps the file list in under ${CACHED_SWEEP_BUDGET_MS}ms`,
    sweep.elapsedMs < CACHED_SWEEP_BUDGET_MS,
    `took ${sweep.elapsedMs.toFixed(0)}ms`,
  );
  check('the sweep reports an unchanged project as fresh', sweep.value === false, `isSignatureStale returned ${sweep.value}`);

  const scansBefore = getScanCount();
  fs.writeFileSync(path.join(root, 'src/comp/late.tsx'), `export const Late = () => <i />;\n`);
  const afterAdd = measure('sweep after adding a file', () => isSignatureStale(scan.value.signature, { rootDir: root }));
  check('adding a file is detected by the sweep', afterAdd.value === true, 'a new consumer went unnoticed');
  check('sweeping never triggers a scan by itself', getScanCount() === scansBefore, 'the sweep must stay read-only');

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${failed === 0 ? 'all budgets met' : `${failed} budget(s) exceeded`}`);
  process.exit(failed > 0 ? 1 : 0);
};

run();
