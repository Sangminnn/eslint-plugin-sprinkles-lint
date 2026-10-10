/**
 * The facts of a scan survive the process (node_modules/.cache), so a new `eslint` run re-reads only
 * the files that changed since the last one — and never trusts a cache it cannot fully read.
 * Every lint below runs in its own child process.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { diskCachePathFor } = require('../analyzer/usage-cache');

const lintOnce = (root, target = 'src/styles.css.ts') =>
  JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'helpers/lint-once.js'), root, target], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));

const GUARDED_CARD = `import { sprinkles } from '@/styles/sprinkles.css';\nimport { style } from '@vanilla-extract/css';\n\nexport const card = style([sprinkles({ display: 'flex' }), { minHeight: '100vh' }]);\n`;

const TSCONFIG = JSON.stringify({
  compilerOptions: { target: 'esnext', module: 'esnext', moduleResolution: 'bundler', jsx: 'preserve', baseUrl: '.', paths: { '@/*': ['src/*'] } },
  include: ['src/**/*'],
});

const SOLO = `import * as styles from '@/styles.css';\n\nexport const Page = () => <div className={styles.container}>solo</div>;\n`;
const COMPOSED = `import * as styles from '@/styles.css';\nimport { Button } from '@/Button';\n\nexport const Page = () => <Button className={styles.container}>composed</Button>;\n`;

// Clearly in the past, so no write lands inside the racy window and gets re-read on purpose.
let clock = Date.now() - 10_000_000;
const write = (root, relativePath, content) => {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
  clock += 1_000;
  fs.utimesSync(fullPath, new Date(clock), new Date(clock));
};

const writeProject = ({ withNodeModules }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sprinkles-disk-'));
  write(root, 'tsconfig.json', TSCONFIG);
  write(root, 'package.json', JSON.stringify({ name: 'disk', private: true, dependencies: { '@vanilla-extract/css': '^1.16.0' } }));
  write(root, 'src/styles.css.ts', `import { sprinkles } from '@/styles/sprinkles.css';\nimport { style } from '@vanilla-extract/css';\n\nexport const container = style([sprinkles({ display: 'flex' }), { minHeight: '100vh' }]);\n`);
  write(root, 'src/styles/sprinkles.css.ts', `export const sprinkles = (value: unknown) => value;\n`);
  write(root, 'src/Button.tsx', `export const Button = (props: { className?: string }) => <button {...props} />;\n`);
  write(root, 'src/page.tsx', SOLO);
  for (let index = 0; index < 20; index += 1) write(root, `src/filler/f${index}.tsx`, `export const F${index} = () => <i>${index}</i>;\n`);
  if (withNodeModules) fs.mkdirSync(path.join(root, 'node_modules'));
  return root;
};

const run = () => {
  let failed = 0;
  const check = (name, condition, detail) => {
    if (condition) console.log(`✅ ${name}`);
    else {
      failed += 1;
      console.log(`❌ ${name}`);
      console.log(`   ${detail}`);
    }
  };

  const root = writeProject({ withNodeModules: true });
  const sourceFileCount = 24; // 4 project files + 20 fillers (tsconfig and package.json are not sources)
  const cachePath = diskCachePathFor(root, path.join(root, 'tsconfig.json'));

  const first = lintOnce(root);
  check('first process scans everything and proves the class', first.extracts === sourceFileCount && first.fixed, JSON.stringify(first));
  check('it leaves a cache in node_modules/.cache', Boolean(cachePath) && fs.existsSync(cachePath), `missing ${cachePath}`);

  const second = lintOnce(root);
  check('a new process with nothing changed re-reads 0 files', second.extracts === 0, JSON.stringify(second));
  check('…and reaches the same verdict', second.fixed, JSON.stringify(second));

  write(root, 'src/page.tsx', COMPOSED);
  const third = lintOnce(root);
  check('after one consumer edit a new process re-reads exactly 1 file', third.extracts === 1, JSON.stringify(third));
  check('…and sees the composition (no hoist)', !third.fixed && third.messageIds.includes('manualSeparationRequired'), JSON.stringify(third));

  write(root, 'src/late.tsx', SOLO);
  const fourth = lintOnce(root);
  check('an added file is the only one read', fourth.extracts === 1, JSON.stringify(fourth));

  // A directory package: which css module `../ui` means is decided by a package.json, not a source.
  write(root, 'src/ui/a.css.ts', GUARDED_CARD);
  write(root, 'src/ui/b.css.ts', GUARDED_CARD);
  write(root, 'src/ui/package.json', JSON.stringify({ types: './a.css.ts' }));
  write(root, 'src/ui-page.tsx', `import { card } from './ui';\nimport { Button } from '@/Button';\n\nexport const UiPage = () => <Button className={card} />;\n`);
  const beforeSwitch = lintOnce(root, 'src/ui/b.css.ts');
  check('b.css.ts is unused while package.json points at a.css.ts', beforeSwitch.fixed, JSON.stringify(beforeSwitch));

  write(root, 'src/ui/package.json', JSON.stringify({ types: './b.css.ts' }));
  const afterSwitch = lintOnce(root, 'src/ui/b.css.ts');
  check('after package.json switches to b.css.ts a new process sees the composition', !afterSwitch.fixed, JSON.stringify(afterSwitch));
  check('…without re-reading any source', afterSwitch.extracts === 0, JSON.stringify(afterSwitch));

  // Structurally valid JSON at the top level, broken facts inside: must not be trusted.
  const stored = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  for (const entry of Object.values(stored.files)) entry.facts = { isCss: false };
  fs.writeFileSync(cachePath, JSON.stringify(stored));
  const malformed = lintOnce(root);
  check('a cache with malformed facts is discarded (full scan)', malformed.extracts === sourceFileCount + 4, JSON.stringify(malformed));

  fs.writeFileSync(cachePath, '{ this is not json');
  const corrupt = lintOnce(root);
  check('a corrupt cache falls back to a full scan', corrupt.extracts === sourceFileCount + 4, JSON.stringify(corrupt));
  check('…with the correct verdict', !corrupt.fixed, JSON.stringify(corrupt));

  const tsconfig = JSON.parse(TSCONFIG);
  tsconfig.compilerOptions.paths['@alt/*'] = ['src/*'];
  write(root, 'tsconfig.json', JSON.stringify(tsconfig));
  const reconfigured = lintOnce(root);
  check('changed compiler options discard the cache', reconfigured.extracts === sourceFileCount + 4, JSON.stringify(reconfigured));

  const bare = writeProject({ withNodeModules: false });
  lintOnce(bare);
  check('a project without node_modules gets no cache directory', !fs.existsSync(path.join(bare, 'node_modules')), 'node_modules was created');

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(bare, { recursive: true, force: true });
  console.log(`\n${failed === 0 ? 'disk cache behaves' : `${failed} check(s) failed`}`);
  process.exit(failed > 0 ? 1 : 0);
};

run();
