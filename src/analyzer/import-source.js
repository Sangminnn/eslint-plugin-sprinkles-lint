/**
 * Derives the module specifier a fix should use when it has to add `import { sprinkles } from '…'`.
 *
 * The project already states the answer in its tsconfig `paths`: the sprinkles module lives at a
 * known path, and an alias maps some prefix onto it. Reversing that mapping gives the specifier the
 * rest of the codebase writes. A candidate is only accepted when it is unambiguous *and* resolves
 * back to the same file, so a wrong import can never be written; anything else leaves the fix
 * withheld exactly as it is without the option.
 */

const fs = require('fs');
const path = require('path');

const toPosix = (filePath) => filePath.split(path.sep).join('/');
const stripModuleExtension = (filePath) => filePath.replace(/\.(tsx?|mts|cts)$/, '');

const loadCompilerOptions = (ts, tsconfigPath) => {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) return null;
  return ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(tsconfigPath)).options;
};

/** Specifiers that a `paths` entry would map onto this exact file. */
const reverseMapThroughPaths = (compilerOptions, tsconfigDir, targetFile) => {
  // `paths` are relative to the config that declared them, which TypeScript records as
  // `pathsBasePath` — without it a base config reached through `extends` maps onto the wrong prefix.
  const baseUrl = compilerOptions.pathsBasePath || compilerOptions.baseUrl || tsconfigDir;
  const target = toPosix(stripModuleExtension(path.resolve(targetFile)));
  const candidates = new Set();

  for (const [pattern, substitutions] of Object.entries(compilerOptions.paths || {})) {
    for (const substitution of substitutions) {
      const resolvedSubstitution = toPosix(stripModuleExtension(path.resolve(baseUrl, substitution)));

      if (!pattern.includes('*')) {
        if (resolvedSubstitution === target) candidates.add(pattern);
        continue;
      }

      const [prefix, suffix = ''] = resolvedSubstitution.split('*');
      if (!target.startsWith(prefix) || !target.endsWith(suffix)) continue;
      const wildcard = target.slice(prefix.length, target.length - (suffix.length || 0));
      candidates.add(pattern.replace('*', wildcard));
    }
  }

  return [...candidates];
};

/**
 * @returns {string|null} the specifier to import `sprinkles` from, or null when it cannot be
 * derived without guessing.
 */
const deriveSprinklesImportSource = ({ sprinklesFilePath, tsconfigPath, containingFile }) => {
  if (!sprinklesFilePath || !tsconfigPath || !fs.existsSync(tsconfigPath)) return null;

  let ts = null;
  try {
    ts = require('typescript');
  } catch (error) {
    return null;
  }

  const compilerOptions = loadCompilerOptions(ts, tsconfigPath);
  if (!compilerOptions) return null;

  const candidates = reverseMapThroughPaths(compilerOptions, path.dirname(tsconfigPath), sprinklesFilePath);
  if (candidates.length !== 1) return null;

  const [candidate] = candidates;
  const resolved = ts.resolveModuleName(candidate, containingFile || sprinklesFilePath, compilerOptions, ts.sys);
  const resolvedFile = resolved.resolvedModule && path.resolve(resolved.resolvedModule.resolvedFileName);
  if (resolvedFile !== path.resolve(sprinklesFilePath)) return null;

  return candidate;
};

module.exports = { deriveSprinklesImportSource };
