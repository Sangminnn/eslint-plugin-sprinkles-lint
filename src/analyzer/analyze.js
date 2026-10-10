/**
 * Usage-aware solo-class analyzer.
 *
 * Walks a project's import graph and, for every class exported from a *.css.ts file,
 * proves whether the class is only ever used standalone (`<div className={styles.x}>`).
 * Only proven-solo classes are safe to hoist into sprinkles() — the proof direction is
 * "solo usage proven → hoist", never "composition not detected → hoist".
 *
 * The invariant that keeps that direction honest: every reference to a css binding either
 * records a verdict or poisons its css module, and everything the analyzer cannot resolve
 * (an alias it cannot follow, a file it did not scan) is written into the artifact so the
 * rule can refuse it. Silence is never read as proof.
 *
 * vanilla-extract class names are build-time hashes, so every consumer must go through an
 * import: finishing the import graph yields the complete consumer list, and "no usage found"
 * genuinely means unused (safe).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const os = require('os');
const nodeModule = require('module');

const SOURCE_EXTENSION_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const DEFAULT_EXCLUDED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'coverage', 'storybook-static', '.git', '.next', '.turbo', '.yarn', '.pnpm-store']);

const loadTypescript = () => {
  try {
    return require('typescript');
  } catch (error) {
    throw new Error(
      'sprinkles-lint-analyze requires the "typescript" package (>=4.8) to be installed in the project (it parses your sources).',
    );
  }
};

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

const toPosix = (filePath) => filePath.split(path.sep).join('/');

const isCssModulePath = (filePath) => /\.css\.ts$/.test(filePath);

const globToRegExp = (glob) => {
  const DOUBLE_STAR_DIR = '\u0001';
  const DOUBLE_STAR = '\u0002';
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, DOUBLE_STAR_DIR)
    .replace(/\*\*/g, DOUBLE_STAR)
    .replace(/\*/g, '[^/]*')
    .replace(new RegExp(DOUBLE_STAR_DIR, 'g'), '(?:.*/)?')
    .replace(new RegExp(DOUBLE_STAR, 'g'), '.*');
  return new RegExp(`(^|/)${escaped}($|/)`);
};

// Extensions that cannot export a vanilla-extract class. A specifier ending in `.css` that TypeScript
// failed to resolve is a plain stylesheet: had a `<name>.css.ts` existed there, resolution would have
// found it (that substitution is what makes `@/styles/sprinkles.css` a graph edge).
const NON_MODULE_ASSET_PATTERN =
  /\.(css|scss|sass|less|styl|svg|png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp[34]|webm|wav|txt|md|json|ya?ml|graphql|gql)$/i;

// `@scope/name` or `name`, optionally with a subpath. `@/foo` (empty scope) and `~/foo` are not
// package names — they are build-tool aliases, so a resolution failure there is a real graph hole.
const SCOPED_PACKAGE_PATTERN = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*(\/.*)?$/i;
const UNSCOPED_PACKAGE_PATTERN = /^[a-z0-9][a-z0-9._-]*(\/.*)?$/i;

const isBuiltinSpecifier = (specifier) => specifier.startsWith('node:') || nodeModule.isBuiltin(specifier);
const isRelativeSpecifier = (specifier) => specifier.startsWith('./') || specifier.startsWith('../') || specifier === '.' || specifier === '..';
const isPackageSpecifier = (specifier) =>
  specifier.startsWith('@') ? SCOPED_PACKAGE_PATTERN.test(specifier) : UNSCOPED_PACKAGE_PATTERN.test(specifier);

/** Matcher for the tsconfig `paths` patterns, so a declared alias that fails to resolve stays a hole. */
const createTsconfigPathMatcher = (compilerOptions) => {
  const patterns = Object.keys(compilerOptions.paths || {}).map((pattern) => {
    const escaped = pattern.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`);
  });
  return (specifier) => patterns.some((pattern) => pattern.test(specifier));
};

const packageNameOf = (specifier) => {
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
};

/**
 * A package-shaped specifier is only external when the package is really there. Otherwise it is a
 * build-tool alias (an undeclared `@components/*`, or a `baseUrl`-relative import such as
 * `components/Foo`) that may point at project code, and dropping it would grant proof by silence.
 */
const createInstalledPackageChecker = (rootDir) => {
  const declared = new Set();
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const name of Object.keys(manifest[field] || {})) declared.add(name);
    }
  } catch (error) {
    // No manifest at the analysis root — fall back to node_modules lookups alone.
  }

  const cache = new Map();
  return (specifier, containingFile) => {
    const packageName = packageNameOf(specifier);
    if (declared.has(packageName)) return true;

    const cacheKey = `${path.dirname(containingFile)}\u0000${packageName}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    let found = false;
    let directory = path.dirname(containingFile);
    for (;;) {
      if (fs.existsSync(path.join(directory, 'node_modules', packageName))) {
        found = true;
        break;
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    cache.set(cacheKey, found);
    return found;
  };
};

/**
 * Why an unresolved specifier can be dropped from the graph without weakening the proof.
 * Returns null when it cannot — those are recorded and make the rule refuse the artifact.
 */
// Marker modules a framework supplies at build time without them being installed: Next.js aliases
// `server-only` and `client-only` to internal modules (next/dist/build/create-compiler-aliases.js).
// They are bare names that never resolve to project code.
const FRAMEWORK_PROVIDED_MODULES = new Set(['server-only', 'client-only']);

const ignoredImportReason = (specifier, containingFile, { matchesTsconfigPath, isInstalledPackage }) => {
  if (isBuiltinSpecifier(specifier)) return 'node-builtin';
  if (FRAMEWORK_PROVIDED_MODULES.has(specifier)) return 'framework-module';
  if (NON_MODULE_ASSET_PATTERN.test(specifier)) return 'non-module-asset';
  if (isRelativeSpecifier(specifier)) return null;
  if (matchesTsconfigPath(specifier)) return null;
  // Installed packages can fail resolution for reasons of their own (export conditions such as
  // `server-only`), and none of them can import this project's css modules.
  if (isPackageSpecifier(specifier) && isInstalledPackage(specifier, containingFile)) return 'external-package';
  return null;
};

const scriptKindFor = (ts, fileName) => {
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (/\.(ts|mts|cts)$/.test(fileName)) return ts.ScriptKind.TS;
  // Plain .js may legally contain JSX in most setups; parsing non-JSX .js as JSX is safe
  // because the generics-vs-JSX ambiguity only exists in TypeScript files.
  return ts.ScriptKind.JSX;
};

const NO_IGNORE = { source: 'none', paths: [], externalFiles: [] };

const runGit = (rootDir, args, input) => {
  const result = spawnSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30_000,
  });
  return { status: result.error ? null : result.status, stdout: result.stdout || '' };
};

/**
 * Files outside the scanned tree whose edits change what git ignores inside it: the .gitignore of
 * every directory between the repository top and the root, `info/exclude`, `core.excludesFile` and
 * the git config files that could point it elsewhere. Their mtimes join the change detection, so
 * un-ignoring something through any of them invalidates the cached list. Absent files are listed
 * too, so creating one is noticed.
 */
const listExternalIgnoreFiles = (rootDir) => {
  const revParse = runGit(rootDir, ['rev-parse', '--show-toplevel', '--git-path', 'info/exclude', '--git-path', 'config', '--git-common-dir']);
  if (revParse.status !== 0) return null;
  const [topLevel, infoExclude, worktreeConfig, commonDir] = revParse.stdout.split('\n');
  const files = [path.resolve(rootDir, infoExclude), path.resolve(rootDir, worktreeConfig), path.resolve(rootDir, commonDir, 'config')];

  // git reports the top level as a real path (/private/var/… on macOS), so walk up from the real root.
  let realRoot = rootDir;
  try {
    realRoot = fs.realpathSync(rootDir);
  } catch (error) {
    // keep the given path
  }
  for (let directory = path.dirname(realRoot); ; directory = path.dirname(directory)) {
    if (path.relative(topLevel, directory).startsWith('..')) break;
    files.push(path.join(directory, '.gitignore'));
    if (directory === topLevel || directory === path.dirname(directory)) break;
  }

  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  const excludesFile = runGit(rootDir, ['config', '--path', '--get', 'core.excludesFile']);
  files.push(excludesFile.status === 0 && excludesFile.stdout.trim() ? path.resolve(rootDir, excludesFile.stdout.trim()) : path.join(configHome, 'git', 'ignore'));
  files.push(process.env.GIT_CONFIG_GLOBAL || path.join(os.homedir(), '.gitconfig'), path.join(configHome, 'git', 'config'));

  // Every config file git actually read — including ones pulled in through [include]/[includeIf] —
  // since any of them can set core.excludesFile.
  const origins = runGit(rootDir, ['config', '--list', '--show-origin', '-z']);
  if (origins.status === 0) {
    for (const field of origins.stdout.split('\0')) {
      if (field.startsWith('file:')) files.push(path.resolve(rootDir, field.slice('file:'.length).split('\n')[0]));
    }
  }

  return [...new Set(files)].sort();
};

let gitListCount = 0;
const getGitListCount = () => gitListCount;

/**
 * Paths git ignores under the root (directories end with `/`). Ignored trees — git worktrees,
 * scratch copies, build output — are not part of the project: scanning them reads stale copies of
 * the sources, whose broken relative imports would refuse every proof.
 *
 * `--directory` also reports an untracked directory whose current contents all happen to be
 * ignored (only a `.DS_Store`, say) even though the directory itself matches no pattern; a source
 * added there later would not be ignored. Directory entries are therefore confirmed with
 * `git check-ignore` and only directories that are ignored in their own right are pruned.
 *
 * Without git, outside a repository, or when the root itself is ignored (a project inside an
 * ignored corner of some enclosing repository), nothing is pruned and the whole tree is read.
 */
const listGitIgnoredPaths = (rootDir) => {
  gitListCount += 1;
  const listing = runGit(rootDir, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory']);
  if (listing.status !== 0) return NO_IGNORE;
  const externalFiles = listExternalIgnoreFiles(rootDir);
  if (!externalFiles) return NO_IGNORE;

  const entries = listing.stdout.split('\0').filter(Boolean);
  const directoryEntries = entries.filter((entry) => entry.endsWith('/'));
  let confirmedDirectories = [];
  if (directoryEntries.length > 0) {
    // exit 0: some paths ignored, 1: none ignored; anything else is an error.
    const confirmation = runGit(rootDir, ['check-ignore', '-z', '--stdin'], `${directoryEntries.join('\0')}\0`);
    if (confirmation.status !== 0 && confirmation.status !== 1) return NO_IGNORE;
    confirmedDirectories = confirmation.stdout.split('\0').filter(Boolean);
  }
  if (confirmedDirectories.includes('./') || confirmedDirectories.includes('.')) return NO_IGNORE;

  const ignoredFiles = entries.filter((entry) => !entry.endsWith('/'));
  return { source: 'git', paths: [...confirmedDirectories, ...ignoredFiles].sort(), externalFiles };
};

/**
 * Source files under a root, minus the build directories the analyzer never reads and anything git
 * ignores. Also returns the package.json files (they steer module resolution without being sources)
 * and the .gitignore files (they decide what is pruned), both for change detection.
 */
let walkCount = 0;
const getWalkCount = () => walkCount;

const walkSourceFiles = (rootDir, ignore = NO_IGNORE) => {
  walkCount += 1;
  const ignoredPaths = new Set(ignore.paths);
  const files = [];
  const manifests = [];
  const treeIgnoreFiles = [];
  const skippedDirectories = [];
  // Every directory descended into, so a walk can later be narrowed to a stricter ignore list
  // without walking again (see narrowWalk).
  const visitedDirectories = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = toPosix(path.relative(rootDir, fullPath));
      if (entry.isDirectory()) {
        if (DEFAULT_EXCLUDED_DIRECTORIES.has(entry.name) || ignoredPaths.has(`${relativePath}/`)) skippedDirectories.push(relativePath);
        else {
          visitedDirectories.push(relativePath);
          walk(fullPath);
        }
        continue;
      }
      if (entry.name === '.gitignore') treeIgnoreFiles.push(fullPath);
      if (ignoredPaths.has(relativePath)) continue;
      if (SOURCE_EXTENSION_PATTERN.test(entry.name)) files.push(fullPath);
      else if (entry.name === 'package.json') manifests.push(fullPath);
    }
  };
  walk(rootDir);
  const externalFiles = ignore.externalFiles || [];
  return { files, manifests, treeIgnoreFiles, ignoreFiles: [...treeIgnoreFiles, ...externalFiles], skippedDirectories, visitedDirectories };
};

/** True when `relativePath`, or a directory above it, is in the ignore list. */
const isCoveredByIgnore = (relativePath, ignoredPaths) => {
  if (ignoredPaths.has(relativePath)) return true;
  for (let index = relativePath.indexOf('/'); index !== -1; index = relativePath.indexOf('/', index + 1)) {
    if (ignoredPaths.has(relativePath.slice(0, index + 1))) return true;
  }
  return ignoredPaths.has(`${relativePath}/`);
};

/** Whether `next` ignores at least everything `previous` did, so a walk under `previous` saw a superset. */
const ignoresAtLeast = (next, previous) => {
  if (next.source !== previous.source) return false;
  const nextPaths = new Set(next.paths);
  // Entries inside build directories (node_modules/, dist/…) are skipped by the walk regardless.
  const insideBuildDirectory = (ignoredPath) => ignoredPath.split('/').some((segment) => DEFAULT_EXCLUDED_DIRECTORIES.has(segment));
  return previous.paths.every((ignoredPath) => insideBuildDirectory(ignoredPath) || isCoveredByIgnore(ignoredPath.replace(/\/$/, ''), nextPaths));
};

/**
 * The walk `walkSourceFiles(rootDir, next)` would produce, derived from a walk done under a
 * looser ignore list instead of reading the tree again. Only valid when `ignoresAtLeast(next,
 * previous)`: then everything the fresh walk would visit was visited before.
 */
const narrowWalk = (rootDir, walked, next) => {
  const ignoredPaths = new Set(next.paths);
  const parentOf = (relativePath) => (relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : '');

  // Directories still descended into: visited before, and neither they nor an ancestor now ignored.
  const visited = new Set(['']);
  for (const directory of walked.visitedDirectories) {
    if (visited.has(parentOf(directory)) && !ignoredPaths.has(`${directory}/`)) visited.add(directory);
  }
  const isListedChild = (relativePath) => visited.has(parentOf(relativePath));

  const skippedDirectories = [
    ...walked.skippedDirectories.filter(isListedChild),
    ...walked.visitedDirectories.filter((directory) => isListedChild(directory) && !visited.has(directory)),
  ];
  const keepFile = (filePath) => {
    const relativePath = toPosix(path.relative(rootDir, filePath));
    return isListedChild(relativePath) && !ignoredPaths.has(relativePath);
  };
  const treeIgnoreFiles = walked.treeIgnoreFiles.filter((filePath) => isListedChild(toPosix(path.relative(rootDir, filePath))));

  return {
    files: walked.files.filter(keepFile),
    manifests: walked.manifests.filter(keepFile),
    treeIgnoreFiles,
    ignoreFiles: [...treeIgnoreFiles, ...(next.externalFiles || [])],
    skippedDirectories,
    visitedDirectories: walked.visitedDirectories.filter((directory) => visited.has(directory)),
  };
};

const mtimesByRelativePath = (rootDir, filePaths) => {
  const mtimes = {};
  for (const filePath of filePaths) mtimes[toPosix(path.relative(rootDir, filePath))] = fs.existsSync(filePath) ? fs.statSync(filePath).mtimeMs : null;
  return mtimes;
};

/** Every config file that contributes to one tsconfig, so an alias change in a shared base is seen. */
const collectTsconfigChain = (tsconfigPath, seen = new Set()) => {
  const resolved = path.resolve(tsconfigPath);
  if (seen.has(resolved) || !fs.existsSync(resolved)) return [...seen];
  seen.add(resolved);

  try {
    const ts = require('typescript');
    const configFile = ts.readConfigFile(resolved, ts.sys.readFile);
    const extendsField = configFile.config && configFile.config.extends;
    const parents = Array.isArray(extendsField) ? extendsField : extendsField ? [extendsField] : [];
    for (const parent of parents) {
      const parentPath = parent.startsWith('.')
        ? path.resolve(path.dirname(resolved), parent)
        : path.resolve(path.dirname(resolved), 'node_modules', parent);
      const withExtension = /\.json$/.test(parentPath) ? parentPath : `${parentPath}.json`;
      collectTsconfigChain(withExtension, seen);
    }
  } catch (error) {
    // A config we cannot read simply contributes no extra mtime to watch.
  }

  return [...seen];
};

const mtimeOf = (filePath) => {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch (error) {
    return null;
  }
};

/**
 * The cheap half of a scan: which files exist and when they last changed. Used to decide whether a
 * cached set of verdicts is still describing the project — a full scan reads and parses every file,
 * this only walks and stats (single-digit milliseconds on a few thousand files).
 */
const collectSignature = ({ rootDir, tsconfigPath, exclude = [], ignore = NO_IGNORE }) => {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedTsconfig = path.resolve(resolvedRoot, tsconfigPath || 'tsconfig.json');
  const excludeRegexps = exclude.map(globToRegExp);
  const files = {};
  const walked = walkSourceFiles(resolvedRoot, ignore);

  for (const fileName of walked.files) {
    const relativePath = toPosix(path.relative(resolvedRoot, fileName));
    if (excludeRegexps.some((pattern) => pattern.test(relativePath))) continue;
    files[relativePath] = mtimeOf(fileName);
  }

  const manifests = {};
  for (const manifestPath of walked.manifests) manifests[toPosix(path.relative(resolvedRoot, manifestPath))] = mtimeOf(manifestPath);

  const tsconfigFiles = {};
  for (const configPath of collectTsconfigChain(resolvedTsconfig)) tsconfigFiles[configPath] = mtimeOf(configPath);

  return { root: resolvedRoot, tsconfigFiles, files, manifests, ignore, ignoreFiles: mtimesByRelativePath(resolvedRoot, walked.ignoreFiles) };
};

/** True when the project no longer matches the signature a cached scan was built from. */
const isSignatureStale = (signature, { rootDir, tsconfigPath, exclude = [] }) => {
  if (!signature) return true;

  // Swept with the ignore list the scan used, so the sweep never has to ask git.
  const current = collectSignature({ rootDir, tsconfigPath, exclude, ignore: signature.ignore || NO_IGNORE });

  // An edited .gitignore can bring files into the project or drop them from it.
  const cachedIgnoreFiles = signature.ignoreFiles || {};
  if (Object.keys(cachedIgnoreFiles).length !== Object.keys(current.ignoreFiles).length) return true;
  for (const [relativePath, mtimeMs] of Object.entries(current.ignoreFiles)) {
    if (cachedIgnoreFiles[relativePath] !== mtimeMs) return true;
  }

  const cachedConfigs = signature.tsconfigFiles || {};
  const currentConfigs = current.tsconfigFiles || {};
  if (Object.keys(cachedConfigs).length !== Object.keys(currentConfigs).length) return true;
  for (const [configPath, mtimeMs] of Object.entries(currentConfigs)) {
    if (cachedConfigs[configPath] !== mtimeMs) return true;
  }

  // A package.json edit can re-route imports while every source stays byte-identical.
  const cachedManifests = signature.manifests || {};
  const currentManifests = current.manifests || {};
  if (Object.keys(cachedManifests).length !== Object.keys(currentManifests).length) return true;
  for (const [relativePath, mtimeMs] of Object.entries(currentManifests)) {
    if (cachedManifests[relativePath] !== mtimeMs) return true;
  }

  for (const [relativePath, mtimeMs] of Object.entries(current.files)) {
    if (signature.files[relativePath] !== mtimeMs) return true; // added or modified
  }
  for (const [relativePath, mtimeMs] of Object.entries(signature.files)) {
    // The walk skips build directories and stops at the root, but tsconfig `include` can reach both
    // (`.next/types/**` is in every Next.js config). Absence from the walk is therefore not proof of
    // removal — those entries are checked against disk directly.
    if (current.files[relativePath] === undefined) {
      if (mtimeOf(path.resolve(current.root, relativePath)) !== mtimeMs) return true;
    }
  }

  return false;
};

let tsconfigParseCount = 0;
const getTsconfigParseCount = () => tsconfigParseCount;

/** The tsconfig's compiler options and file set (`include` expanded). */
const parseTsconfigFileSet = (ts, tsconfigPath, tsconfigWasExplicit) => {
  if (!fs.existsSync(tsconfigPath)) {
    if (tsconfigWasExplicit) throw new Error(`tsconfig not found: ${tsconfigPath}`);
    return { compilerOptions: {}, fileNames: [], loaded: false };
  }
  tsconfigParseCount += 1;
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(`Failed to read ${tsconfigPath}: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, ' ')}`);
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(tsconfigPath));
  return { compilerOptions: parsed.options, fileNames: parsed.fileNames.map((fileName) => path.resolve(fileName)), loaded: true };
};

/**
 * The files to analyse: the tsconfig file set plus the walk. The tsconfig file set alone is not
 * enough — a consumer outside `include` would silently vanish and its compositions would look like
 * proof — so the walk (dot-directories such as .storybook included, git-ignored paths excluded)
 * always contributes too.
 */
const assembleSourceFiles = (rootDir, tsconfigFileSet, walked, excludePatterns) => {
  const excludeRegexps = excludePatterns.map(globToRegExp);
  const fileNames = new Set([...tsconfigFileSet.fileNames, ...walked.files]);

  const excluded = [];
  const files = [];
  for (const fileName of fileNames) {
    const relativePath = toPosix(path.relative(rootDir, fileName));
    if (excludeRegexps.some((pattern) => pattern.test(relativePath))) excluded.push(relativePath);
    else files.push(fileName);
  }

  return {
    files,
    compilerOptions: tsconfigFileSet.compilerOptions,
    excluded: excluded.sort(),
    skippedDirectories: [...walked.skippedDirectories].sort(),
    tsconfigLoaded: tsconfigFileSet.loaded,
    walked,
  };
};

/**
 * Named exports of a css module: `export const x = …` and local `export { a, b }`.
 * `export { a as b }` makes two names for one declaration — they form one alias group,
 * because a verdict under either name is a verdict about the same class.
 */
const collectCssExports = (ts, sourceFile) => {
  const names = new Set();
  const groupOf = new Map(); // any name → canonical (local) name
  for (const statement of sourceFile.statements) {
    const isExported = ts.canHaveModifiers(statement) && (ts.getModifiers(statement) || []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isVariableStatement(statement) && isExported) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      }
    }
    if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        names.add(element.name.text);
        const localName = (element.propertyName || element.name).text;
        groupOf.set(element.name.text, localName);
        groupOf.set(localName, localName);
      }
    }
  }
  const canonical = (name) => groupOf.get(name) || name;
  return { names, canonical, groups: [...groupOf] };
};

const UNPROVEN = (reason) => ({ safe: false, reason });
const SAFE = { safe: true };

/** Classify one reference whose value is a css class (identifier or styles.x access). */
const classifyValueUsage = (ts, valueNode) => {
  const parent = valueNode.parent;
  if (!parent) return UNPROVEN('unrecognized-usage:no-parent');

  if (ts.isJsxExpression(parent) && parent.expression === valueNode) {
    const attribute = parent.parent;
    if (attribute && ts.isJsxAttribute(attribute)) {
      const attributeName = attribute.name.getText();
      const opening = attribute.parent.parent;
      const tagName =
        opening && (ts.isJsxOpeningElement(opening) || ts.isJsxSelfClosingElement(opening)) ? opening.tagName.getText() : null;

      if (attributeName !== 'className') return UNPROVEN(`non-className-prop:${attributeName}`);
      if (!tagName) return UNPROVEN('unrecognized-jsx-shape');
      const isIntrinsicTag = /^[a-z]/.test(tagName) && !tagName.includes('.');
      return isIntrinsicTag ? SAFE : UNPROVEN(`composed-with-component:${tagName}`);
    }
    return UNPROVEN('unrecognized-jsx-shape');
  }

  if (ts.isCallExpression(parent)) return UNPROVEN(`composed-in-call:${parent.expression.getText()}`);
  if (ts.isConditionalExpression(parent) || ts.isBinaryExpression(parent)) return UNPROVEN('conditional-composition');
  if (ts.isTemplateSpan(parent)) return UNPROVEN('composed-in-template');
  if (ts.isVariableDeclaration(parent)) return UNPROVEN('aliased-to-variable');
  if (ts.isPropertyAssignment(parent) || ts.isShorthandPropertyAssignment(parent) || ts.isSpreadAssignment(parent))
    return UNPROVEN('object-literal');
  if (ts.isArrayLiteralExpression(parent)) return UNPROVEN('composed-in-array');
  // styles.x.y, styles.x[…], styleVariants member access, .toString(), …
  if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === valueNode)
    return UNPROVEN('property-access-chain');
  return UNPROVEN(`unrecognized-usage:${ts.SyntaxKind[parent.kind]}`);
};

// Counts full scans so tests can prove the rule's cache is actually being hit, and files actually
// re-read so tests can prove an incremental scan only touched what changed.
let scanCount = 0;
let extractCount = 0;
const getScanCount = () => scanCount;
const getExtractCount = () => extractCount;

const PLUGIN_VERSION = (() => {
  try {
    return require('../../package.json').version;
  } catch (error) {
    return 'unknown';
  }
})();

// Bump whenever the shape or meaning of extracted facts changes, so reused facts are never misread.
const FACTS_FORMAT = 2;

// The analyzer's own source is part of the cache key: a plugin linked or installed from a path can
// change without its version changing, and facts from a different extractor must not be reused.
const ANALYZER_SOURCE_HASH = (() => {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
  } catch (error) {
    return 'unknown';
  }
})();

// A file whose mtime falls this close to the moment it was read may be written again within the
// same clock tick (1–2 s granularity on HFS+, ext3, FAT, many network mounts) without its mtime or
// size changing. Such entries are never reused — the "racy git" rule.
const RACY_WINDOW_MS = 2_000;

const enclosingClauseOf = (ts, node) => {
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    if (ts.isImportDeclaration(ancestor)) return 'import';
    if (ts.isExportDeclaration(ancestor)) return ancestor.moduleSpecifier ? 'export-from' : 'export-local';
  }
  return null;
};

const isMemberNameOf = (ts, node) => {
  const parent = node.parent;
  return Boolean(
    parent &&
      ((ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isJsxAttribute && ts.isJsxAttribute(parent) && parent.name === node)),
  );
};

/**
 * Everything the analysis needs from one file, read off its syntax alone. Nothing here depends on
 * how imports resolve or on any other file — that is what lets an unchanged file's facts be reused
 * while the graph around it changes. Uses are recorded for every imported binding; whether a binding
 * is a css class is only decided when the graph is linked.
 */
const extractFileFacts = (ts, fileName, sourceFile) => {
  extractCount += 1;
  const isCss = isCssModulePath(fileName);
  const facts = { isCss, cssExports: null, intraRefs: [], reexports: [], imports: [], dynamicSpecifiers: [], namespaceUses: [], namedUses: [] };

  if (isCss) {
    const { names, groups } = collectCssExports(ts, sourceFile);
    facts.cssExports = { names: [...names], groups };

    // `export const card = style([base, …])` composes `base` with more rules; hoisting base's
    // override would move it relative to every class composed on top of it.
    const visitCss = (node) => {
      if (ts.isIdentifier(node) && names.has(node.text)) {
        const parent = node.parent;
        const isOwnDeclarationName = parent && ts.isVariableDeclaration(parent) && parent.name === node;
        const isExportClauseName = enclosingClauseOf(ts, node) !== null;
        if (!isOwnDeclarationName && !isMemberNameOf(ts, node) && !isExportClauseName) facts.intraRefs.push(node.text);
      }
      ts.forEachChild(node, visitCss);
    };
    visitCss(sourceFile);
  }

  const namespaceNames = new Set();
  const namedNames = new Set();

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text;
      const clause = statement.exportClause;
      if (clause && ts.isNamedExports(clause)) {
        facts.reexports.push({ specifier, kind: 'named', elements: clause.elements.map((element) => [element.name.text, (element.propertyName || element.name).text]) });
      } else if (clause && ts.isNamespaceExport(clause)) {
        facts.reexports.push({ specifier, kind: 'namespace' });
      } else {
        facts.reexports.push({ specifier, kind: 'star' });
      }
    }

    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      const entry = { specifier: statement.moduleSpecifier.text, namespace: null, named: [], hasDefault: false };
      if (clause) {
        if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
          entry.namespace = clause.namedBindings.name.text;
          namespaceNames.add(entry.namespace);
        }
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            entry.named.push([element.name.text, (element.propertyName || element.name).text]);
            namedNames.add(element.name.text);
          }
        }
        entry.hasDefault = Boolean(clause.name);
      }
      facts.imports.push(entry);
    }
  }

  const namespaceUses = new Map();
  const namedUses = new Map();
  const pushUse = (uses, name, use) => {
    if (!uses.has(name)) uses.set(name, []);
    uses.get(name).push(use);
  };

  const visit = (node) => {
    // require('./x.css'), await import('./x.css'), import x = require('./x.css'):
    // bindings created this way are not tracked, so anything css-reachable gets poisoned at link time.
    if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
      const callee = node.expression;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      if (isRequire || isDynamicImport) facts.dynamicSpecifiers.push(node.arguments[0].text);
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) {
      facts.dynamicSpecifiers.push(node.moduleReference.expression.text);
    }

    if (ts.isIdentifier(node) && (namespaceNames.has(node.text) || namedNames.has(node.text))) {
      const name = node.text;
      const enclosing = enclosingClauseOf(ts, node);
      const skip = enclosing === 'import' || enclosing === 'export-from';

      if (!skip && namespaceNames.has(name)) {
        const parent = node.parent;
        if (enclosing === 'export-local') {
          pushUse(namespaceUses, name, { poison: 'namespace-reexported' });
        } else if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === node) {
          pushUse(namespaceUses, name, { member: parent.name.text, verdict: classifyValueUsage(ts, parent) });
        } else if (parent && ts.isElementAccessExpression(parent) && parent.expression === node) {
          pushUse(namespaceUses, name, { poison: 'dynamic-access' });
        } else {
          pushUse(namespaceUses, name, { poison: 'namespace-escapes' });
        }
      }

      if (!skip && namedNames.has(name) && !isMemberNameOf(ts, node)) {
        pushUse(namedUses, name, enclosing === 'export-local' ? UNPROVEN('reexported-locally') : classifyValueUsage(ts, node));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  // Entries rather than objects: an imported binding may legitimately be named `constructor`.
  facts.namespaceUses = [...namespaceUses];
  facts.namedUses = [...namedUses];
  return facts;
};

/**
 * Joins per-file facts into the import graph and turns uses into verdicts. Pure apart from module
 * resolution, which goes through `resolveSpecifier` so a caller can memoise it.
 */
const linkProject = ({ resolvedRoot, factsByFile, resolveSpecifier, matchesTsconfigPath, isInstalledPackage }) => {
  const relative = (fileName) => toPosix(path.relative(resolvedRoot, fileName));

  const cssModules = new Map(); // cssFile → { names, canonical }
  for (const [fileName, facts] of factsByFile) {
    if (!facts.isCss) continue;
    const groupOf = new Map(facts.cssExports.groups);
    cssModules.set(fileName, { names: new Set(facts.cssExports.names), canonical: (name) => groupOf.get(name) || name });
  }

  const usagesByExport = new Map(); // cssFile → exportName → [{ safe, reason }]
  const filePoison = new Map(); // cssFile → reason applying to every export
  const unresolvedImports = [];
  const unscannedImports = [];
  const ignoredImports = [];

  const poisonFile = (cssFile, reason) => {
    if (!filePoison.has(cssFile)) filePoison.set(cssFile, reason);
  };

  /** Resolve a specifier for graph purposes; report every unresolved or unscanned edge. */
  const resolveForGraph = (specifier, containingFile) => {
    const { target, external } = resolveSpecifier(specifier, containingFile);
    if (external) return null;
    if (!target) {
      // A miss is only harmless when the specifier provably cannot reach a css module; anything else
      // may be an alias hiding one (or a barrel leading to one), so it is recorded and the rule
      // refuses the artifact.
      const ignoredReason = ignoredImportReason(specifier, containingFile, { matchesTsconfigPath, isInstalledPackage });
      if (ignoredReason) ignoredImports.push({ file: relative(containingFile), specifier, reason: ignoredReason });
      else unresolvedImports.push({ file: relative(containingFile), specifier });
      return null;
    }
    if (!factsByFile.has(target)) {
      if (SOURCE_EXTENSION_PATTERN.test(target)) unscannedImports.push({ file: relative(containingFile), specifier, resolved: relative(target) });
      return null;
    }
    return target;
  };

  // ---- Re-export graph -------------------------------------------------------------------

  const reexports = new Map(); // moduleFile → { named: Map(exported → { moduleFile, exportedName }), stars: [moduleFile] }
  const reexportEntry = (moduleFile) => {
    if (!reexports.has(moduleFile)) reexports.set(moduleFile, { named: new Map(), stars: [] });
    return reexports.get(moduleFile);
  };

  const poisonReachableCss = (moduleFile, reason, seen = new Set()) => {
    if (!moduleFile || seen.has(moduleFile)) return;
    seen.add(moduleFile);
    if (cssModules.has(moduleFile)) poisonFile(moduleFile, reason);
    const entry = reexports.get(moduleFile);
    if (!entry) return;
    for (const target of entry.named.values()) poisonReachableCss(target.moduleFile, reason, seen);
    for (const target of entry.stars) poisonReachableCss(target, reason, seen);
  };

  // Silence must never read as proof: a verdict for a name the module does not export means the
  // graph model is wrong somewhere, so everything reachable from that module gets poisoned.
  const recordUsage = (cssFile, exportName, verdict) => {
    const exports = cssModules.get(cssFile);
    if (!exports || !exports.names.has(exportName)) {
      poisonReachableCss(cssFile, `unknown-export:${exportName}`);
      return;
    }
    const canonicalName = exports.canonical(exportName);
    if (!usagesByExport.has(cssFile)) usagesByExport.set(cssFile, new Map());
    const byName = usagesByExport.get(cssFile);
    if (!byName.has(canonicalName)) byName.set(canonicalName, []);
    byName.get(canonicalName).push(verdict);
  };

  const namespaceReexportTargets = [];
  for (const [fileName, facts] of factsByFile) {
    for (const reexport of facts.reexports) {
      const target = resolveForGraph(reexport.specifier, fileName);
      if (!target) continue;
      const entry = reexportEntry(fileName);
      if (reexport.kind === 'named') {
        for (const [exportedName, importedName] of reexport.elements) entry.named.set(exportedName, { moduleFile: target, exportedName: importedName });
      } else if (reexport.kind === 'namespace') {
        // `export * as ns from './x.css'` lets the namespace object escape untracked.
        namespaceReexportTargets.push(target);
      } else {
        entry.stars.push(target);
      }
    }
  }

  for (const target of namespaceReexportTargets) poisonReachableCss(target, 'namespace-reexport');

  /** Follow re-exports to the css export, or 'unresolved' when the chain cannot be pinned to exactly one. */
  const resolveThroughReexports = (moduleFile, exportedName, seen = new Set()) => {
    if (cssModules.has(moduleFile) && cssModules.get(moduleFile).names.has(exportedName)) {
      return { cssFile: moduleFile, cssExport: exportedName };
    }
    if (seen.has(moduleFile)) return 'unresolved';
    seen.add(moduleFile);

    const entry = reexports.get(moduleFile);
    // A module (css or not) that neither exports the name directly nor re-exports anything simply
    // is not the origin of this name — that is a clean miss, not a resolution failure.
    if (!entry) return null;

    const named = entry.named.get(exportedName);
    if (named) return resolveThroughReexports(named.moduleFile, named.exportedName, seen);

    const hits = [];
    for (const star of entry.stars) {
      const resolved = resolveThroughReexports(star, exportedName, new Set(seen));
      if (resolved === 'unresolved') return 'unresolved';
      if (resolved) hits.push(resolved);
    }
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return 'unresolved';
    return null;
  };

  // ---- Intra-file references inside each css module --------------------------------------

  for (const [cssFile, facts] of factsByFile) {
    if (!facts.isCss) continue;
    for (const name of facts.intraRefs) recordUsage(cssFile, name, UNPROVEN('referenced-within-css-file'));
  }

  // ---- Consumer scan ----------------------------------------------------------------------

  for (const [fileName, facts] of factsByFile) {
    const namespaceBindings = new Map(); // localName → cssFile
    const namedBindings = new Map(); // localName → { cssFile, cssExport }

    for (const entry of facts.imports) {
      const target = resolveForGraph(entry.specifier, fileName);
      if (!target) continue;

      if (entry.namespace) {
        if (cssModules.has(target) && !reexports.has(target)) namespaceBindings.set(entry.namespace, target);
        else poisonReachableCss(target, 'namespace-import-of-reexporter');
      }
      for (const [localName, importedName] of entry.named) {
        const resolved = resolveThroughReexports(target, importedName);
        if (resolved && resolved !== 'unresolved') namedBindings.set(localName, resolved);
        else if (resolved === 'unresolved') poisonReachableCss(target, 'reexport-unresolved');
        // resolved === null: the name does not come from any css module (plain shared module) — no css to protect.
      }
      if (entry.hasDefault) poisonReachableCss(target, 'default-import');
    }

    for (const specifier of facts.dynamicSpecifiers) {
      poisonReachableCss(resolveForGraph(specifier, fileName), 'commonjs-or-dynamic-import');
    }

    for (const [localName, uses] of facts.namespaceUses) {
      const cssFile = namespaceBindings.get(localName);
      if (!cssFile) continue;
      for (const use of uses) {
        if (use.poison) poisonFile(cssFile, use.poison);
        else recordUsage(cssFile, use.member, use.verdict);
      }
    }

    for (const [localName, verdicts] of facts.namedUses) {
      const binding = namedBindings.get(localName);
      if (!binding) continue;
      for (const verdict of verdicts) recordUsage(binding.cssFile, binding.cssExport, verdict);
    }
  }

  // ---- Aggregate --------------------------------------------------------------------------

  const provenSoloClasses = {};
  const unproven = {};

  for (const [cssFile, cssExports] of cssModules) {
    const relativePath = relative(cssFile);
    const poison = filePoison.get(cssFile);
    const byName = usagesByExport.get(cssFile) || new Map();

    for (const exportName of cssExports.names) {
      const verdicts = byName.get(cssExports.canonical(exportName)) || [];
      const firstUnproven = poison ? { reason: poison } : verdicts.find((verdict) => !verdict.safe);

      if (firstUnproven) {
        if (!unproven[relativePath]) unproven[relativePath] = {};
        unproven[relativePath][exportName] = firstUnproven.reason;
      } else {
        if (!provenSoloClasses[relativePath]) provenSoloClasses[relativePath] = [];
        provenSoloClasses[relativePath].push(exportName);
      }
    }
    if (provenSoloClasses[relativePath]) provenSoloClasses[relativePath].sort();
  }

  return { provenSoloClasses, unproven, unresolvedImports, unscannedImports, ignoredImports };
};

/**
 * Analyses the project, reusing the facts of files whose mtime and size are unchanged since
 * `previousState`. Facts are syntax only, so they never go stale through other files. Import
 * resolution is deliberately *not* carried over: it also depends on things outside the scanned
 * sources — nested package.json `types`/`exports`, symlink targets, node_modules — and re-resolving
 * from the stored facts is cheap. Anything that could change how every file is read (compiler
 * options, plugin, analyzer or TypeScript version, exclusions, the root package.json) discards the
 * previous state entirely.
 *
 * @returns {{ artifact: object, state: object }}
 */
const analyzeProjectIncremental = ({ rootDir = process.cwd(), tsconfigPath, exclude = [], collectFileHashes = true } = {}, previousState = null) => {
  scanCount += 1;
  const scanStartedAt = Date.now();
  const ts = loadTypescript();
  const resolvedRoot = path.resolve(rootDir);
  const tsconfigWasExplicit = Boolean(tsconfigPath);
  const resolvedTsconfig = path.resolve(resolvedRoot, tsconfigPath || 'tsconfig.json');

  const walkKeyOf = (walked) =>
    sha256(
      JSON.stringify({
        paths: [...walked.files, ...walked.manifests].map((filePath) => toPosix(path.relative(resolvedRoot, filePath))).sort(),
        ignoreFiles: mtimesByRelativePath(resolvedRoot, walked.ignoreFiles),
      }),
    );

  // Reuse the previous ignore list while the walked file set and the ignore files are unchanged
  // (edits only). Otherwise — a new file, a new directory, an edited .gitignore — ask git again,
  // and walk again only if the new list ignores less than the old one: when it ignores at least as
  // much, the walk already done saw everything a fresh walk would, and is narrowed instead.
  let ignore = previousState && previousState.ignore ? previousState.ignore : null;
  let walked = ignore ? walkSourceFiles(resolvedRoot, ignore) : null;
  const ignoreReused = Boolean(walked) && walkKeyOf(walked) === previousState.walkKey;
  if (!ignoreReused) {
    const freshIgnore = listGitIgnoredPaths(resolvedRoot);
    walked = walked && ignoresAtLeast(freshIgnore, ignore) ? narrowWalk(resolvedRoot, walked, freshIgnore) : walkSourceFiles(resolvedRoot, freshIgnore);
    ignore = freshIgnore;
  }
  const walkKey = walkKeyOf(walked);
  const collected = assembleSourceFiles(resolvedRoot, parseTsconfigFileSet(ts, resolvedTsconfig, tsconfigWasExplicit), walked, exclude);
  const { files, compilerOptions, excluded, skippedDirectories, tsconfigLoaded } = collected;
  const relative = (fileName) => toPosix(path.relative(resolvedRoot, fileName));

  const configKey = sha256(
    JSON.stringify({
      factsFormat: FACTS_FORMAT,
      plugin: PLUGIN_VERSION,
      analyzer: ANALYZER_SOURCE_HASH,
      typescript: ts.version,
      root: resolvedRoot,
      compilerOptions,
      exclude,
      packageJsonMtimeMs: mtimeOf(path.join(resolvedRoot, 'package.json')),
    }),
  );
  // Content hashes need every file's text, so a hashing run never reuses facts.
  const reusable = previousState && previousState.configKey === configKey && !collectFileHashes ? previousState : null;

  const factsByFile = new Map();
  const fileEntries = {};
  let extractedFiles = 0;
  const signatureFiles = {};
  const inputs = {};

  for (const fileName of files) {
    const relativePath = relative(fileName);
    // Stat before reading: a write landing between the two then leaves a newer mtime than the facts
    // describe, which forces a re-read next time instead of pinning stale facts forever.
    const stats = fs.statSync(fileName);
    signatureFiles[relativePath] = stats.mtimeMs;

    const cached = reusable && reusable.files[relativePath];
    if (cached && !cached.racy && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      factsByFile.set(fileName, cached.facts);
      fileEntries[relativePath] = cached;
      continue;
    }

    const text = fs.readFileSync(fileName, 'utf8');
    if (collectFileHashes) inputs[relativePath] = sha256(text);
    const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKindFor(ts, fileName));
    const facts = extractFileFacts(ts, fileName, sourceFile);
    factsByFile.set(fileName, facts);
    extractedFiles += 1;
    const racy = stats.mtimeMs >= scanStartedAt - RACY_WINDOW_MS;
    fileEntries[relativePath] = { mtimeMs: stats.mtimeMs, size: stats.size, racy, facts };
  }

  // Memoised for this scan only (see the doc comment for why it is never carried over). The key is
  // the containing directory because `resolveModuleName` is called without a resolution mode; if a
  // mode is ever passed, it has to become part of the key.
  const resolutions = new Map();
  const moduleResolutionCache = ts.createModuleResolutionCache(resolvedRoot, (fileName) => fileName, compilerOptions);

  const resolveSpecifier = (specifier, containingFile) => {
    const key = `${path.dirname(containingFile)}\u0000${specifier}`;
    if (resolutions.has(key)) return resolutions.get(key);
    const resolved = ts.resolveModuleName(specifier, containingFile, compilerOptions, ts.sys, moduleResolutionCache);
    let result = { target: null, external: false };
    if (resolved.resolvedModule) {
      const target = path.resolve(resolved.resolvedModule.resolvedFileName);
      result = { target, external: Boolean(resolved.resolvedModule.isExternalLibraryImport) || target.includes(`${path.sep}node_modules${path.sep}`) };
    }
    resolutions.set(key, result);
    return result;
  };

  const linked = linkProject({
    resolvedRoot,
    factsByFile,
    resolveSpecifier,
    matchesTsconfigPath: createTsconfigPathMatcher(compilerOptions),
    isInstalledPackage: createInstalledPackageChecker(resolvedRoot),
  });

  // Content hashes exist so a written artifact can be checked against disk later. The in-process
  // auto mode compares mtimes instead, and hashing every file would be the scan's largest cost.
  const sourceHash = collectFileHashes
    ? sha256(
        Object.keys(inputs)
          .sort()
          .map((relativePath) => `${relativePath}:${inputs[relativePath]}`)
          .join('\n'),
      )
    : null;
  const tsconfigFiles = {};
  for (const configPath of collectTsconfigChain(resolvedTsconfig)) tsconfigFiles[configPath] = mtimeOf(configPath);
  const manifests = {};
  for (const manifestPath of collected.walked.manifests) manifests[relative(manifestPath)] = mtimeOf(manifestPath);
  const signature = {
    root: resolvedRoot,
    tsconfigFiles,
    files: signatureFiles,
    manifests,
    ignore,
    ignoreFiles: mtimesByRelativePath(resolvedRoot, collected.walked.ignoreFiles),
  };

  const artifact = {
    version: 1,
    generatedAt: new Date().toISOString(),
    root: resolvedRoot,
    sourceHash,
    inputs,
    signature,
    ...linked,
    excluded,
    skippedDirectories,
    ignoreSource: ignore.source,
    tsconfigLoaded,
  };

  const previousFileCount = reusable ? Object.keys(reusable.files).length : -1;
  // Nothing re-read and the same files as before: the stored state still describes the project.
  const unchanged = Boolean(reusable) && ignoreReused && extractedFiles === 0 && previousFileCount === Object.keys(fileEntries).length;

  return { artifact, state: { configKey, files: fileEntries, ignore, walkKey }, unchanged };
};

const analyzeProject = (options = {}) => analyzeProjectIncremental(options, null).artifact;

module.exports = {
  analyzeProject,
  analyzeProjectIncremental,
  collectSignature,
  isSignatureStale,
  getScanCount,
  getExtractCount,
  getGitListCount,
  getWalkCount,
  getTsconfigParseCount,
  walkSourceFiles,
  narrowWalk,
  ignoresAtLeast,
  sha256,
};
