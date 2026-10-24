const fs = require('fs');
const path = require('path');
const {
  isEmpty,
  isObject,
  isArray,
  isStyleArray,
  isVariable,
  hasSelectors,
  checkDefinedValueInSprinkles,
  separateProps,
  createTransformTemplate,
  isSprinklesCall,
  findSprinklesCallInArray,
  checkSeparatedCorrectly,
  hasNestedSelectors,
} = require('./utils');
const { getSprinklesConfig } = require('./sprinkles-discovery');
const { sha256 } = require('../analyzer/analyze');
const { getProvenSoloClassesFor, resolveUsageProject } = require('../analyzer/usage-cache');
const { deriveSprinklesImportSource } = require('../analyzer/import-source');

// CSS shorthands and the longhands they set. Two declarations compete when their longhands meet, so
// `margin` in a composed class and `marginTop` in an override are the same property for the guard.
// Logical properties map onto both physical sides they can resolve to, and legacy aliases onto the
// property they stand for, so the comparison errs toward "they compete".
const CSS_SHORTHAND_LONGHANDS = new Map(
  Object.entries({
    margin: ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'],
    marginBlock: ['marginTop', 'marginBottom'],
    marginBlockStart: ['marginTop', 'marginBottom'],
    marginBlockEnd: ['marginTop', 'marginBottom'],
    marginInline: ['marginLeft', 'marginRight'],
    marginInlineStart: ['marginLeft', 'marginRight'],
    marginInlineEnd: ['marginLeft', 'marginRight'],
    padding: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'],
    paddingBlock: ['paddingTop', 'paddingBottom'],
    paddingBlockStart: ['paddingTop', 'paddingBottom'],
    paddingBlockEnd: ['paddingTop', 'paddingBottom'],
    paddingInline: ['paddingLeft', 'paddingRight'],
    paddingInlineStart: ['paddingLeft', 'paddingRight'],
    paddingInlineEnd: ['paddingLeft', 'paddingRight'],
    inset: ['top', 'right', 'bottom', 'left'],
    insetBlock: ['top', 'bottom'],
    insetBlockStart: ['top', 'bottom'],
    insetBlockEnd: ['top', 'bottom'],
    insetInline: ['left', 'right'],
    insetInlineStart: ['left', 'right'],
    insetInlineEnd: ['left', 'right'],
    scrollMargin: ['scrollMarginTop', 'scrollMarginRight', 'scrollMarginBottom', 'scrollMarginLeft'],
    scrollPadding: ['scrollPaddingTop', 'scrollPaddingRight', 'scrollPaddingBottom', 'scrollPaddingLeft'],
    gap: ['rowGap', 'columnGap'],
    gridGap: ['rowGap', 'columnGap'],
    gridRowGap: ['rowGap'],
    gridColumnGap: ['columnGap'],
    flex: ['flexGrow', 'flexShrink', 'flexBasis'],
    flexFlow: ['flexDirection', 'flexWrap'],
    placeItems: ['alignItems', 'justifyItems'],
    placeContent: ['alignContent', 'justifyContent'],
    placeSelf: ['alignSelf', 'justifySelf'],
    grid: ['gridTemplate', 'gridAutoRows', 'gridAutoColumns', 'gridAutoFlow'],
    gridTemplate: ['gridTemplateRows', 'gridTemplateColumns', 'gridTemplateAreas'],
    gridArea: ['gridRow', 'gridColumn'],
    gridRow: ['gridRowStart', 'gridRowEnd'],
    gridColumn: ['gridColumnStart', 'gridColumnEnd'],
    overflow: ['overflowX', 'overflowY'],
    wordWrap: ['overflowWrap'],
    borderRadius: ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'],
    border: ['borderTop', 'borderRight', 'borderBottom', 'borderLeft'],
    borderBlock: ['borderTop', 'borderBottom'],
    borderBlockStart: ['borderTop', 'borderBottom'],
    borderBlockEnd: ['borderTop', 'borderBottom'],
    borderInline: ['borderLeft', 'borderRight'],
    borderInlineStart: ['borderLeft', 'borderRight'],
    borderInlineEnd: ['borderLeft', 'borderRight'],
    borderWidth: ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'],
    borderStyle: ['borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle'],
    borderColor: ['borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor'],
    borderTop: ['borderTopWidth', 'borderTopStyle', 'borderTopColor'],
    borderRight: ['borderRightWidth', 'borderRightStyle', 'borderRightColor'],
    borderBottom: ['borderBottomWidth', 'borderBottomStyle', 'borderBottomColor'],
    borderLeft: ['borderLeftWidth', 'borderLeftStyle', 'borderLeftColor'],
    background: ['backgroundColor', 'backgroundImage', 'backgroundPosition', 'backgroundSize', 'backgroundRepeat', 'backgroundAttachment', 'backgroundClip', 'backgroundOrigin'],
    font: ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'lineHeight'],
    outline: ['outlineWidth', 'outlineStyle', 'outlineColor'],
    textDecoration: ['textDecorationLine', 'textDecorationStyle', 'textDecorationColor', 'textDecorationThickness'],
    listStyle: ['listStyleType', 'listStylePosition', 'listStyleImage'],
    transition: ['transitionProperty', 'transitionDuration', 'transitionTimingFunction', 'transitionDelay'],
    animation: ['animationName', 'animationDuration', 'animationTimingFunction', 'animationDelay', 'animationIterationCount', 'animationDirection', 'animationFillMode', 'animationPlayState'],
  }),
);

const toLonghands = (propertyName) => {
  const longhands = CSS_SHORTHAND_LONGHANDS.get(propertyName);
  return longhands ? longhands.flatMap(toLonghands) : [propertyName];
};

// provenSoloClassesPath artifact (built by sprinkles-lint-analyze), cached and verified once per
// path+mtime. An artifact is refused outright — with a single warning — when the analyzer reported
// unresolved or unscanned imports, or when any input file on disk no longer matches its recorded
// hash (the proof is a statement about other files, so any consumer edit invalidates it).
const provenArtifactCache = new Map();
let warnedMissingArtifactPath = false;
const warnedArtifactPaths = new Set();
// Long-lived processes (editor LSP, watch mode) must not keep serving a proof after a consumer
// edit, so a passed verification only holds for a short window before the inputs are re-hashed.
const VERIFICATION_TTL_MS = 10_000;

const verifyProvenArtifact = (artifact, artifactPath) => {
  if (!artifact || artifact.version !== 1) {
    return { usable: false, warning: `unsupported artifact version in ${artifactPath}` };
  }
  if ((artifact.unresolvedImports || []).length > 0 || (artifact.unscannedImports || []).length > 0) {
    return {
      usable: false,
      warning: `artifact ${artifactPath} reports unresolved or unscanned imports — the import graph is incomplete, so no class is treated as proven`,
    };
  }
  if (artifact.tsconfigLoaded !== true) {
    return { usable: false, warning: `artifact ${artifactPath} was generated without a tsconfig — aliases were unresolvable, so no class is treated as proven` };
  }
  if (!artifact.inputs || Object.keys(artifact.inputs).length === 0) {
    return { usable: false, warning: `artifact ${artifactPath} records no inputs — staleness cannot be checked, so no class is treated as proven` };
  }

  const baseDir = artifact.root && fs.existsSync(artifact.root) ? artifact.root : process.cwd();
  for (const [relativePath, recordedHash] of Object.entries(artifact.inputs || {})) {
    let currentHash = null;
    try {
      currentHash = sha256(fs.readFileSync(path.resolve(baseDir, relativePath), 'utf8'));
    } catch (error) {
      currentHash = null;
    }
    if (currentHash !== recordedHash) {
      return {
        usable: false,
        warning: `proven-solo artifact is stale (${relativePath} changed since analysis) — re-run sprinkles-lint-analyze. Falling back to suggestions.`,
      };
    }
  }

  return { usable: true, baseDir };
};

const loadProvenSoloArtifact = (artifactPath) => {
  try {
    const stats = fs.statSync(artifactPath);
    const cached = provenArtifactCache.get(artifactPath);
    if (cached && cached.mtimeMs === stats.mtimeMs && Date.now() - cached.verifiedAt < VERIFICATION_TTL_MS) {
      return cached;
    }

    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    const verdict = verifyProvenArtifact(artifact, artifactPath);
    if (!verdict.usable && verdict.warning && !warnedArtifactPaths.has(artifactPath)) {
      warnedArtifactPaths.add(artifactPath);
      console.warn(`[sprinkles-lint] ${verdict.warning}`);
    }
    if (verdict.usable) {
      warnedArtifactPaths.delete(artifactPath);
    }

    const entry = { mtimeMs: stats.mtimeMs, verifiedAt: Date.now(), artifact: verdict.usable ? artifact : null, baseDir: verdict.baseDir };
    provenArtifactCache.set(artifactPath, entry);
    return entry;
  } catch (error) {
    if (error.code !== 'ENOENT' && !warnedArtifactPaths.has(artifactPath)) {
      warnedArtifactPaths.add(artifactPath);
      console.warn(`[sprinkles-lint] could not read proven-solo artifact ${artifactPath}: ${error.message}`);
    }
    return { mtimeMs: null, verifiedAt: 0, artifact: null, baseDir: null };
  }
};

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Use Sprinkles for predefined style properties',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          sprinklesConfig: {
            type: 'object',
            properties: {
              properties: {
                type: 'object',
                additionalProperties: {
                  oneOf: [
                    {
                      type: 'array',
                      items: {
                        oneOf: [{ type: 'string' }, { type: 'number' }],
                      },
                    },
                    {
                      type: 'object',
                      additionalProperties: {
                        type: 'string',
                      },
                    },
                  ],
                },
              },
              shorthands: {
                type: 'array',
                items: { type: 'string' },
              },
            },
          },
          configPath: {
            type: 'string',
          },
          sprinklesImportSource: {
            type: 'string',
          },
          hoistableOverrideProperties: {
            type: 'array',
            items: { type: 'string' },
          },
          provenSoloClassesPath: {
            type: 'string',
          },
          usageAnalysis: {
            enum: ['auto', 'artifact', 'off'],
          },
          projectRoot: {
            type: 'string',
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      useSprinkles: "🚨 '{{ property }}' is defined in Sprinkles. Use sprinkles property instead.",
      manualSeparationRequired:
        "'{{ property }}' can move to Sprinkles, but it sits in an override object composed with other classes. Moving it changes cascade order — move manually and verify the rendered result.",
      unprovenUsage:
        "'{{ property }}' can move to Sprinkles, but this class is not proven to be used alone. If an element also gets another class that sets the same property (a component's base style, for example), the move changes which value applies — move manually and verify the rendered result.",
      hoistToSprinkles: "Move '{{ property }}' into sprinkles() (verify this class is not overriding a composed class first)",
      removeStyle: 'Style wrapper should be removed',
    },
    fixable: 'code',
    hasSuggestions: true,
  },

  create(context) {
    const options = context.options[0] || {};
    const cwd = context.cwd || (typeof context.getCwd === 'function' ? context.getCwd() : process.cwd());
    const filename = context.getFilename();
    // lintText without a filePath has nothing on disk to analyse or to key an artifact by.
    const containingFile = filename && !filename.startsWith('<') ? path.resolve(cwd, filename) : null;

    // Discovery looks where it always has — the working directory — so an upgrade never moves the
    // sprinkles module out from under a project that relied on auto-discovery.
    const discoveryRoot = options.projectRoot ? path.resolve(cwd, options.projectRoot) : cwd;
    const config = getSprinklesConfig({ ...options, projectRoot: discoveryRoot, cwd });

    if (!config) {
      // If no config found, skip processing
      return {};
    }

    const { sprinklesConfig, shorthands } = config;

    const sourceCode = context.getSourceCode();

    // `auto` analyses the project in-process and caches the verdicts; `artifact` reads a file written
    // by sprinkles-lint-analyze beforehand; `off` skips proofs entirely. A pre-existing
    // `provenSoloClassesPath` keeps its old meaning without having to name the mode.
    const usageAnalysisMode = options.usageAnalysis || (options.provenSoloClassesPath ? 'artifact' : 'auto');

    // Classes the analyzer proved are only ever used standalone. Resolved lazily at the first guard
    // hit; anything unusable or stale yields null, falling back to suggestion-only behavior.
    let provenSoloClassesCache;
    const resolveProvenSoloClasses = () => {
      if (usageAnalysisMode === 'off') {
        return null;
      }

      if (!containingFile) {
        return null;
      }

      if (usageAnalysisMode === 'auto') {
        return getProvenSoloClassesFor({ containingFile, cwd, projectRoot: options.projectRoot });
      }

      if (!options.provenSoloClassesPath) {
        if (!warnedMissingArtifactPath) {
          warnedMissingArtifactPath = true;
          console.warn("[sprinkles-lint] usageAnalysis: 'artifact' needs provenSoloClassesPath — no class is treated as proven");
        }
        return null;
      }

      const artifactPath = path.resolve(cwd, options.provenSoloClassesPath);
      const { artifact, baseDir } = loadProvenSoloArtifact(artifactPath);
      if (!artifact) {
        return null;
      }

      const absoluteFilename = path.resolve(cwd, filename);
      const relativeFilename = path.relative(baseDir || cwd, absoluteFilename).split(path.sep).join('/');
      return new Set(artifact.provenSoloClasses?.[relativeFilename] || []);
    };
    const getProvenSoloClasses = () => {
      if (provenSoloClassesCache === undefined) {
        provenSoloClassesCache = resolveProvenSoloClasses();
      }
      return provenSoloClassesCache;
    };

    const separateWithConfig = (properties) =>
      separateProps({
        sprinklesConfig,
        shorthands: shorthands ? [...shorthands] : undefined,
        properties,
        sourceCode,
      });

    // When props already inside sprinkles() are merged with the style object for re-separation,
    // the message should only name the props that are about to move into sprinkles().
    const listPropsMovingIntoSprinkles = (sprinklesProps, sprinklesCall) => {
      const existingNames = (sprinklesCall?.arguments?.[0]?.properties || []).map((prop) => prop.key.name || prop.key.value);
      const movingNames = Object.keys(sprinklesProps).filter((name) => !existingNames.includes(name));
      const names = movingNames.length > 0 ? movingNames : Object.keys(sprinklesProps);

      return names.join(', ');
    };

    const programBody = sourceCode.ast.body;
    const importsSprinkles = (statement) =>
      statement.type === 'ImportDeclaration' && statement.specifiers.some((specifier) => specifier.local?.name === 'sprinkles');
    // Imports hoist, so the whole program body is checked instead of relying on traversal order.
    const hasSprinklesImport = programBody.some(importsSprinkles);

    const isDirective = (statement) => statement.type === 'ExpressionStatement' && typeof statement.directive === 'string';
    const firstNonDirectiveStatement = programBody.find((statement) => !isDirective(statement));

    // The project already says where `sprinkles` lives: reversing the tsconfig `paths` mapping onto the
    // discovered module gives the same specifier the rest of the codebase writes, so the option is only
    // needed when that mapping is ambiguous or absent.
    let sprinklesImportSourceCache;
    const getSprinklesImportSource = () => {
      if (options.sprinklesImportSource) {
        return options.sprinklesImportSource;
      }
      if (sprinklesImportSourceCache === undefined) {
        sprinklesImportSourceCache = containingFile
          ? deriveSprinklesImportSource({
              sprinklesFilePath: config.sprinklesFilePath,
              tsconfigPath: resolveUsageProject({ containingFile, cwd, projectRoot: options.projectRoot }).tsconfigPath,
              containingFile,
            })
          : null;
      }
      return sprinklesImportSourceCache;
    };

    // Inserting `sprinkles(...)` into a file that never imports it produces code that does not compile.
    // Fixes that emit a sprinkles call are offered as-is when the import is present, extended with an
    // import insertion when `sprinklesImportSource` is configured, and withheld otherwise.
    const withSprinklesImport = (buildFix) => {
      if (hasSprinklesImport) {
        return buildFix;
      }

      const importSource = getSprinklesImportSource();
      if (!importSource || !firstNonDirectiveStatement) {
        return undefined;
      }

      return (fixer) => {
        const importStatement = `import { sprinkles } from '${importSource}';\n`;
        const insertImport = fixer.insertTextBefore(firstNonDirectiveStatement, importStatement);

        return [].concat(buildFix(fixer), insertImport);
      };
    };

    // ---- Hoist guard ---------------------------------------------------------------------------
    // Moving a property into sprinkles() turns a rule declared in this file into an atom near the top
    // of the stylesheet. That only goes unnoticed when nothing else on the element sets the same
    // property, so every style() autofix asks two questions: does a class composed into this one set
    // it (then the property stays in the style object), and can an unknown class meet this one on an
    // element (then the move is offered as a suggestion that --fix never applies).

    const propertyName = (prop) => (prop.type === 'Property' && prop.key ? String(prop.key.name ?? prop.key.value) : null);

    // `globalStyle(`${base} …`, {...})` adds rules to a class from outside its declaration, so the
    // declaration alone no longer says what the class sets.
    const isInsideGlobalStyleSelector = (identifier) => {
      for (let node = identifier; node.parent; node = node.parent) {
        const parent = node.parent;
        if (parent.type === 'CallExpression' && parent.callee.name === 'globalStyle') return parent.arguments[0] === node;
      }
      return false;
    };

    // A composed identifier is only followed when it names a module-level `const x = …` whose rules
    // are all in that initializer: a parameter or nested binding that shadows it, a destructured or
    // reassigned binding, or a class extended through globalStyle is something the rule cannot read.
    const findModuleInitializer = (identifier) => {
      let scope = sourceCode.getScope ? sourceCode.getScope(identifier) : context.getScope();
      while (scope) {
        const variable = scope.set.get(identifier.name);
        if (variable) {
          const isModuleScope = scope.type === 'module' || scope.type === 'global';
          const definition = variable.defs.length === 1 ? variable.defs[0] : null;
          const isPlainConst =
            definition && definition.type === 'Variable' && definition.parent.kind === 'const' && definition.node.id.type === 'Identifier';
          const isExtendedElsewhere = variable.references.some((reference) => isInsideGlobalStyleSelector(reference.identifier));
          return isModuleScope && isPlainConst && !isExtendedElsewhere ? definition.node.init : null;
        }
        scope = scope.upper;
      }
      return null;
    };

    const sprinklesShorthandNames = new Set(shorthands || []);
    const NESTED_CONDITION_KEYS = ['@media', '@supports', '@container'];

    // What composed classes set, as `{ longhands, isComplete }`. Whatever could be read is always kept,
    // so a known overlap stays pinned even when another part is unreadable; `isComplete` says whether
    // the set is the whole story (a spread, a computed key, an import or a sprinkles shorthand whose
    // mapping is unknown make it partial).
    const UNREADABLE = { longhands: new Set(), isComplete: false };
    const COMPLETE_EMPTY = { longhands: new Set(), isComplete: true };
    const mergeComposed = (parts) => ({
      longhands: new Set(parts.flatMap((part) => [...part.longhands])),
      isComplete: parts.every((part) => part.isComplete),
    });

    /** Longhands an object literal sets at the top level or under a condition that does not raise specificity. */
    const readObjectLonghands = (properties, isSprinklesArgument) => {
      const parts = [];
      const readNested = (value) => (isObject(value) ? readObjectLonghands(value.properties, false) : UNREADABLE);

      for (const prop of properties) {
        if (prop.type !== 'Property' || prop.computed) {
          parts.push(UNREADABLE);
          continue;
        }
        const name = propertyName(prop);
        if (isSprinklesArgument && sprinklesShorthandNames.has(name)) {
          parts.push(UNREADABLE);
          continue;
        }

        // A bare `&` keeps the class's specificity, so it competes on sheet order like the top level.
        if (name === 'selectors') {
          const sameSpecificity = isObject(prop.value) ? prop.value.properties.find((selector) => propertyName(selector) === '&') : null;
          if (!isObject(prop.value)) parts.push(UNREADABLE);
          else if (sameSpecificity) parts.push(readNested(sameSpecificity.value));
          continue;
        }

        // Other selectors raise specificity and `@layer` lowers it, so neither competes on sheet order.
        const isSelectorKey = name.startsWith(':') || name.startsWith('&');
        if (isSelectorKey || name === 'vars' || name === '@layer') continue;

        if (NESTED_CONDITION_KEYS.includes(name)) {
          const conditions = isObject(prop.value) ? prop.value.properties : null;
          parts.push(...(conditions ? conditions.map((condition) => (condition.type === 'Property' ? readNested(condition.value) : UNREADABLE)) : [UNREADABLE]));
          continue;
        }

        parts.push({ longhands: new Set(toLonghands(name)), isComplete: true });
      }
      return mergeComposed(parts);
    };

    /** What composed elements set, following same-file declarations. */
    const readComposedLonghands = (elements, visitedNames = new Set()) => {
      const parts = elements.map((element) => {
        if (isObject(element)) return readObjectLonghands(element.properties, false);
        if (isSprinklesCall(element)) {
          const argument = element.arguments[0];
          return isObject(argument) ? readObjectLonghands(argument.properties, true) : UNREADABLE;
        }
        if (isArray(element)) return readComposedLonghands(element.elements, visitedNames);
        if (element && element.type === 'CallExpression' && element.callee.name === 'style') {
          return readComposedLonghands([element.arguments[0]], visitedNames);
        }
        if (element && element.type === 'Identifier') {
          if (visitedNames.has(element.name)) return { longhands: new Set(), isComplete: true };
          visitedNames.add(element.name);
          const initializer = findModuleInitializer(element);
          return initializer ? readComposedLonghands([initializer], visitedNames) : UNREADABLE;
        }
        return UNREADABLE;
      });
      return mergeComposed(parts);
    };

    const setsAnyOf = (name, longhands) => toLonghands(name).some((longhand) => longhands.has(longhand));

    /** Names in `properties` that set a longhand a composed class is known to set. */
    const findOverlappingNames = (properties, composed) =>
      new Set(properties.map(propertyName).filter((name) => name && setsAnyOf(name, composed.longhands)));

    /**
     * separateWithConfig, except that some properties stay in the style object, in their original order:
     * `overridingNames` (overrides of a composed class), and any property that shares a longhand with one
     * left behind (`margin` stays, so `marginRight` next to it cannot become an atom that `margin` beats).
     */
    const separateKeepingOverrides = (properties, overridingNames) => {
      const keptNames = new Set(overridingNames);
      let separated = separateWithConfig(properties.filter((prop) => !keptNames.has(propertyName(prop))));

      for (;;) {
        const keptLonghands = new Set([...Object.keys(separated.remainingProps), ...keptNames].flatMap(toLonghands));
        const sharingNames = Object.keys(separated.sprinklesProps).filter((name) => setsAnyOf(name, keptLonghands));
        if (sharingNames.length === 0) break;
        sharingNames.forEach((name) => keptNames.add(name));
        separated = separateWithConfig(properties.filter((prop) => !keptNames.has(propertyName(prop))));
      }
      if (keptNames.size === 0) return separated;

      const remainingProps = {};
      for (const prop of properties) {
        const name = propertyName(prop);
        if (!name || name in separated.sprinklesProps || name in remainingProps) continue;
        if (keptNames.has(name)) remainingProps[name] = sourceCode.getText(prop.value);
        else if (name in separated.remainingProps) remainingProps[name] = separated.remainingProps[name];
      }
      return { sprinklesProps: separated.sprinklesProps, remainingProps };
    };

    // The artifact only lists module-level exports; a nested declaration that happens to share the
    // name must not inherit the proof.
    const getExportedClassName = (styleCall) => {
      const declarator = styleCall.parent;
      const declarationList = declarator && declarator.type === 'VariableDeclarator' ? declarator.parent : null;
      const exportStatement = declarationList && declarationList.type === 'VariableDeclaration' ? declarationList.parent : null;
      const isModuleLevelExport = exportStatement && exportStatement.type === 'ExportNamedDeclaration' && exportStatement.parent.type === 'Program';
      return isModuleLevelExport && declarator.id.type === 'Identifier' ? declarator.id.name : null;
    };

    // Escape hatch: the plugin cannot see component bases, but the project can — properties it declares
    // as never set by a component base take the autofix path. It only speaks for what the rule cannot
    // see on the element; a composed class the rule cannot read keeps the move a suggestion, and one it
    // can read keeps its overlapping properties in place.
    const hoistableProperties = new Set(options.hoistableOverrideProperties || []);
    const isAllowlisted = (names) => names.every((name) => hoistableProperties.has(name));

    // Usage-aware proof: the analyzer showed this class is only ever used standalone, so no other
    // class can meet it on an element. A class composed inside its own file is never proven.
    const isUsageProven = (styleCall) => {
      const exportedName = getExportedClassName(styleCall);
      const provenSoloClasses = exportedName ? getProvenSoloClasses() : null;
      return Boolean(provenSoloClasses && provenSoloClasses.has(exportedName));
    };

    // The transformation is mechanical; only the decision to apply it needs the call sites, so it is
    // offered as an IDE suggestion that never runs under --fix. (ESLint builds suggestion fixes eagerly.)
    const reportHoistSuggestion = ({ node, messageId, property, suggestionFix }) =>
      context.report({
        node,
        messageId,
        data: { property },
        ...(suggestionFix ? { suggest: [{ messageId: 'hoistToSprinkles', data: { property }, fix: suggestionFix }] } : {}),
      });


    // ---- Composed values inside recipe() and styleVariants() --------------------------------------
    // A variant class lands on the element together with base and one value of every other group; a
    // styleVariants entry lands with the classes composed next to it. These classes never carry a usage
    // proof (they are reached through calls and member access), so only the structure inside the call
    // is checked: a property something else on the element sets stays in the style object, and a value
    // the rule cannot read leaves the move to a suggestion.

    const reportComposedHoist = ({ node, property, hoistFix, canFix }) => {
      if (canFix) {
        context.report({ node, messageId: 'useSprinkles', data: { property }, fix: hoistFix });
        return;
      }
      reportHoistSuggestion({ node, messageId: 'manualSeparationRequired', property, suggestionFix: hoistFix });
    };

    /** `{ ... }` whose properties may move into sprinkles(), given what else sets properties on the element. */
    const checkComposedObject = ({ objectNode, composed, keepsArray = false }) => {
      const overridingNames = findOverlappingNames(objectNode.properties, composed);
      const { sprinklesProps, remainingProps } = separateKeepingOverrides(objectNode.properties, overridingNames);
      if (isEmpty(sprinklesProps)) return;

      const hoistFix = withSprinklesImport((fixer) =>
        fixer.replaceText(objectNode, createTransformTemplate({ sourceCode, sprinklesProps, remainingProps, isArrayContext: keepsArray || !isEmpty(remainingProps) })),
      );
      reportComposedHoist({ node: objectNode, property: Object.keys(sprinklesProps).join(', '), hoistFix, canFix: composed.isComplete });
    };

    /** `[...classes, sprinkles({...}), {...}]`, the same decision for an array value. */
    const checkComposedArray = ({ arrayNode, targetNode = arrayNode, outside, keepsArray = false, wrapperNode = targetNode, unwrapsToSprinkles = false, isFixAllowed = () => true }) => {
      const elements = arrayNode.elements || [];
      const sprinklesCall = findSprinklesCallInArray(arrayNode);

      // A wrapper around nothing but sprinkles() adds no rule of its own, so dropping it changes no cascade.
      if (sprinklesCall && elements.length === 1) {
        context.report({ node: wrapperNode, messageId: 'removeStyle', fix: (fixer) => fixer.replaceText(wrapperNode, sourceCode.getText(sprinklesCall)) });
        return;
      }

      const objects = elements.filter(isObject);
      const composedElements = elements.filter((element) => !isObject(element));
      const variables = composedElements.filter((element) => element && element !== sprinklesCall && isVariable(element));
      const sprinklesProperties = sprinklesCall?.arguments?.[0]?.properties || [];
      const objectProperties = objects.flatMap((object) => object.properties);
      if (objectProperties.length === 0 && sprinklesProperties.length === 0) return;

      try {
        if (sprinklesCall && objects.length > 0) {
          const isSeparatedCorrectly = checkSeparatedCorrectly({
            sprinklesConfig,
            shorthands: shorthands ? [...shorthands] : undefined,
            sourceCode,
            sprinklesProps: sprinklesProperties,
            remainingProps: objectProperties,
          });
          if (isSeparatedCorrectly) return;
        }

        // The sprinkles() call counts as composed too: an object property sharing a longhand with one of
        // its atoms overrides that atom.
        const composed = mergeComposed([readComposedLonghands(composedElements), outside]);
        const overridingNames = findOverlappingNames(objectProperties, composed);
        // Only style-object properties move. What is already in sprinkles() stays there: moving it out would
        // change what it competes with, and a conditional value ({ mobile, desktop }) is not a style rule.
        const moving = separateKeepingOverrides(objectProperties, overridingNames);
        if (isEmpty(moving.sprinklesProps)) return;

        // The template rebuilds the value from the variables, one sprinkles() call and one merged object;
        // anything else, an unreadable sprinkles() key, or a name the merge would see twice (it keeps the
        // first) would change the result.
        const sprinklesNames = new Set(sprinklesProperties.map(propertyName));
        const objectNames = objectProperties.map(propertyName);
        const declaresNameTwice =
          new Set(objectNames).size !== objectNames.length || Object.keys(moving.sprinklesProps).some((name) => sprinklesNames.has(name));
        const readsSprinklesCall = sprinklesProperties.every((prop) => prop.type === 'Property' && !prop.computed);
        const keepsEveryElement = composedElements.every((element) => element === sprinklesCall || (element && isVariable(element)));
        const canTransform = keepsEveryElement && readsSprinklesCall && !declaresNameTwice;
        const merged = {
          sprinklesProps: {
            ...Object.fromEntries(sprinklesProperties.map((prop) => [propertyName(prop), sourceCode.getText(prop.value)])),
            ...moving.sprinklesProps,
          },
          remainingProps: moving.remainingProps,
        };

        // A wrapper left holding only sprinkles() adds no rule of its own, so it is dropped when allowed.
        const leavesOnlySprinkles = isEmpty(merged.remainingProps) && variables.length === 0;
        const replacedNode = unwrapsToSprinkles && leavesOnlySprinkles ? wrapperNode : targetNode;
        const hoistFix = canTransform
          ? withSprinklesImport((fixer) =>
              fixer.replaceText(
                replacedNode,
                createTransformTemplate({
                  sourceCode,
                  variables,
                  sprinklesProps: merged.sprinklesProps,
                  remainingProps: merged.remainingProps,
                  isArrayContext: replacedNode === targetNode && (keepsArray || !leavesOnlySprinkles),
                }),
              ),
            )
          : undefined;

        reportComposedHoist({
          node: wrapperNode,
          property: Object.keys(moving.sprinklesProps).join(', '),
          hoistFix,
          canFix: canTransform && composed.isComplete && isFixAllowed(Object.keys(moving.sprinklesProps)),
        });
      } catch (error) {
        // if error, continue
      }
    };

    const isStyleCall = (node) => node?.type === 'CallExpression' && node.callee.name === 'style';

    /** A variant group as `{ values, isReadable }`; a spread or a group that is not an object literal is unreadable. */
    const readVariantGroup = (group) => {
      const options = group.type === 'Property' && !group.computed && isObject(group.value) ? group.value.properties : null;
      return {
        values: options ? options.filter((option) => option.type === 'Property').map((option) => option.value) : [],
        isReadable: Boolean(options) && options.every((option) => option.type === 'Property' && !option.computed),
      };
    };

    /** What a variant value sets outside its own inline style objects: composed classes and sprinkles() atoms. */
    const readNonInlineValue = (value) => {
      if (isObject(value)) return COMPLETE_EMPTY;
      if (isArray(value)) return readComposedLonghands(value.elements.filter((element) => !isObject(element)));
      return readComposedLonghands([value]);
    };

    const readCompoundVariantsNonInline = (compoundVariantsProperty) => {
      if (!compoundVariantsProperty) return COMPLETE_EMPTY;
      if (!isArray(compoundVariantsProperty.value)) return UNREADABLE;
      return mergeComposed(
        compoundVariantsProperty.value.elements.map((entry) => {
          const styleProperty = isObject(entry) ? entry.properties.find((prop) => propertyName(prop) === 'style') : null;
          return styleProperty ? readNonInlineValue(styleProperty.value) : UNREADABLE;
        }),
      );
    };

    // base and variant values written as style() inside recipe() are checked by the recipe path, which
    // knows what else lands on the element.
    const isRecipeBaseOrVariantValue = (styleCall) => {
      const option = styleCall.parent;
      if (!option || option.type !== 'Property' || option.value !== styleCall) return false;
      const isRecipeArgument = (objectNode) => objectNode?.type === 'ObjectExpression' && objectNode.parent?.type === 'CallExpression' && objectNode.parent.callee.name === 'recipe';

      if (propertyName(option) === 'base' && isRecipeArgument(option.parent)) return true;
      const groupProperty = option.parent?.parent;
      const variantsProperty = groupProperty?.parent?.parent;
      return Boolean(groupProperty?.type === 'Property' && variantsProperty?.type === 'Property' && propertyName(variantsProperty) === 'variants' && isRecipeArgument(variantsProperty.parent));
    };

    return {
      CallExpression(node) {
        // using style
        if (node.callee.name === 'style' && !isRecipeBaseOrVariantValue(node)) {
          // if style({}), {} is node.arguments[0]
          const styleArgument = node.arguments[0];

          // Case. style({})
          if (isObject(styleArgument)) {
            try {
              const { sprinklesProps, remainingProps } = separateKeepingOverrides(styleArgument.properties, new Set());

              if (isEmpty(sprinklesProps)) {
                return;
              }

              const movableNames = Object.keys(sprinklesProps);
              const targetProperties = movableNames.join(', ');
              const hoistFix = withSprinklesImport((fixer) => {
                return fixer.replaceText(
                  node,
                  createTransformTemplate({
                    sourceCode,
                    sprinklesProps,
                    remainingProps,
                  }),
                );
              });

              // A standalone style() still meets whatever else its element gets: a component's base
              // class, or another class in clsx(). Only a proven or in-file-only class is moved by --fix.
              if (!isAllowlisted(movableNames) && !isUsageProven(node)) {
                reportHoistSuggestion({ node: styleArgument, messageId: 'unprovenUsage', property: targetProperties, suggestionFix: hoistFix });
                return;
              }

              context.report({
                node: styleArgument,
                messageId: 'useSprinkles',
                data: {
                  property: targetProperties,
                },
                fix: hoistFix,
              });
            } catch (error) {
              // if error, continue
            }
          }

          // Case. style([])
          if (isArray(styleArgument)) {
            const sprinklesCall = findSprinklesCallInArray(styleArgument);
            const variables = styleArgument?.elements?.filter((element) => element && element !== sprinklesCall && isVariable(element));
            const isEmptySprinkles = !sprinklesCall || !sprinklesCall.arguments?.[0];

            // already use sprinkles but some properties are in style object not in sprinkles
            if (sprinklesCall) {
              if (isEmptySprinkles) return;
              const sprinklesProperties = sprinklesCall?.arguments?.[0]?.properties || [];
              const nonSprinklesProperties = styleArgument.elements.filter(isObject).flatMap((element) => element.properties);

              try {
                const isSeparatedCorrectly = checkSeparatedCorrectly({
                  sprinklesConfig,
                  shorthands: shorthands ? [...shorthands] : undefined,
                  sourceCode,
                  sprinklesProps: sprinklesProperties,
                  remainingProps: nonSprinklesProperties,
                });

                // if sprinkles and nonSprinkles are separated correctly, return instantly
                if (isSeparatedCorrectly) {
                  const hasSprinklesOnly = styleArgument.elements.length === 1 && styleArgument.elements[0] === sprinklesCall;
                  if (hasSprinklesOnly) {
                    context.report({
                      node,
                      messageId: 'removeStyle',
                      fix(fixer) {
                        return sprinklesCall ? fixer.replaceText(node, sourceCode.getText(sprinklesCall)) : fixer.replaceText(node, `[]`);
                      },
                    });
                  }

                  return;
                }
              } catch (error) {
                // if error, continue
              }

              // sprinkles() holding nothing but literal values the config does not define does not type-check
              // as sprinkles; those values become the style object they were meant to be.
              const hasStyleObject = styleArgument.elements.some(isObject);
              const sprinklesArgumentProperties = sprinklesCall.arguments[0].properties || [];
              const isUndefinedLiteral = (prop) =>
                prop.type === 'Property' &&
                !prop.computed &&
                prop.value.type === 'Literal' &&
                !checkDefinedValueInSprinkles({ sprinklesConfig, shorthands: shorthands ? [...shorthands] : undefined, propName: propertyName(prop), value: sourceCode.getText(prop.value) });
              if (!hasStyleObject && sprinklesArgumentProperties.length > 0 && sprinklesArgumentProperties.every(isUndefinedLiteral)) {
                const styleObjectText = `{\n  ${sprinklesArgumentProperties.map((prop) => `${sourceCode.getText(prop.key)}: ${sourceCode.getText(prop.value)}`).join(',\n  ')}\n}`;
                const keptElements = styleArgument.elements.filter((element) => element !== sprinklesCall);
                const canKeepElements = keptElements.every((element) => element && isVariable(element));
                context.report({
                  node,
                  messageId: 'useSprinkles',
                  data: { property: 'all' },
                  fix: canKeepElements
                    ? (fixer) =>
                        fixer.replaceText(
                          node,
                          keptElements.length === 0
                            ? `style(${styleObjectText})`
                            : `style([${keptElements.map((element) => sourceCode.getText(element)).join(', ')}, ${styleObjectText}])`,
                        )
                    : undefined,
                });
                return;
              }

              // A sprinkles atom and a local style() rule share the same specificity, so the winner is decided
              // by sheet order. Same decision as recipe() values, plus the usage proof: a style() class can
              // meet classes outside this file, so --fix also needs the allowlist or a proven solo class.
              checkComposedArray({
                arrayNode: styleArgument,
                outside: COMPLETE_EMPTY,
                keepsArray: true,
                wrapperNode: node,
                unwrapsToSprinkles: true,
                isFixAllowed: (movableNames) => isAllowlisted(movableNames) || isUsageProven(node),
              });
              return;
            }

            // not use sprinkles and use only style object, but some properties have to place in sprinkles
            if (!sprinklesCall) {
              const elements = styleArgument.elements || [];
              const objectElements = elements.filter(isObject);
              const composedElements = elements.filter((element) => !isObject(element));
              const composed = readComposedLonghands(composedElements);
              // The template rebuilds the array from the variables and one object, so any other shape
              // (a second object, a spread, a nested array) would lose code.
              const canRebuildArray = objectElements.length === 1 && composedElements.every((element) => element && isVariable(element));

              objectElements.forEach((element) => {
                if (hasSelectors(element.properties)) {
                  return;
                }

                try {
                  const overridingNames = findOverlappingNames(element.properties, composed);
                  const { sprinklesProps, remainingProps } = separateKeepingOverrides(element.properties, overridingNames);

                  if (isEmpty(sprinklesProps)) {
                    return;
                  }

                  const movableNames = Object.keys(sprinklesProps);
                  const targetProperties = movableNames.join(', ');
                  const hoistFix = canRebuildArray
                    ? withSprinklesImport((fixer) => {
                        return fixer.replaceText(
                          node,
                          createTransformTemplate({
                            sourceCode,
                            variables,
                            sprinklesProps,
                            remainingProps,
                          }),
                        );
                      })
                    : undefined;

                  // Same guard as an array that already calls sprinkles(): the object may be overriding
                  // the classes composed next to it.
                  const canFix = canRebuildArray && composed.isComplete && (isAllowlisted(movableNames) || isUsageProven(node));
                  if (!canFix) {
                    const messageId = composedElements.length > 0 ? 'manualSeparationRequired' : 'unprovenUsage';
                    reportHoistSuggestion({ node, messageId, property: targetProperties, suggestionFix: hoistFix });
                    return;
                  }

                  context.report({
                    node,
                    messageId: 'useSprinkles',
                    data: {
                      property: targetProperties,
                    },
                    fix: hoistFix,
                  });
                } catch (error) {
                  // if error, continue
                }
              });
            }
          }
        }

        // using recipe
        if (node.callee.name === 'recipe') {
          const recipeArgument = node.arguments[0];
          if (!isObject(recipeArgument)) return;
          const findOption = (name) => recipeArgument.properties.find((prop) => propertyName(prop) === name);
          const baseProperty = findOption('base');
          const variantsProperty = findOption('variants');
          const compoundVariantsProperty = findOption('compoundVariants');
          // A spread (`...shared`) may carry base, variants or compoundVariants the rule cannot see.
          const hasUnreadableOptions = recipeArgument.properties.some((prop) => prop.type !== 'Property' || prop.computed);

          const variantGroups = !variantsProperty ? [] : isObject(variantsProperty.value) ? variantsProperty.value.properties.map(readVariantGroup) : null;
          const unreadableRecipeParts = hasUnreadableOptions || variantGroups === null ? [UNREADABLE] : [];

          /**
           * base: variants written inline are generated after base and still win once base is an atom. What
           * can beat a base atom is a value that is not an inline style object — a class declared before the
           * recipe or a sprinkles() atom — in a variant or a compound variant.
           */
          if (baseProperty) {
            const baseOutside = mergeComposed([
              ...unreadableRecipeParts,
              ...(variantGroups || []).map((group) => (group.isReadable ? mergeComposed(group.values.map(readNonInlineValue)) : UNREADABLE)),
              readCompoundVariantsNonInline(compoundVariantsProperty),
            ]);
            const baseValue = baseProperty.value;

            if (isStyleArray(baseValue)) {
              checkComposedArray({ arrayNode: baseValue.arguments[0], outside: baseOutside, keepsArray: true, wrapperNode: baseValue });
            } else if (isStyleCall(baseValue) && isObject(baseValue.arguments[0])) {
              checkComposedObject({ objectNode: baseValue.arguments[0], composed: baseOutside, keepsArray: true });
            } else if (isArray(baseValue)) {
              checkComposedArray({ arrayNode: baseValue, outside: baseOutside });
            } else if (isObject(baseValue)) {
              checkComposedObject({ objectNode: baseValue, composed: baseOutside });
            }
          }

          /** variants: each value meets base and one value of every other group */
          if (variantGroups) {
            const baseComposed = baseProperty ? readComposedLonghands([baseProperty.value]) : COMPLETE_EMPTY;

            variantGroups.forEach((group) => {
              const otherGroups = variantGroups
                .filter((other) => other !== group)
                .map((other) => (other.isReadable ? readComposedLonghands(other.values) : UNREADABLE));
              const outside = mergeComposed([...unreadableRecipeParts, baseComposed, ...otherGroups]);

              group.values.forEach((variantValue) => {
                if (isObject(variantValue)) {
                  checkComposedObject({ objectNode: variantValue, composed: outside });
                } else if (isArray(variantValue)) {
                  checkComposedArray({ arrayNode: variantValue, outside });
                } else if (isStyleArray(variantValue)) {
                  checkComposedArray({ arrayNode: variantValue.arguments[0], outside, keepsArray: true, wrapperNode: variantValue });
                } else if (isStyleCall(variantValue) && isObject(variantValue.arguments[0])) {
                  checkComposedObject({ objectNode: variantValue.arguments[0], composed: outside, keepsArray: true });
                }
              });
            });
          }
        }

        // using styleVariants
        if (node.callee.name === 'styleVariants') {
          const checkVariantStyle = (value) => {
            if (isObject(value)) {
              if (hasSelectors(value.properties) || hasNestedSelectors(value.properties)) return;
              checkComposedObject({ objectNode: value, composed: COMPLETE_EMPTY });
            } else if (isArray(value)) {
              checkComposedArray({ arrayNode: value, outside: COMPLETE_EMPTY });
            }
          };

          // First argument is an object literal: { primary: { ... }, secondary: [base, { ... }] }
          const styleVariantsArgument = node.arguments[0];
          if (isObject(styleVariantsArgument)) {
            styleVariantsArgument.properties.filter((variantProp) => variantProp.type === 'Property').forEach((variantProp) => checkVariantStyle(variantProp.value));
          }

          // Mapping function: styleVariants(map, (value) => ...), with an expression or a block body
          const mapper = node.arguments[1];
          if (mapper && (mapper.type === 'ArrowFunctionExpression' || mapper.type === 'FunctionExpression')) {
            const isBlockBody = mapper.body.type === 'BlockStatement';
            const returnStatement = isBlockBody ? mapper.body.body.find((statement) => statement.type === 'ReturnStatement') : null;
            checkVariantStyle(isBlockBody ? returnStatement?.argument : mapper.body);
          }
        }
      },
    };
  },
};
