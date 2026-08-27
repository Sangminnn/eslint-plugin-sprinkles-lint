const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SPRINKLES_FILE_PATTERNS = [
  'src/data/sprinkles.css.ts',
  'src/styles/sprinkles.css.ts',
  'src/theme/sprinkles.css.ts',
  'styles/sprinkles.css.ts',
  'theme/sprinkles.css.ts',
  'sprinkles.css.ts'
];

const COMBINED_SPRINKLES_PATTERN = /export\s+const\s+sprinklesProperties\s*=\s*{\s*\.\.\.unresponsiveSprinklesProperties,\s*\.\.\.colorSprinklesProperties,?\s*}\s*(?:as\s+const)?\s*(?:satisfies\s+[^\n;]+)?\s*(?:;|\n|$)/;

const createExportObjectRegex = (exportName) =>
  new RegExp(
    `export\\s+const\\s+${exportName}\\s*=\\s*({[\\s\\S]*?})\\s*(?:as\\s+const)?\\s*(?:satisfies\\s+[^\\n;]+)?\\s*(?:;|\\n|$)`
  );

const stripOuterBraces = (text) => text.replace(/^\s*{/, '').replace(/}\s*$/, '').trim();

const removeTrailingComma = (text) => (text.endsWith(',') ? text.slice(0, -1) : text);

/**
 * Find sprinkles.css.ts file in the project
 * @param {string} projectRoot - The root directory of the project
 * @returns {string|null} The path to sprinkles file or null if not found
 */
const findSprinklesFile = (projectRoot = process.cwd()) => {
  for (const pattern of SPRINKLES_FILE_PATTERNS) {
    const fullPath = path.resolve(projectRoot, pattern);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }
  return null;
};

/**
 * Parse sprinkles.css.ts file to extract sprinklesProperties and shorthands
 * @param {string} filePath - Path to the sprinkles file
 * @returns {object} Object containing sprinklesConfig and shorthands
 */
function parseSprinklesFile(filePath, visited = new Set()) {
  try {
    const normalizedPath = path.resolve(filePath);
    if (visited.has(normalizedPath)) {
      return null;
    }
    visited.add(normalizedPath);

    const content = fs.readFileSync(filePath, 'utf-8');
    const imports = parseImports(content);

    // Extract sprinklesProperties definition - fall back to resolving re-exports
    let sprinklesPropsText = null;
    let externalConfig = null;

    if (COMBINED_SPRINKLES_PATTERN.test(content)) {
      const unresponsiveMatch = content.match(createExportObjectRegex('unresponsiveSprinklesProperties'));
      const colorMatch = content.match(createExportObjectRegex('colorSprinklesProperties'));

      if (unresponsiveMatch && colorMatch) {
        const unresponsiveContent = removeTrailingComma(stripOuterBraces(unresponsiveMatch[1]));
        const colorContent = removeTrailingComma(stripOuterBraces(colorMatch[1]));

        sprinklesPropsText = `{\n  ${unresponsiveContent},\n  ${colorContent}\n}`;
      } else {
        throw new Error('Could not find unresponsiveSprinklesProperties or colorSprinklesProperties');
      }
    } else {
      const directMatch = content.match(createExportObjectRegex('sprinklesProperties'));

      if (directMatch) {
        sprinklesPropsText = directMatch[1];
      }
    }

    if (!sprinklesPropsText) {
      externalConfig = resolveReExportedSprinkles(content, filePath, visited) ||
        resolveImportedSprinkles(imports, filePath, visited);
      if (!externalConfig) {
        throw new Error('Could not find sprinklesProperties export');
      }
    }

    // Extract shorthands export
    const shorthandsMatch = content.match(/export\s+const\s+shorthands\s*=\s*({[\s\S]*?})\s*(?:satisfies|as)/);

    // Simple parsing for basic properties like arrays and objects
    const sprinklesConfig = sprinklesPropsText
      ? parseJSObject(sprinklesPropsText, content, filePath)
      : externalConfig?.sprinklesConfig;

    // Parse shorthands
    let shorthandsList = [];
    if (shorthandsMatch) {
      try {
        const shorthandsObj = parseJSObject(shorthandsMatch[1], content, filePath);
        shorthandsList = Object.keys(shorthandsObj);
      } catch (error) {
        console.warn('Could not parse shorthands:', error.message);
      }
    }

    if (!sprinklesPropsText && externalConfig && Array.isArray(externalConfig.shorthands) && !shorthandsList.length) {
      shorthandsList = externalConfig.shorthands;
    }

    return {
      sprinklesConfig,
      shorthands: shorthandsList
    };

  } catch (error) {
    console.error('Error parsing sprinkles file:', error.message);
    return null;
  }
}

function resolveReExportedSprinkles(fileContent, currentFilePath, visited) {
  const reExportPattern = /export\s*\{\s*([^}]+)\s*\}\s*from\s*['"]([^'"]+)['"]/g;
  let match;

  while ((match = reExportPattern.exec(fileContent)) !== null) {
    const specifiers = match[1]
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    const exportsSprinkles = specifiers.some((specifier) => {
      const aliasMatch = specifier.match(/^(.+?)\s+as\s+(.+)$/);
      const exportName = aliasMatch ? aliasMatch[1].trim() : specifier;
      return exportName === 'sprinklesProperties';
    });

    if (!exportsSprinkles) {
      continue;
    }

    const sourcePath = match[2];
    const resolvedPath = resolveImportPath(sourcePath, currentFilePath);
    if (!resolvedPath) {
      continue;
    }

    const parsed = parseSprinklesFile(resolvedPath, visited);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function resolveImportedSprinkles(imports, currentFilePath, visited) {
  if (!Array.isArray(imports) || imports.length === 0) {
    return null;
  }

  const targetExports = new Set(['sprinklesProperties', 'colorSprinklesProperties', 'shorthands']);
  const targetModules = new Set();

  imports.forEach((imp) => {
    if (targetExports.has(imp.exportName)) {
      targetModules.add(imp.from);
    }
  });

  for (const fromPath of targetModules) {
    const resolvedPath = resolveImportPath(fromPath, currentFilePath);
    if (!resolvedPath) {
      continue;
    }

    const parsed = parseSprinklesFile(resolvedPath, visited);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

/**
 * Parse import statements from file content
 * @param {string} fileContent - Full file content
 * @returns {Array} Array of import objects
 */
const parseImports = (fileContent) => {
  const imports = [];
  const namedImportPattern = /import\s*\{\s*([^}]+)\s*\}\s*from\s*['"]([^'"]+)['"]/g;
  const namespaceImportPattern = /import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/g;

  let match;
  while ((match = namedImportPattern.exec(fileContent)) !== null) {
    const importedItems = match[1];
    const fromPath = match[2];

    const items = importedItems.split(',').map(item => {
      const trimmed = item.trim();

      const aliasMatch = trimmed.match(/^(.+?)\s+as\s+(.+)$/);
      if (aliasMatch) {
        return {
          exportName: aliasMatch[1].trim(),
          localName: aliasMatch[2].trim(),
          from: fromPath
        };
      }

      return {
        exportName: trimmed,
        localName: trimmed,
        from: fromPath
      };
    });

    imports.push(...items);
  }

  while ((match = namespaceImportPattern.exec(fileContent)) !== null) {
    imports.push({
      exportName: '*',
      localName: match[1],
      from: match[2],
      isNamespace: true
    });
  }

  return imports;
};

/**
 * Resolve import path to absolute file path
 * @param {string} importPath - Import path like '@/styles/vars/semantic'
 * @param {string} currentFilePath - Current file path
 * @returns {string|null} Resolved absolute path or null if not found
 */
/**
 * Resolve node_modules package path
 * @param {string} packageName - Package name like '@bgzt/ui/theme'
 * @param {string} currentFilePath - Current file path to start searching from
 * @returns {string|null} Resolved package file path or null
 */
const NODE_RESOLVE_EXTENSIONS = ['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.cts', '.mts', '.d.ts', '.d.cts', '.d.mts'];
const INDEX_SUFFIXES = NODE_RESOLVE_EXTENSIONS.map((ext) => `/index${ext}`);

const collectSearchPaths = (startDir) => {
  const searchDirs = [];
  let currentDir = startDir;
  const visited = new Set();

  while (!visited.has(currentDir)) {
    searchDirs.push(currentDir);
    visited.add(currentDir);

    const parent = path.dirname(currentDir);
    if (parent === currentDir) {
      break;
    }
    currentDir = parent;
  }

  if (!visited.has(process.cwd())) {
    searchDirs.push(process.cwd());
  }

  return searchDirs;
};

const tryNodeResolve = (specifier, searchDirs) => {
  for (const dir of searchDirs) {
    try {
      const resolved = require.resolve(specifier, { paths: [dir] });
      if (resolved) {
        return resolved;
      }
    } catch (error) {
      // Ignore resolution errors and try the next directory
    }
  }
  return null;
};

const normalizeExportTarget = (entry, replacement = '') => {
  if (!entry) {
    return null;
  }
  if (typeof entry === 'string') {
    return entry.replace('*', replacement);
  }

  if (typeof entry === 'object') {
    const candidateKeys = ['default', 'module', 'browser', 'node', 'import', 'require', 'types', 'typings'];

    for (const key of candidateKeys) {
      if (entry[key]) {
        const nested = normalizeExportTarget(entry[key], replacement);
        if (nested) {
          return nested;
        }
      }
    }
  }

  return null;
};

const resolveFromExports = (pkgExports, packagePath, subPath) => {
  if (!pkgExports) {
    return null;
  }

  const directKey = subPath ? `./${subPath}` : '.';
  if (pkgExports[directKey]) {
    const target = normalizeExportTarget(pkgExports[directKey]);
    if (target) {
      const resolved = path.resolve(packagePath, target);
      if (fs.existsSync(resolved)) {
        return resolved;
      }
    }
  }

  for (const [key, target] of Object.entries(pkgExports)) {
    if (!key.includes('*')) {
      continue;
    }

    const pattern = key.replace('./', '').replace('*', '(.*)');
    const regex = new RegExp(`^${pattern}$`);
    const match = (subPath || '').match(regex);
    if (!match) {
      continue;
    }

    const replacement = match[1] || '';
    const normalized = normalizeExportTarget(target, replacement);
    if (!normalized) {
      continue;
    }

    const resolved = path.resolve(packagePath, normalized);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  return null;
};

const tryResolveWithExtensions = (basePath) => {
  for (const ext of NODE_RESOLVE_EXTENSIONS) {
    const candidate = basePath + ext;
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  for (const suffix of INDEX_SUFFIXES) {
    const candidate = `${basePath}${suffix}`;
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
};

const createEvaluationContext = (variables = {}) => {
  const sandbox = {
    Array,
    Number,
    String,
    Boolean,
    Object,
    Math,
    JSON,
    parseInt,
    parseFloat,
    Set,
    Map,
    console: { log: () => {} },
  };

  Object.keys(variables).forEach((key) => {
    sandbox[key] = variables[key];
  });

  sandbox.globalThis = sandbox;
  sandbox.require = undefined;
  sandbox.process = undefined;
  sandbox.module = undefined;
  sandbox.exports = undefined;
  sandbox.__dirname = undefined;
  sandbox.__filename = undefined;

  return sandbox;
};

const sanitizeArrayValues = (values = []) => {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => {
      if (typeof value === 'number' || typeof value === 'string') {
        return value;
      }
      return null;
    })
    .filter((value) => value !== null);
};

const sanitizeObjectValues = (obj = {}) => {
  if (!isPlainObject(obj)) {
    return {};
  }

  const result = {};
  Object.entries(obj).forEach(([key, value]) => {
    if (typeof value === 'number' || typeof value === 'string') {
      result[key] = value;
    }
  });

  return result;
};

const evaluateExpression = (expression, variables = {}) => {
  if (!expression) {
    return null;
  }

  try {
    const sandbox = createEvaluationContext(variables);
    return vm.runInNewContext(expression, sandbox, { timeout: 100 });
  } catch (error) {
    // Ignore evaluation errors
  }

  return null;
};

const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const extractColorObject = (value) => {
  if (!isPlainObject(value)) {
    return null;
  }

  if (value.colors && isPlainObject(value.colors) && Object.keys(value.colors).length > 0) {
    return value.colors;
  }

  if (Object.keys(value).length === 0) {
    return null;
  }

  return value;
};

const tryLoadModuleExport = (filePath, exportName) => {
  const ext = path.extname(filePath);
  const canRequire = ['.js', '.cjs', '', '.json'].includes(ext);

  if (!canRequire) {
    return null;
  }

  try {
    if (require.cache[filePath]) {
      delete require.cache[filePath];
    }

    const loadedModule = require(filePath);
    const candidates = [];

    if (loadedModule && exportName && Object.prototype.hasOwnProperty.call(loadedModule, exportName)) {
      candidates.push(loadedModule[exportName]);
    }

    if (loadedModule && isPlainObject(loadedModule.default)) {
      if (exportName && Object.prototype.hasOwnProperty.call(loadedModule.default, exportName)) {
        candidates.push(loadedModule.default[exportName]);
      }
      candidates.push(loadedModule.default);
    } else if (!exportName && loadedModule) {
      candidates.push(loadedModule);
    }

    if (loadedModule && !candidates.length) {
      candidates.push(loadedModule);
    }

    for (const candidate of candidates) {
      const extracted = extractColorObject(candidate);
      if (extracted) {
        return extracted;
      }
    }
  } catch (error) {
    // Ignore runtime loading errors
  }

  return null;
};

const resolveNodeModulesPath = (packageName, currentFilePath) => {
  const searchDirs = collectSearchPaths(path.dirname(currentFilePath));
  const resolvedByNode = tryNodeResolve(packageName, searchDirs);
  if (resolvedByNode) {
    return resolvedByNode;
  }

  let currentDir = path.dirname(currentFilePath);

  while (currentDir !== path.dirname(currentDir)) {
    const nodeModulesPath = path.join(currentDir, 'node_modules');

    if (fs.existsSync(nodeModulesPath)) {
      let packagePath;

      if (packageName.includes('/')) {
        const parts = packageName.split('/');
        if (packageName.startsWith('@')) {
          const scope = parts[0];
          const pkg = parts[1];
          const subPath = parts.slice(2).join('/');

          packagePath = path.join(nodeModulesPath, scope, pkg);
          

          if (subPath) {
            const specificPath = path.join(packagePath, subPath);
            const resolved = tryResolveWithExtensions(specificPath);
            if (resolved) {
              return resolved;
            }

            const packageJsonPath = path.join(packagePath, 'package.json');
            if (fs.existsSync(packageJsonPath)) {
              try {
                const pkgJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
                if (pkgJson && pkgJson.exports) {
                  const exportResolved = resolveFromExports(pkgJson.exports, packagePath, subPath);
                  if (exportResolved) {
                    return exportResolved;
                  }
                }
              } catch (error) {
                // Ignore malformed package.json entries
              }
            }
          }
        } else {
          const pkg = parts[0];
          const subPath = parts.slice(1).join('/');
          packagePath = path.join(nodeModulesPath, pkg);

          if (subPath) {
            const specificPath = path.join(packagePath, subPath);
            const resolved = tryResolveWithExtensions(specificPath);
            if (resolved) {
              return resolved;
            }
          }
        }
      } else {
        packagePath = path.join(nodeModulesPath, packageName);
      }

      if (fs.existsSync(packagePath)) {
        const packageJsonPath = path.join(packagePath, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
          try {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
            const exportResolved = resolveFromExports(packageJson.exports, packagePath, '');
            if (exportResolved) {
              return exportResolved;
            }

            const entryPoints = [
              packageJson.module,
              packageJson.main,
              packageJson.types,
              packageJson.typings,
              'index.ts',
              'index.tsx',
              'index.js',
              'index.jsx'
            ].filter(Boolean);

            for (const entry of entryPoints) {
              const entryPath = path.resolve(packagePath, entry);
              if (fs.existsSync(entryPath)) {
                return entryPath;
              }

              const basePath = entryPath.replace(new RegExp(`${path.extname(entryPath)}$`), '');
              const fallbackEntry = tryResolveWithExtensions(basePath);
              if (fallbackEntry) {
                return fallbackEntry;
              }
            }
          } catch (error) {
            // Continue if package.json parsing fails
          }
        }

        const fallbackFiles = ['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.mjs', 'index.cjs'];
        for (const file of fallbackFiles) {
          const fullPath = path.join(packagePath, file);
          if (fs.existsSync(fullPath)) {
            return fullPath;
          }
        }
      }
    }

    currentDir = path.dirname(currentDir);
  }

  return null;
};

const resolveImportPath = (importPath, currentFilePath) => {
  const currentDir = path.dirname(currentFilePath);
  let resolvedPath = null;
  
  try {
    // Handle @/ alias (common in many projects)
    if (importPath.startsWith('@/')) {
      const projectRoot = findProjectRoot(currentFilePath);
      const relativePath = importPath.replace('@/', '');
      resolvedPath = path.resolve(projectRoot, 'src', relativePath);
    }
    // Handle relative imports
    else if (importPath.startsWith('./') || importPath.startsWith('../')) {
      resolvedPath = path.resolve(currentDir, importPath);
    }
    // Handle node_modules packages
    else {
      return resolveNodeModulesPath(importPath, currentFilePath);
    }
    
    // Try different extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];
    for (const ext of extensions) {
      const fullPath = resolvedPath + ext;
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
    
    // Try index files
    for (const ext of extensions) {
      const indexPath = path.join(resolvedPath, `index${ext}`);
      if (fs.existsSync(indexPath)) {
        return indexPath;
      }
    }
    
  } catch (error) {
    // Ignore resolution errors
  }
  
  return null;
};

/**
 * Find project root directory
 * @param {string} startPath - Starting file path
 * @returns {string} Project root path
 */
const findProjectRoot = (startPath) => {
  let currentPath = path.dirname(startPath);
  
  while (currentPath !== path.dirname(currentPath)) {
    // Look for common project root indicators
    const indicators = ['package.json', 'tsconfig.json', '.git'];
    
    for (const indicator of indicators) {
      if (fs.existsSync(path.join(currentPath, indicator))) {
        return currentPath;
      }
    }
    
    currentPath = path.dirname(currentPath);
  }
  
  return process.cwd(); // Fallback to current working directory
};

const collectIndividualExports = (content) => {
  const individualExportsPattern = /export\s+(?:const|let|var)\s+(\w+)\s*=\s*([^{;\n][^;\n]*|'[^']*'|"[^"]*");?/g;
  const individualExports = {};
  let individualMatch;

  while ((individualMatch = individualExportsPattern.exec(content)) !== null) {
    const [, varName, varValue] = individualMatch;
    let cleanValue = varValue.trim();

    if ((cleanValue.startsWith('"') && cleanValue.endsWith('"')) ||
        (cleanValue.startsWith("'") && cleanValue.endsWith("'"))) {
      cleanValue = cleanValue.slice(1, -1);
    }

    individualExports[varName] = cleanValue;
  }

  return Object.keys(individualExports).length > 0 ? individualExports : null;
};

/**
 * Parse exported value from a file
 * @param {string} filePath - Path to the file
 * @param {string} exportName - Name of the export to find
 * @returns {object|null} Parsed exported value or null
 */
const parseExportedValue = (filePath, exportName) => {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const runtimeValue = tryLoadModuleExport(filePath, exportName);
    if (runtimeValue) {
      return runtimeValue;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const currentDir = path.dirname(filePath);

    const isNamespaceRequest = !exportName || exportName === '*';

    if (isNamespaceRequest) {
      return collectIndividualExports(content);
    }

    // Helper function to resolve import path
    const resolveRelativePath = (importPath) => {
      if (!importPath.startsWith('./') && !importPath.startsWith('../')) {
        return null;
      }
      const basePath = path.resolve(currentDir, importPath);
      const extensions = ['.ts', '.tsx', '.js', '.jsx'];

      for (const ext of extensions) {
        const fullPath = basePath + ext;
        if (fs.existsSync(fullPath)) {
          return fullPath;
        }
      }
      // Try index files
      for (const ext of extensions) {
        const indexPath = path.join(basePath, `index${ext}`);
        if (fs.existsSync(indexPath)) {
          return indexPath;
        }
      }
      return null;
    };

    // Pattern 1: export { originalName as exportName } from './path'
    const namedReExportPattern = new RegExp(
      `export\\s*\\{[^}]*?(\\w+)\\s+as\\s+${exportName}[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`
    );
    const namedReExportMatch = namedReExportPattern.exec(content);

    if (namedReExportMatch) {
      const originalName = namedReExportMatch[1];
      const importPath = namedReExportMatch[2];
      const resolvedPath = resolveRelativePath(importPath);

      if (resolvedPath) {
        return parseExportedValue(resolvedPath, originalName);
      }
    }

    // Pattern 2: export { exportName } from './path' (same name re-export)
    const sameNameReExportPattern = new RegExp(
      `export\\s*\\{[^}]*?\\b${exportName}\\b(?!\\s+as)[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`
    );
    const sameNameReExportMatch = sameNameReExportPattern.exec(content);

    if (sameNameReExportMatch) {
      const importPath = sameNameReExportMatch[1];
      const resolvedPath = resolveRelativePath(importPath);

      if (resolvedPath) {
        return parseExportedValue(resolvedPath, exportName);
      }
    }

    // Pattern 3: import * as exportName from './path'; export { exportName };
    const namespaceImportPattern = new RegExp(`import\\s*\\*\\s*as\\s+${exportName}\\s+from\\s*['"]([^'"]+)['"]`);
    const namespaceImportMatch = namespaceImportPattern.exec(content);

    if (namespaceImportMatch) {
      const importPath = namespaceImportMatch[1];
      const resolvedPath = resolveRelativePath(importPath);

      if (resolvedPath) {
        return parseExportedValue(resolvedPath, exportName);
      }
    }

    // Pattern 4: import { originalName } from './path'; export { originalName as exportName };
    // (import-then-export without 'from' in export statement)
    const importThenExportPattern = new RegExp(
      `import\\s*\\{[^}]*?(\\w+)[^}]*\\}\\s*from\\s*['"]([^'"]+)['"][\\s\\S]*?export\\s*\\{[^}]*?\\1\\s+as\\s+${exportName}`
    );
    const importThenExportMatch = importThenExportPattern.exec(content);

    if (importThenExportMatch) {
      const originalName = importThenExportMatch[1];
      const importPath = importThenExportMatch[2];
      const resolvedPath = resolveRelativePath(importPath);

      if (resolvedPath) {
        return parseExportedValue(resolvedPath, originalName);
      }
    }

    // Pattern 5: import { originalName } from './path'; export { originalName }; (same name, no 'from')
    const importThenSameNameExportPattern = new RegExp(
      `import\\s*\\{[^}]*?\\b(${exportName})\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"][\\s\\S]*?export\\s*\\{[^}]*?\\b\\1\\b(?!\\s+as)[^}]*\\}`
    );
    const importThenSameNameExportMatch = importThenSameNameExportPattern.exec(content);

    if (importThenSameNameExportMatch) {
      const importPath = importThenSameNameExportMatch[2];
      const resolvedPath = resolveRelativePath(importPath);

      if (resolvedPath) {
        return parseExportedValue(resolvedPath, exportName);
      }
    }
    
    // Try direct export patterns FIRST (for object exports like scaleColor = {...})
    // This must come before individualExportsPattern which can't handle multi-line objects
    const patterns = [
      // export const color = { ... }
      new RegExp(`export\\s+const\\s+${exportName}\\s*=\\s*\\{([\\s\\S]*?)\\}\\s*;?`, 'g'),
      // const color = { ... }; export { color };
      new RegExp(`const\\s+${exportName}\\s*=\\s*\\{([\\s\\S]*?)\\}[\\s\\S]*?export\\s*\\{[^}]*${exportName}[^}]*\\}`, 'g'),
      // export = { color: ... } or module.exports
      new RegExp(`(?:export\\s*=|module\\.exports\\s*=)\\s*\\{[\\s\\S]*?${exportName}\\s*:\\s*\\{([\\s\\S]*?)\\}`, 'g')
    ];
    
    for (const pattern of patterns) {
      const match = pattern.exec(content);
      if (match && match[1]) {
        const objContent = match[1];
        
        // Parse simple key-value pairs
        const result = {};
        const keyValuePattern = /['"]?([^'":\s,]+)['"]?\s*:\s*(['"][^'"]*['"]|[^,\s}]+)/g;
        let kvMatch;
        
        while ((kvMatch = keyValuePattern.exec(objContent)) !== null) {
          let value = kvMatch[2].trim();
          // Remove quotes if present
          if ((value.startsWith('"') && value.endsWith('"')) || 
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          result[kvMatch[1]] = value;
        }
        
        if (Object.keys(result).length > 0) {
          return result;
        }
      }
    }

    // Try individual export statements (for simple values like: export const brand = 'value')
    const individualExports = collectIndividualExports(content);
    if (individualExports) {
      return individualExports;
    }

  } catch (error) {
    console.warn(`Error parsing exported value from ${filePath}:`, error.message);
  }

  return null;
};

/**
 * Extract variable definitions from the full content with import resolution
 * @param {string} fullContent - Full file content
 * @param {string} currentFilePath - Current file path
 * @returns {object} Map of variable name to parsed content
 */
const extractVariableDefinitions = (fullContent, currentFilePath) => {
  const variables = {};

  const imports = parseImports(fullContent);
  const importMap = {};
  imports.forEach((imp) => {
    importMap[imp.localName] = imp;
  });

  imports.forEach((imp) => {
    if (Object.prototype.hasOwnProperty.call(variables, imp.localName)) {
      return;
    }

    const resolvedPath = resolveImportPath(imp.from, currentFilePath);
    if (!resolvedPath) {
      return;
    }

    const exportedValue = parseExportedValue(resolvedPath, imp.exportName);
    if (!exportedValue) {
      return;
    }

    if (isPlainObject(exportedValue)) {
      const sanitized = sanitizeObjectValues(exportedValue);
      if (Object.keys(sanitized).length > 0) {
        variables[imp.localName] = sanitized;
      }
    } else if (Array.isArray(exportedValue)) {
      const sanitized = sanitizeArrayValues(exportedValue);
      if (sanitized.length > 0) {
        variables[imp.localName] = sanitized;
      }
    } else if (typeof exportedValue === 'string' || typeof exportedValue === 'number') {
      variables[imp.localName] = exportedValue;
    }
  });

  const constantPattern = /const\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]*?);/g;

  let constantMatch;
  while ((constantMatch = constantPattern.exec(fullContent)) !== null) {
    const varName = constantMatch[1];

    if (Object.prototype.hasOwnProperty.call(variables, varName)) {
      continue;
    }

    let expression = constantMatch[2].trim();
    if (!expression || expression.length === 0) {
      continue;
    }

    if (/require\s*\(/.test(expression) || /import\s*\(/.test(expression)) {
      continue;
    }

    if (/createSprinkles|defineProperties/.test(expression)) {
      continue;
    }

    expression = expression.replace(/\s+as\s+const\s*$/i, '');

    const wrappedExpression = expression.startsWith('{') ? `(${expression})` : expression;
    const evaluatedValue = evaluateExpression(wrappedExpression, variables);

    if (Array.isArray(evaluatedValue)) {
      const sanitized = sanitizeArrayValues(evaluatedValue);
      if (sanitized.length > 0) {
        variables[varName] = sanitized;
      }
    } else if (isPlainObject(evaluatedValue)) {
      const sanitized = sanitizeObjectValues(evaluatedValue);
      if (Object.keys(sanitized).length > 0) {
        variables[varName] = sanitized;
      }
    } else if (typeof evaluatedValue === 'string' || typeof evaluatedValue === 'number') {
      variables[varName] = evaluatedValue;
    }
  }

  return variables;
};

/**
 * Simple parser for JavaScript objects in sprinkles config
 * @param {string} objText - The object text to parse
 * @param {string} fullContent - Full file content for context
 * @returns {object} Parsed object
 */
const parseJSObject = (objText, fullContent, currentFilePath) => {
  // Use pattern matching to extract properties directly
  const result = {};
  
  // Extract variable definitions first
  const variables = extractVariableDefinitions(fullContent, currentFilePath);
  
  // Remove comments and clean up text
  const cleanText = objText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  
  // Match properties with different value types
  const patterns = [
    // Array properties: propName: ['value1', 'value2', ...]
    {
      pattern: /(\w+):\s*\[\s*([^\]]*?)\s*\]/g,
      parser: (propName, content) => {
        const evaluatedArray = evaluateExpression(`[${content}]`, variables);
        if (Array.isArray(evaluatedArray)) {
          const sanitizedValues = sanitizeArrayValues(evaluatedArray);
          if (sanitizedValues.length > 0) {
            result[propName] = sanitizedValues;
            return;
          }
        }

        const values = content
          .split(',')
          .map(v => v.trim().replace(/['"]/g, ''))
          .filter(v => v.length > 0 && !v.includes('Size') && !v.includes('Array.from'));

        if (values.length > 0) {
          result[propName] = values;
        }
      }
    },

    // Object properties: propName: { key: value, ... }
    {
      pattern: /(\w+):\s*\{\s*([^}]*?)\s*\}/g,
      parser: (propName, content) => {
        const evaluatedObject = evaluateExpression(`(${content})`, variables);
        const sanitizedObject = sanitizeObjectValues(evaluatedObject);
        if (sanitizedObject && Object.keys(sanitizedObject).length > 0) {
          result[propName] = sanitizedObject;
          return;
        }

        // Skip spread operations and complex expressions, but handle colorPalette specially
        if (content.includes('...') && !content.includes('colorPalette')) return;
        if (content.includes('Array.from')) return;

        const obj = {};
        const keyValuePattern = /['"]?([^'":\s,]+)['"]?\s*:\s*(['"][^'"]*['"]|\d+)/g;
        let kvMatch;
        
        while ((kvMatch = keyValuePattern.exec(content)) !== null) {
          obj[kvMatch[1]] = kvMatch[2].replace(/['"]/g, '');
        }
        
        if (Object.keys(obj).length > 0) {
          result[propName] = obj;
        }
      }
    },
    
    // Color palette references - now use extracted variables
    {
      pattern: /(\w+):\s*colorPalette/g,
      parser: (propName) => {
        if (variables.colorPalette && Object.keys(variables.colorPalette).length > 0) {
          result[propName] = variables.colorPalette;
        } else {
          // Fallback to expanded mock colors including semantic colors
          result[propName] = {
            'white': '#ffffff',
            'black': '#000000', 
            'red': '#ff0000',
            'blue': '#0000ff',
            'green': '#00ff00',
            'yellow': '#ffff00',
            'gray': '#808080',
            'neutral': '#6b7280',
            'primary': '#3b82f6',
            'secondary': '#6b7280', 
            'success': '#10b981',
            'warning': '#f59e0b',
            'error': '#ef4444',
            'info': '#3b82f6',
            'background': '#ffffff',
            'surface': '#f9fafb',
            'text': '#111827',
            'muted': '#6b7280'
          };
        }
      }
    },
    
    // Variable references that should be treated as arrays
    {
      pattern: /(\w+):\s*([A-Za-z_$][\w$]*)/g,
      parser: (propName, varName) => {
        if (result[propName]) {
          return;
        }

        const variableValue = variables[varName];

        if (Array.isArray(variableValue)) {
          const sanitized = sanitizeArrayValues(variableValue);
          if (sanitized.length > 0) {
            result[propName] = sanitized;
          }
        } else if (isPlainObject(variableValue)) {
          const sanitized = sanitizeObjectValues(variableValue);
          if (Object.keys(sanitized).length > 0) {
            result[propName] = sanitized;
          }
        } else if (typeof variableValue === 'string' || typeof variableValue === 'number') {
          result[propName] = variableValue;
        }
      }
    }
  ];
  
  // Apply all patterns
  patterns.forEach(({ pattern, parser }) => {
    let match;
    while ((match = pattern.exec(cleanText)) !== null) {
      parser(match[1], match[2]);
    }
  });
  
  // Special handling for spread operations
  if (objText.includes('...detailSizes') || objText.includes('...customSizes')) {
    // Look for margin and padding properties that typically use these arrays
    const spreadProps = ['marginTop', 'marginBottom', 'marginLeft', 'marginRight',
                         'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight'];
    
    spreadProps.forEach(prop => {
      if (objText.includes(prop) && !result[prop]) {
        // Use proper arrays based on spread type
        const hasDetailSizes = objText.includes('...detailSizes');
        const hasCustomSizes = objText.includes('...customSizes');
        
        let values = [];
        if (hasDetailSizes) {
          if (Array.isArray(variables.detailSizes)) {
            values.push(...sanitizeArrayValues(variables.detailSizes));
          } else {
            values.push(...Array.from({ length: 41 }, (_, i) => i / 10));
          }
        }
        if (hasCustomSizes) {
          if (Array.isArray(variables.customSizes)) {
            values.push(...sanitizeArrayValues(variables.customSizes));
          } else {
            values.push(...Array.from({ length: 41 }, (_, i) => i));
          }
        }
        if (objText.includes("'auto'")) {
          values.push('auto');
        }
        
        result[prop] = values.length > 0 ? values : [0, 1, 2, 3, 4, 5, 10, 15, 20, 'auto'];
      }
    });
  }
  
  return result;
};

/**
 * Get sprinkles configuration, either from file discovery or provided config
 * @param {object} options - ESLint rule options
 * @returns {object|null} Sprinkles configuration
 */
const getSprinklesConfig = (options = {}) => {
  // If sprinklesConfig is directly provided (e.g., in tests), use it
  if (options.sprinklesConfig) {
    // console.log('[getSprinklesConfig] Using directly provided config, keys:', Object.keys(options.sprinklesConfig));
    return {
      sprinklesConfig: options.sprinklesConfig,
      shorthands: options.shorthands || []
    };
  }

  // If configPath is provided, use the existing approach
  if (options.configPath) {
    try {
      const configPath = path.resolve(process.cwd(), options.configPath);
      return require(configPath);
    } catch (error) {
      console.error('Error loading config from path:', error.message);
      return null;
    }
  }

  // Auto-discovery mode
  // console.log('[getSprinklesConfig] Using auto-discovery mode');
  const sprinklesFilePath = findSprinklesFile();
  if (!sprinklesFilePath) {
    // console.warn('Could not find sprinkles.css.ts file in the project');
    return null;
  }

  return parseSprinklesFile(sprinklesFilePath);
};

module.exports = {
  findSprinklesFile,
  parseSprinklesFile,
  getSprinklesConfig
};
