/**
 * Incremental analysis must be indistinguishable from a fresh scan.
 *
 * A project is mutated step by step — consumers edited into and out of compositions, files added and
 * deleted, css exports renamed, the tsconfig changed — and after every step the incremental result
 * (built from the previous step's state) is compared field by field with a from-scratch scan. The
 * number of files actually re-read is checked too, so "incremental" is not just a fresh scan in
 * disguise.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeProject, analyzeProjectIncremental, getExtractCount } = require('../analyzer/analyze');

const fixtureRoot = path.join(__dirname, 'analyzer-fixtures');

const comparable = (artifact) =>
  JSON.stringify({
    proven: artifact.provenSoloClasses,
    unproven: artifact.unproven,
    unresolved: artifact.unresolvedImports,
    unscanned: artifact.unscannedImports,
    ignored: artifact.ignoredImports,
    excluded: artifact.excluded,
    tsconfigLoaded: artifact.tsconfigLoaded,
  });

// Every write moves the mtime forward explicitly: two writes inside one clock tick must still count.
// Clearly in the past, so no write lands inside the racy window and gets re-read on purpose.
let clock = Date.now() - 10_000_000;
const write = (root, relativePath, content) => {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
  clock += 1_000;
  fs.utimesSync(fullPath, new Date(clock), new Date(clock));
};

// Copies get fresh mtimes; age them so the baseline scan is not entirely inside the racy window.
const ageTree = (directory) => {
  const past = new Date(Date.now() - 20_000_000);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) ageTree(fullPath);
    else fs.utimesSync(fullPath, past, past);
  }
};

const UI_PACKAGE_SETUP = (root) => {
  write(root, 'src/ui/a.css.ts', `import { style } from '@vanilla-extract/css';\nexport const card = style({ width: 'auto' });\n`);
  write(root, 'src/ui/b.css.ts', `import { style } from '@vanilla-extract/css';\nexport const card = style({ width: 'auto' });\n`);
  write(root, 'src/ui/package.json', JSON.stringify({ types: './a.css.ts' }));
  write(root, 'src/pages/usage-ui.tsx', `import { card } from '../ui';\nimport { Button } from '../components/kit';\n\nexport const Ui = () => <Button className={card} />;\n`);
};

const steps = [
  {
    name: 'edit a solo consumer into a component composition',
    changedFiles: 1,
    expect: (artifact) => artifact.unproven['src/styles.css.ts']?.soloA2 === 'composed-with-component:Button',
    apply: (root) => write(root, 'src/pages/usage-safe.tsx', `import * as styles from '../styles.css';\nimport { Button } from '../components/kit';\n\nexport const SafePage = () => <Button className={styles.soloA2}>x</Button>;\n`),
  },
  {
    name: 'edit it back to a solo use',
    changedFiles: 1,
    expect: (artifact) => artifact.provenSoloClasses['src/styles.css.ts'].includes('soloA2'),
    apply: (root) => write(root, 'src/pages/usage-safe.tsx', `import * as styles from '../styles.css';\n\nexport const SafePage = () => <span className={styles.soloA2}>x</span>;\n`),
  },
  {
    name: 'add a new consumer that composes an unused class',
    changedFiles: 1,
    expect: (artifact) => artifact.unproven['src/styles.css.ts']?.unusedU === 'composed-in-call:clsx',
    apply: (root) => write(root, 'src/pages/late.tsx', `import { unusedU } from '../styles.css';\nimport clsx from 'clsx';\n\nexport const Late = () => <div className={clsx(unusedU, 'x')} />;\n`),
  },
  {
    name: 'delete that consumer again',
    changedFiles: 0,
    expect: (artifact) => artifact.provenSoloClasses['src/styles.css.ts'].includes('unusedU'),
    apply: (root) => fs.rmSync(path.join(root, 'src/pages/late.tsx')),
  },
  {
    name: 'add a css module and a re-export barrel for it',
    changedFiles: 3,
    expect: (artifact) => artifact.unproven['src/fresh.css.ts']?.freshCard === 'composed-with-component:Button',
    apply: (root) => {
      write(root, 'src/fresh.css.ts', `import { style } from '@vanilla-extract/css';\nexport const freshCard = style({ width: 'auto' });\n`);
      write(root, 'src/components/fresh-barrel.ts', `export { freshCard } from '../fresh.css';\n`);
      write(root, 'src/pages/usage-fresh.tsx', `import { freshCard } from '../components/fresh-barrel';\nimport { Button } from '../components/kit';\n\nexport const Fresh = () => <Button className={freshCard} />;\n`);
    },
  },
  {
    name: 'rename an export the barrel points at (graph must not keep the old edge)',
    changedFiles: 1,
    // The consumer now imports a name that no longer exists, so nothing uses the renamed class.
    expect: (artifact) => artifact.provenSoloClasses['src/fresh.css.ts']?.includes('renamedCard'),
    apply: (root) => write(root, 'src/fresh.css.ts', `import { style } from '@vanilla-extract/css';\nexport const renamedCard = style({ width: 'auto' });\n`),
  },
  {
    name: 'create a file an unresolved alias was pointing at',
    changedFiles: 1,
    expect: (artifact) => !artifact.unresolvedImports.some((entry) => entry.specifier === '@fixture/nonexistent/module'),
    apply: (root) => write(root, 'src/nonexistent/module.ts', `export const ghostCard = 'x';\n`),
  },
  {
    name: 'add a directory package whose package.json picks the css module',
    changedFiles: 3,
    apply: UI_PACKAGE_SETUP,
    expect: (artifact) =>
      artifact.unproven['src/ui/a.css.ts']?.card === 'composed-with-component:Button' && artifact.provenSoloClasses['src/ui/b.css.ts']?.includes('card'),
  },
  {
    // No source file changes here — only the nested package.json that resolution reads.
    name: 'point that package.json at the other module (resolution must not be reused)',
    changedFiles: 0,
    apply: (root) => write(root, 'src/ui/package.json', JSON.stringify({ types: './b.css.ts' })),
    expect: (artifact) =>
      artifact.unproven['src/ui/b.css.ts']?.card === 'composed-with-component:Button' && artifact.provenSoloClasses['src/ui/a.css.ts']?.includes('card'),
  },
  {
    // Same mtime as before, different size: only the size comparison can notice this edit.
    name: 'edit a consumer while preserving its mtime',
    changedFiles: 1,
    apply: (root) => {
      const consumer = path.join(root, 'src/pages/usage-safe.tsx');
      const { mtime } = fs.statSync(consumer);
      fs.writeFileSync(consumer, `import * as styles from '../styles.css';\nimport { Button } from '../components/kit';\n\nexport const SafePage = () => <Button className={styles.soloA2}>preserved mtime</Button>;\n`);
      fs.utimesSync(consumer, mtime, mtime);
    },
    expect: (artifact) => artifact.unproven['src/styles.css.ts']?.soloA2 === 'composed-with-component:Button',
  },
  {
    name: 'change tsconfig paths (everything must be re-read)',
    changedFiles: 'all',
    apply: (root) => {
      const tsconfigPath = path.join(root, 'tsconfig.json');
      const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
      tsconfig.compilerOptions.paths['@alt/*'] = ['src/*'];
      write(root, 'tsconfig.json', JSON.stringify(tsconfig, null, 2));
    },
  },
];

const runRacyCheck = (check) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sprinkles-racy-'));
  fs.cpSync(fixtureRoot, root, { recursive: true });
  ageTree(root);
  const consumer = path.join(root, 'src/pages/usage-safe.tsx');
  const now = new Date();
  fs.utimesSync(consumer, now, now); // inside the racy window
  const { state } = analyzeProjectIncremental({ rootDir: root, tsconfigPath: 'tsconfig.json', collectFileHashes: false });

  const extractsBefore = getExtractCount();
  analyzeProjectIncremental({ rootDir: root, tsconfigPath: 'tsconfig.json', collectFileHashes: false }, state);
  check('a file written within the racy window is re-read even though mtime and size match', getExtractCount() - extractsBefore === 1, `re-read ${getExtractCount() - extractsBefore}`);
  fs.rmSync(root, { recursive: true, force: true });
};

const run = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sprinkles-incremental-'));
  fs.cpSync(fixtureRoot, root, { recursive: true });
  ageTree(root);

  let failed = 0;
  const check = (name, condition, detail) => {
    if (condition) console.log(`✅ ${name}`);
    else {
      failed += 1;
      console.log(`❌ ${name}`);
      console.log(`   ${detail}`);
    }
  };

  let { state } = analyzeProjectIncremental({ rootDir: root, tsconfigPath: 'tsconfig.json', collectFileHashes: false });
  const fileCount = Object.keys(state.files).length;

  for (const step of steps) {
    step.apply(root);

    const extractsBefore = getExtractCount();
    const incremental = analyzeProjectIncremental({ rootDir: root, tsconfigPath: 'tsconfig.json', collectFileHashes: false }, state);
    const reExtracted = getExtractCount() - extractsBefore;
    const fresh = analyzeProject({ rootDir: root, tsconfigPath: 'tsconfig.json', collectFileHashes: false });

    check(`${step.name} — identical to a fresh scan`, comparable(incremental.artifact) === comparable(fresh), 'incremental and fresh results differ');
    // The step must really move the verdicts, or "identical" would prove nothing.
    if (step.expect) check(`${step.name} — verdict moved as expected`, step.expect(incremental.artifact), 'the mutation did not change the verdict');

    const expected = step.changedFiles === 'all' ? Object.keys(incremental.state.files).length : step.changedFiles;
    check(`${step.name} — re-read ${expected} file(s)`, reExtracted === expected, `re-read ${reExtracted} of ${fileCount}`);

    state = incremental.state;
  }

  fs.rmSync(root, { recursive: true, force: true });
  runRacyCheck(check);
  console.log(`\n${failed === 0 ? 'all steps match' : `${failed} check(s) failed`}`);
  process.exit(failed > 0 ? 1 : 0);
};

run();
