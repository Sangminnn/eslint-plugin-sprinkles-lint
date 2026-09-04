#!/usr/bin/env node

/**
 * Generates the proven-solo-classes artifact consumed by the rule's
 * `provenSoloClassesPath` option. Run it before lint (e.g. as a CI step):
 *
 *   sprinkles-lint-analyze --root . --tsconfig tsconfig.json --out .sprinkles-lint/proven-solo-classes.json
 */

const fs = require('fs');
const path = require('path');
const { analyzeProject } = require('../src/analyzer/analyze');

const parseArgs = (argv) => {
  const options = { root: process.cwd(), tsconfig: null, out: '.sprinkles-lint/proven-solo-classes.json', exclude: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      const value = argv[(index += 1)];
      if (value === undefined || value.startsWith('--')) {
        console.error(`Missing value for ${argument}`);
        process.exit(1);
      }
      return value;
    };
    if (argument === '--root') options.root = next();
    else if (argument === '--tsconfig') options.tsconfig = next();
    else if (argument === '--out') options.out = next();
    else if (argument === '--exclude') options.exclude = next().split(',').filter(Boolean);
    else if (argument === '--help' || argument === '-h') {
      console.log('Usage: sprinkles-lint-analyze [--root dir] [--tsconfig path] [--out path] [--exclude glob,glob]');
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${argument}`);
      process.exit(1);
    }
  }
  return options;
};

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  const artifact = analyzeProject({ rootDir: options.root, tsconfigPath: options.tsconfig, exclude: options.exclude });

  const outPath = path.resolve(options.root, options.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);

  const provenCount = Object.values(artifact.provenSoloClasses).reduce((sum, names) => sum + names.length, 0);
  const unprovenCount = Object.values(artifact.unproven).reduce((sum, byName) => sum + Object.keys(byName).length, 0);
  console.log(`sprinkles-lint-analyze: ${provenCount} proven-solo, ${unprovenCount} unproven → ${path.relative(options.root, outPath) || outPath}`);

  if (artifact.unresolvedImports.length > 0 || artifact.unscannedImports.length > 0) {
    console.warn(
      `WARNING: ${artifact.unresolvedImports.length} unresolved and ${artifact.unscannedImports.length} unscanned imports — ` +
        'the import graph is incomplete, so the lint rule will refuse this artifact. Fix tsconfig paths/includes or excludes.',
    );
    for (const entry of [...artifact.unresolvedImports, ...artifact.unscannedImports].slice(0, 10)) {
      console.warn(`  - ${entry.file}: ${entry.specifier}`);
    }
  }
};

try {
  main();
} catch (error) {
  console.error(`sprinkles-lint-analyze: ${error.message}`);
  process.exit(1);
}
