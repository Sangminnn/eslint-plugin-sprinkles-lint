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
const ignoredImportReason = (specifier, containingFile, { matchesTsconfigPath, isInstalledPackage }) => {
  if (isBuiltinSpecifier(specifier)) return 'node-builtin';
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

const collectSourceFiles = (ts, rootDir, tsconfigPath, tsconfigWasExplicit, excludePatterns) => {
  const excludeRegexps = excludePatterns.map(globToRegExp);
  const isExcluded = (relativePath) => excludeRegexps.some((pattern) => pattern.test(relativePath));

  let compilerOptions = {};
  const fileNames = new Set();

  if (fs.existsSync(tsconfigPath)) {
    const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    if (configFile.error) {
      throw new Error(`Failed to read ${tsconfigPath}: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, ' ')}`);
    }
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(tsconfigPath));
    compilerOptions = parsed.options;
    for (const fileName of parsed.fileNames) fileNames.add(path.resolve(fileName));
  } else if (tsconfigWasExplicit) {
    throw new Error(`tsconfig not found: ${tsconfigPath}`);
  }

  // The tsconfig file set alone is not enough: a consumer outside `include` would silently
  // vanish and its compositions would look like proof. Always walk the whole root as well —
  // including dot-directories such as .storybook, whose decorators are real renderers.
  const skippedDirectories = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (DEFAULT_EXCLUDED_DIRECTORIES.has(entry.name)) skippedDirectories.push(toPosix(path.relative(rootDir, fullPath)));
        else walk(fullPath);
        continue;
      }
      if (SOURCE_EXTENSION_PATTERN.test(entry.name)) fileNames.add(fullPath);
    }
  };
  walk(rootDir);

  const excluded = [];
  const files = [];
  for (const fileName of fileNames) {
    const relativePath = toPosix(path.relative(rootDir, fileName));
    if (isExcluded(relativePath)) excluded.push(relativePath);
    else files.push(fileName);
  }

  return { files, compilerOptions, excluded: excluded.sort(), skippedDirectories: skippedDirectories.sort(), tsconfigLoaded: fs.existsSync(tsconfigPath) };
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
  return { names, canonical };
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

const analyzeProject = ({ rootDir = process.cwd(), tsconfigPath, exclude = [] } = {}) => {
  const ts = loadTypescript();
  const resolvedRoot = path.resolve(rootDir);
  const tsconfigWasExplicit = Boolean(tsconfigPath);
  const resolvedTsconfig = path.resolve(resolvedRoot, tsconfigPath || 'tsconfig.json');

  const { files, compilerOptions, excluded, skippedDirectories, tsconfigLoaded } = collectSourceFiles(
    ts,
    resolvedRoot,
    resolvedTsconfig,
    tsconfigWasExplicit,
    exclude,
  );
  const relative = (fileName) => toPosix(path.relative(resolvedRoot, fileName));

  const sources = new Map(); // absolute path → { text, sourceFile }
  for (const fileName of files) {
    const text = fs.readFileSync(fileName, 'utf8');
    sources.set(fileName, {
      text,
      sourceFile: ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKindFor(ts, fileName)),
    });
  }

  const cssModules = new Map(); // cssFile → Set(exportNames)
  for (const [fileName, { sourceFile }] of sources) {
    if (isCssModulePath(fileName)) cssModules.set(fileName, collectCssExports(ts, sourceFile));
  }

  const usagesByExport = new Map(); // cssFile → exportName → [{ safe, reason }]
  const filePoison = new Map(); // cssFile → reason applying to every export
  const unresolvedImports = []; // { file, specifier } the analyzer could not resolve but that may hide a css module
  const unscannedImports = []; // resolved project files the analyzer did not scan (excluded / outside root)
  const ignoredImports = []; // { file, specifier, reason } dropped on purpose — cannot hide a css module
  const matchesTsconfigPath = createTsconfigPathMatcher(compilerOptions);
  const isInstalledPackage = createInstalledPackageChecker(resolvedRoot);

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

  const poisonFile = (cssFile, reason) => {
    if (!filePoison.has(cssFile)) filePoison.set(cssFile, reason);
  };

  const resolveSpecifier = (specifier, containingFile) => {
    const resolved = ts.resolveModuleName(specifier, containingFile, compilerOptions, ts.sys);
    if (!resolved.resolvedModule) return { target: null, external: false };
    const target = path.resolve(resolved.resolvedModule.resolvedFileName);
    return { target, external: resolved.resolvedModule.isExternalLibraryImport || target.includes(`${path.sep}node_modules${path.sep}`) };
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
    if (!sources.has(target)) {
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

  const namespaceReexportTargets = [];
  for (const [fileName, { sourceFile }] of sources) {
    for (const statement of sourceFile.statements) {
      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        const target = resolveForGraph(statement.moduleSpecifier.text, fileName);
        if (!target) continue;
        const entry = reexportEntry(fileName);
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) {
            entry.named.set(element.name.text, { moduleFile: target, exportedName: (element.propertyName || element.name).text });
          }
        } else if (statement.exportClause && ts.isNamespaceExport(statement.exportClause)) {
          // `export * as ns from './x.css'` lets the namespace object escape untracked.
          namespaceReexportTargets.push(target);
        } else {
          entry.stars.push(target);
        }
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
  // `export const card = style([base, …])` composes `base` with more rules; hoisting base's
  // override would move it relative to every class composed on top of it.

  for (const [cssFile, cssExports] of cssModules) {
    const { sourceFile } = sources.get(cssFile);
    const visitCss = (node) => {
      if (ts.isIdentifier(node) && cssExports.names.has(node.text)) {
        const parent = node.parent;
        const isOwnDeclarationName = parent && ts.isVariableDeclaration(parent) && parent.name === node;
        const isPropertyName =
          parent &&
          ((ts.isPropertyAssignment(parent) && parent.name === node) ||
            (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
            (ts.isJsxAttribute && ts.isJsxAttribute(parent) && parent.name === node));
        const isExportClauseName = (() => {
          for (let ancestor = parent; ancestor; ancestor = ancestor.parent) {
            if (ts.isExportDeclaration(ancestor) || ts.isImportDeclaration(ancestor)) return true;
          }
          return false;
        })();

        if (!isOwnDeclarationName && !isPropertyName && !isExportClauseName) {
          recordUsage(cssFile, node.text, UNPROVEN('referenced-within-css-file'));
        }
      }
      ts.forEachChild(node, visitCss);
    };
    visitCss(sourceFile);
  }

  // ---- Consumer scan ----------------------------------------------------------------------

  for (const [fileName, { sourceFile }] of sources) {
    const namespaceBindings = new Map(); // localName → cssFile
    const namedBindings = new Map(); // localName → { cssFile, cssExport }

    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const target = resolveForGraph(statement.moduleSpecifier.text, fileName);
      if (!target) continue;

      const clause = statement.importClause;
      if (!clause) continue;

      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        if (cssModules.has(target) && !reexports.has(target)) namespaceBindings.set(clause.namedBindings.name.text, target);
        else poisonReachableCss(target, 'namespace-import-of-reexporter');
      }
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          const importedName = (element.propertyName || element.name).text;
          const resolved = resolveThroughReexports(target, importedName);
          if (resolved && resolved !== 'unresolved') {
            namedBindings.set(element.name.text, { cssFile: resolved.cssFile, cssExport: resolved.cssExport });
          } else if (resolved === 'unresolved') {
            poisonReachableCss(target, 'reexport-unresolved');
          }
          // resolved === null: the name does not come from any css module (plain shared module) — no css to protect.
        }
      }
      if (clause.name) poisonReachableCss(target, 'default-import');
    }

    const visit = (node) => {
      // require('./x.css'), await import('./x.css'), import x = require('./x.css'):
      // bindings created this way are not tracked, so anything css-reachable is poisoned.
      if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
        const callee = node.expression;
        const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
        const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
        if (isRequire || isDynamicImport) poisonReachableCss(resolveForGraph(node.arguments[0].text, fileName), 'commonjs-or-dynamic-import');
      }
      if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) {
        poisonReachableCss(resolveForGraph(node.moduleReference.expression.text, fileName), 'commonjs-or-dynamic-import');
      }

      if (ts.isIdentifier(node)) {
        const name = node.text;
        const enclosing = (() => {
          for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
            if (ts.isImportDeclaration(ancestor)) return 'import';
            if (ts.isExportDeclaration(ancestor)) return ancestor.moduleSpecifier ? 'export-from' : 'export-local';
          }
          return null;
        })();
        const skip = enclosing === 'import' || enclosing === 'export-from';

        if (!skip && namespaceBindings.has(name)) {
          const cssFile = namespaceBindings.get(name);
          const parent = node.parent;
          if (enclosing === 'export-local') {
            poisonFile(cssFile, 'namespace-reexported');
          } else if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === node) {
            recordUsage(cssFile, parent.name.text, classifyValueUsage(ts, parent));
          } else if (parent && ts.isElementAccessExpression(parent) && parent.expression === node) {
            poisonFile(cssFile, 'dynamic-access');
          } else {
            poisonFile(cssFile, 'namespace-escapes');
          }
        }

        if (!skip && namedBindings.has(name)) {
          const parent = node.parent;
          const isMemberName =
            parent &&
            ((ts.isPropertyAccessExpression(parent) && parent.name === node) ||
              (ts.isPropertyAssignment(parent) && parent.name === node) ||
              (ts.isJsxAttribute && ts.isJsxAttribute(parent) && parent.name === node));
          if (!isMemberName) {
            const { cssFile, cssExport } = namedBindings.get(name);
            if (enclosing === 'export-local') recordUsage(cssFile, cssExport, UNPROVEN('reexported-locally'));
            else recordUsage(cssFile, cssExport, classifyValueUsage(ts, node));
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
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

  const inputs = {};
  for (const [fileName, { text }] of sources) inputs[relative(fileName)] = sha256(text);
  const sourceHash = sha256(
    Object.keys(inputs)
      .sort()
      .map((relativePath) => `${relativePath}:${inputs[relativePath]}`)
      .join('\n'),
  );

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    root: resolvedRoot,
    sourceHash,
    inputs,
    provenSoloClasses,
    unproven,
    unresolvedImports,
    unscannedImports,
    ignoredImports,
    excluded,
    skippedDirectories,
    tsconfigLoaded,
  };
};

module.exports = { analyzeProject, sha256 };
