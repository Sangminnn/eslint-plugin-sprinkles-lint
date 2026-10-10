/**
 * Files git ignores are not part of the project. A repository commonly holds full copies of itself
 * under ignored paths (git worktrees, scratch copies, build output); reading them as consumers drags
 * in stale imports that refuse every proof. Tracked dot-directories such as .storybook still count.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Keep the developer's own git configuration (global excludes, system config) out of the results.
const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sprinkles-git-home-'));
fs.writeFileSync(path.join(isolatedHome, '.gitconfig'), '');
process.env.GIT_CONFIG_GLOBAL = path.join(isolatedHome, '.gitconfig');
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.XDG_CONFIG_HOME = path.join(isolatedHome, '.config');
const {
  analyzeProjectIncremental,
  analyzeProject,
  isSignatureStale,
  getGitListCount,
  getWalkCount,
  getTsconfigParseCount,
  walkSourceFiles,
  narrowWalk,
  ignoresAtLeast,
} = require('../analyzer/analyze');

const TSCONFIG = JSON.stringify({
  compilerOptions: { target: 'esnext', module: 'esnext', moduleResolution: 'bundler', jsx: 'preserve', baseUrl: '.', paths: { '@/*': ['src/*'] } },
  include: ['src/**/*', '.storybook/**/*'],
});

let clock = Date.now() - 10_000_000;
const write = (root, relativePath, content) => {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
  clock += 1_000;
  fs.utimesSync(fullPath, new Date(clock), new Date(clock));
};
const git = (root, ...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });

const writeRepository = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sprinkles-gitignore-'));
  git(root, 'init', '-q');
  write(root, '.gitignore', '.worktrees/\n.scratch/\n');
  write(root, 'tsconfig.json', TSCONFIG);
  write(root, 'package.json', JSON.stringify({ name: 'g', private: true, dependencies: { '@vanilla-extract/css': '^1' } }));
  write(root, 'src/styles.css.ts', `import { style } from '@vanilla-extract/css';\nexport const solo = style({ minHeight: '100vh' });\nexport const storied = style({ minHeight: '100vh' });\n`);
  write(root, 'src/Button.tsx', `export const Button = (props: { className?: string }) => <button {...props} />;\n`);
  write(root, 'src/page.tsx', `import * as styles from '@/styles.css';\nexport const Page = () => <div className={styles.solo} />;\n`);
  // tracked dot-directory: a real renderer
  write(root, '.storybook/preview.tsx', `import * as styles from '../src/styles.css';\nimport { Button } from '../src/Button';\nexport const Decorator = () => <Button className={styles.storied} />;\n`);
  // ignored copies of the repository with stale paths and a composition of `solo`
  write(root, '.worktrees/old/src/page.tsx', `import * as styles from '../../../src/styles.css';\nimport { Button } from '../../../src/Button';\nimport { gone } from '@/removed/module';\nexport const Old = () => <Button className={styles.solo}>{gone}</Button>;\n`);
  write(root, '.scratch/copy.tsx', `import { missing } from '../src/nope';\nexport const Copy = () => missing;\n`);
  git(root, 'add', '-A');
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
  const analyse = (root, state = null) => analyzeProjectIncremental({ rootDir: root, tsconfigPath: 'tsconfig.json', collectFileHashes: false }, state);

  const root = writeRepository();
  let { artifact, state } = analyse(root);
  const scanned = Object.keys(artifact.signature.files);

  check('git is used to prune', artifact.ignoreSource === 'git', `ignoreSource=${artifact.ignoreSource}`);
  check('ignored copies are not scanned', !scanned.some((file) => file.startsWith('.worktrees/') || file.startsWith('.scratch/')), scanned.join(', '));
  check('their broken imports do not refuse the analysis', artifact.unresolvedImports.length === 0, JSON.stringify(artifact.unresolvedImports));
  check('a composition that only exists in an ignored copy does not count', artifact.provenSoloClasses['src/styles.css.ts']?.includes('solo'), JSON.stringify(artifact.unproven));
  check('a tracked .storybook consumer still counts', artifact.unproven['src/styles.css.ts']?.storied === 'composed-with-component:Button', JSON.stringify(artifact.unproven));

  // Content edit: git is not asked again.
  const gitCallsBefore = getGitListCount();
  write(root, 'src/page.tsx', `import * as styles from '@/styles.css';\nexport const Page = () => <section className={styles.solo} />;\n`);
  ({ artifact, state } = analyse(root, state));
  check('a content edit reuses the ignore list (no git call)', getGitListCount() === gitCallsBefore, `git called ${getGitListCount() - gitCallsBefore}×`);

  // The sweep uses the stored list: a new file inside an ignored directory is not a change.
  write(root, '.worktrees/new-copy/src/page.tsx', `export const N = 1;\n`);
  check('a new file under an ignored directory does not mark the cache stale', !isSignatureStale(artifact.signature, { rootDir: root, tsconfigPath: 'tsconfig.json' }), 'stale');

  // A new tracked-path file: stale, and git is asked again.
  write(root, 'src/late.tsx', `export const Late = 1;\n`);
  check('a new project file marks the cache stale', isSignatureStale(artifact.signature, { rootDir: root, tsconfigPath: 'tsconfig.json' }), 'not stale');
  const gitCallsBeforeAdd = getGitListCount();
  const walksBeforeAdd = getWalkCount();
  const parsesBeforeAdd = getTsconfigParseCount();
  ({ artifact, state } = analyse(root, state));
  check('a file-set change asks git again', getGitListCount() === gitCallsBeforeAdd + 1, `git called ${getGitListCount() - gitCallsBeforeAdd}×`);
  check('…but walks the tree once (the walk is narrowed, not repeated)', getWalkCount() === walksBeforeAdd + 1, `walked ${getWalkCount() - walksBeforeAdd}×`);
  check('…and expands the tsconfig include once', getTsconfigParseCount() === parsesBeforeAdd + 1, `parsed ${getTsconfigParseCount() - parsesBeforeAdd}×`);
  check('…with the same result as a fresh scan', JSON.stringify(artifact.provenSoloClasses) === JSON.stringify(analyzeProject({ rootDir: root, tsconfigPath: 'tsconfig.json', collectFileHashes: false }).provenSoloClasses), 'differs');

  // A .gitignore that ignores more: narrowed, and identical to a fresh scan. `tools/` is outside the
  // tsconfig include, so only the walk decides whether it is read — narrowing has to drop it.
  write(root, 'tools/lib.tsx', `import * as styles from '../src/styles.css';\nimport { Button } from '../src/Button';\nexport const Lib = () => <Button className={styles.solo} />;\n`);
  ({ artifact, state } = analyse(root, state));
  check('a new consumer composing `solo` makes it unproven', artifact.unproven['src/styles.css.ts']?.solo === 'composed-with-component:Button', JSON.stringify(artifact.unproven));
  write(root, '.gitignore', '.worktrees/\n.scratch/\ntools/\n');
  const walksBeforeStricter = getWalkCount();
  ({ artifact, state } = analyse(root, state));
  check('a stricter .gitignore narrows the existing walk (one walk)', getWalkCount() === walksBeforeStricter + 1, `walked ${getWalkCount() - walksBeforeStricter}×`);
  const freshStricter = analyzeProject({ rootDir: root, tsconfigPath: 'tsconfig.json', collectFileHashes: false });
  check('…so the now-ignored consumer no longer counts', artifact.provenSoloClasses['src/styles.css.ts']?.includes('solo'), JSON.stringify(artifact.unproven));
  check('…and matches a fresh scan', JSON.stringify(artifact.unproven) === JSON.stringify(freshStricter.unproven) && JSON.stringify(artifact.signature.files) === JSON.stringify(freshStricter.signature.files), 'differs');

  // Un-ignoring .scratch brings its broken import into the project: stale, then refused.
  write(root, '.gitignore', '.worktrees/\n');
  check('an edited .gitignore marks the cache stale', isSignatureStale(artifact.signature, { rootDir: root, tsconfigPath: 'tsconfig.json' }), 'not stale');
  ({ artifact, state } = analyse(root, state));
  check('…and the newly un-ignored file is scanned', artifact.unresolvedImports.some((entry) => entry.file === '.scratch/copy.tsx'), JSON.stringify(artifact.unresolvedImports));

  // An ignored file that tsconfig includes is still scanned — the compiler sees it, so it counts.
  const generated = writeRepository();
  write(generated, '.gitignore', '.worktrees/\n.scratch/\nsrc/generated/\n');
  write(generated, 'src/generated/Panel.tsx', `import * as styles from '../styles.css';\nimport { Button } from '../Button';\nexport const Panel = () => <Button className={styles.solo} />;\n`);
  const included = analyse(generated).artifact;
  check('an ignored file inside tsconfig include is still scanned', included.unproven['src/styles.css.ts']?.solo === 'composed-with-component:Button', JSON.stringify(included.unproven));

  // An ignored file outside tsconfig that scanned code imports is part of the graph: refused, not dropped.
  const hidden = writeRepository();
  write(hidden, '.gitignore', '.worktrees/\n.scratch/\n.gen/\n');
  write(hidden, '.gen/Panel.tsx', `import * as styles from '../src/styles.css';\nimport { Button } from '../src/Button';\nexport const Panel = () => <Button className={styles.solo} />;\n`);
  write(hidden, 'src/page.tsx', `import * as styles from '@/styles.css';\nimport { Panel } from '../.gen/Panel';\nexport const Page = () => <div className={styles.solo}><Panel /></div>;\n`);
  const refused = analyse(hidden).artifact;
  check('an ignored, non-tsconfig file imported by scanned code is reported as unscanned', refused.unscannedImports.some((entry) => entry.resolved === '.gen/Panel.tsx'), JSON.stringify(refused.unscannedImports));

  // narrowWalk must equal a fresh walk, field by field, including collapsed and nested ignores.
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'sprinkles-narrow-'));
  for (const file of ['a/b/c/x.ts', 'a/b/y.ts', 'a/z.ts', 'a/package.json', 'a/b/.gitignore', 'k/keep.ts', 'k/drop.ts', 'top.ts', 'node_modules/m/i.js']) write(tree, file, 'export {};\n');
  const normalise = (walked) =>
    JSON.stringify(Object.fromEntries(Object.entries(walked).map(([key, values]) => [key, values.map((value) => (path.isAbsolute(value) ? path.relative(tree, value) : value)).sort()])));
  const pairs = [
    ['nothing → a directory', { source: 'git', paths: [] }, { source: 'git', paths: ['a/b/'] }],
    ['nested → collapsed parent', { source: 'git', paths: ['a/b/c/'] }, { source: 'git', paths: ['a/'] }],
    ['plus single files', { source: 'git', paths: ['a/b/'] }, { source: 'git', paths: ['a/b/', 'k/drop.ts', 'top.ts'] }],
  ];
  for (const [label, looser, stricter] of pairs) {
    const narrowed = narrowWalk(tree, walkSourceFiles(tree, looser), stricter);
    check(`narrowWalk == fresh walk (${label})`, ignoresAtLeast(stricter, looser) && normalise(narrowed) === normalise(walkSourceFiles(tree, stricter)), `${normalise(narrowed)}\n   vs ${normalise(walkSourceFiles(tree, stricter))}`);
  }
  check('ignoring less is not treated as narrowing', !ignoresAtLeast({ source: 'git', paths: ['a/'] }, { source: 'git', paths: ['a/', 'k/'] }), 'accepted');
  check('a looser list that is a subdirectory of the old one is not narrowing', !ignoresAtLeast({ source: 'git', paths: ['a/b/'] }, { source: 'git', paths: ['a/'] }), 'accepted');
  fs.rmSync(tree, { recursive: true, force: true });

  // A directory git reports only because everything in it is currently ignored is not ignored itself:
  // a consumer added there later must be seen (stale cache and fresh scan alike).
  const collapsed = writeRepository();
  write(collapsed, '.gitignore', '.worktrees/\n.scratch/\n*.log\n');
  write(collapsed, 'stories/new/debug.log', 'x\n');
  let collapsedRun = analyse(collapsed);
  check('a directory holding only ignored files is not pruned', !collapsedRun.artifact.signature.ignore.paths.includes('stories/'), JSON.stringify(collapsedRun.artifact.signature.ignore.paths));
  write(collapsed, 'stories/new/compose.tsx', `import * as styles from '../../src/styles.css';\nimport { Button } from '../../src/Button';\nexport const C = () => <Button className={styles.solo} />;\n`);
  check('…so a consumer added there marks the cache stale', isSignatureStale(collapsedRun.artifact.signature, { rootDir: collapsed, tsconfigPath: 'tsconfig.json' }), 'not stale');
  collapsedRun = analyse(collapsed, collapsedRun.state);
  check('…and makes the class unproven', collapsedRun.artifact.unproven['src/styles.css.ts']?.solo === 'composed-with-component:Button', JSON.stringify(collapsedRun.artifact.unproven));

  // The root is a subdirectory: ignore rules above it (parent .gitignore) still decide what is pruned,
  // and un-ignoring through them must be noticed.
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'sprinkles-subroot-'));
  git(outer, 'init', '-q');
  write(outer, '.gitignore', 'app/gen/\n');
  const app = path.join(outer, 'app');
  write(outer, 'app/tsconfig.json', TSCONFIG);
  write(outer, 'app/package.json', JSON.stringify({ name: 'a', private: true, dependencies: { '@vanilla-extract/css': '^1' } }));
  write(outer, 'app/src/styles.css.ts', `import { style } from '@vanilla-extract/css';\nexport const solo = style({ minHeight: '100vh' });\n`);
  write(outer, 'app/src/Button.tsx', `export const Button = (props: { className?: string }) => <button {...props} />;\n`);
  write(outer, 'app/gen/compose.tsx', `import * as styles from '../src/styles.css';\nimport { Button } from '../src/Button';\nexport const G = () => <Button className={styles.solo} />;\n`);
  let subRun = analyse(app);
  check('a parent .gitignore prunes inside a subdirectory root', subRun.artifact.provenSoloClasses['src/styles.css.ts']?.includes('solo'), JSON.stringify(subRun.artifact.unproven));
  write(outer, '.gitignore', '\n');
  check('…and un-ignoring there marks the cache stale', isSignatureStale(subRun.artifact.signature, { rootDir: app, tsconfigPath: 'tsconfig.json' }), 'not stale');
  subRun = analyse(app, subRun.state);
  check('…and the consumer it uncovers counts', subRun.artifact.unproven['src/styles.css.ts']?.solo === 'composed-with-component:Button', JSON.stringify(subRun.artifact.unproven));

  // Global excludes (core.excludesFile) are an ignore source too.
  const globalIgnore = path.join(process.env.XDG_CONFIG_HOME, 'git', 'ignore');
  const globalRepo = writeRepository();
  write(globalRepo, 'extra/compose.tsx', `import * as styles from '../src/styles.css';\nimport { Button } from '../src/Button';\nexport const E = () => <Button className={styles.solo} />;\n`);
  write(path.dirname(globalIgnore), 'ignore', 'extra/\n');
  let globalRun = analyse(globalRepo);
  check('global excludes prune', globalRun.artifact.provenSoloClasses['src/styles.css.ts']?.includes('solo'), JSON.stringify(globalRun.artifact.unproven));
  write(path.dirname(globalIgnore), 'ignore', '\n');
  check('…and editing them marks the cache stale', isSignatureStale(globalRun.artifact.signature, { rootDir: globalRepo, tsconfigPath: 'tsconfig.json' }), 'not stale');
  globalRun = analyse(globalRepo, globalRun.state);
  check('…and the consumer it uncovers counts', globalRun.artifact.unproven['src/styles.css.ts']?.solo === 'composed-with-component:Button', JSON.stringify(globalRun.artifact.unproven));
  fs.rmSync(globalIgnore, { force: true });

  // core.excludesFile set in a file reached only through [include] is watched too.
  const includedConfig = path.join(isolatedHome, 'included.gitconfig');
  const includedIgnore = path.join(isolatedHome, 'included-ignore');
  write(isolatedHome, 'included-ignore', 'extra/\n');
  write(isolatedHome, 'included.gitconfig', `[core]\n\texcludesFile = ${includedIgnore}\n`);
  write(isolatedHome, '.gitconfig', `[include]\n\tpath = ${includedConfig}\n`);
  const includeRepo = writeRepository();
  write(includeRepo, 'extra/compose.tsx', `import * as styles from '../src/styles.css';\nimport { Button } from '../src/Button';\nexport const E = () => <Button className={styles.solo} />;\n`);
  let includeRun = analyse(includeRepo);
  check('excludesFile from an [include]d config prunes', includeRun.artifact.provenSoloClasses['src/styles.css.ts']?.includes('solo'), JSON.stringify(includeRun.artifact.unproven));
  write(isolatedHome, 'included.gitconfig', '[core]\n');
  check('…and editing the included config marks the cache stale', isSignatureStale(includeRun.artifact.signature, { rootDir: includeRepo, tsconfigPath: 'tsconfig.json' }), 'not stale');
  includeRun = analyse(includeRepo, includeRun.state);
  check('…and the consumer it uncovers counts', includeRun.artifact.unproven['src/styles.css.ts']?.solo === 'composed-with-component:Button', JSON.stringify(includeRun.artifact.unproven));
  write(isolatedHome, '.gitconfig', '');
  fs.rmSync(includeRepo, { recursive: true, force: true });

  // A tracked file inside an ignored directory (force-added) is part of the project.
  const forced = writeRepository();
  write(forced, '.worktrees/kept/compose.tsx', `import * as styles from '../../src/styles.css';\nimport { Button } from '../../src/Button';\nexport const K = () => <Button className={styles.solo} />;\n`);
  git(forced, 'add', '-f', '.worktrees/kept/compose.tsx');
  const forcedRun = analyse(forced).artifact;
  check('a force-added tracked file under an ignored directory is scanned', forcedRun.unproven['src/styles.css.ts']?.solo === 'composed-with-component:Button', JSON.stringify(forcedRun.unproven));

  // The root itself sits in an ignored part of an enclosing repository: prune nothing.
  const enclosing = fs.mkdtempSync(path.join(os.tmpdir(), 'sprinkles-enclosing-'));
  git(enclosing, 'init', '-q');
  write(enclosing, '.gitignore', '*\n');
  write(enclosing, 'project/tsconfig.json', TSCONFIG);
  write(enclosing, 'project/src/a.ts', `export const A = 1;\n`);
  const enclosed = analyse(path.join(enclosing, 'project')).artifact;
  check('a root that git ignores disables pruning entirely', enclosed.ignoreSource === 'none' && Object.keys(enclosed.signature.files).includes('src/a.ts'), `${enclosed.ignoreSource} ${JSON.stringify(Object.keys(enclosed.signature.files))}`);

  // Unusual names inside an ignored directory are pruned too (-z output).
  const odd = writeRepository();
  write(odd, '.worktrees/dir with space/한글 파일.tsx', `import { gone } from '@/removed';\nexport const O = gone;\n`);
  check('unusual file names in ignored directories are pruned', analyse(odd).artifact.unresolvedImports.length === 0, 'unresolved imports leaked in');

  for (const directory of [collapsed, outer, globalRepo, forced, enclosing, odd]) fs.rmSync(directory, { recursive: true, force: true });

  // Outside a git repository nothing is pruned.
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'sprinkles-nogit-'));
  write(plain, 'tsconfig.json', TSCONFIG);
  write(plain, '.worktrees/x.tsx', `export const X = 1;\n`);
  const unpruned = analyse(plain).artifact;
  check('outside git everything is read', unpruned.ignoreSource === 'none' && Object.keys(unpruned.signature.files).includes('.worktrees/x.tsx'), JSON.stringify(Object.keys(unpruned.signature.files)));

  for (const directory of [root, generated, hidden, plain, isolatedHome]) fs.rmSync(directory, { recursive: true, force: true });
  console.log(`\n${failed === 0 ? 'gitignore handling holds' : `${failed} check(s) failed`}`);
  process.exit(failed > 0 ? 1 : 0);
};

run();
