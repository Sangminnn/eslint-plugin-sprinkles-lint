/**
 * Unit tests for the usage-aware solo-class analyzer (plan cases U-A … U-H2).
 * Runs the analyzer over src/tests/analyzer-fixtures and asserts every verdict.
 */

const assert = require('assert');
const path = require('path');
const { analyzeProject } = require('../analyzer/analyze');

const fixtureRoot = path.join(__dirname, 'analyzer-fixtures');
const artifact = analyzeProject({ rootDir: fixtureRoot, tsconfigPath: 'tsconfig.json' });

const STYLES = 'src/styles.css.ts';
const DYNAMIC = 'src/dynamic.css.ts';
const proven = (file) => artifact.provenSoloClasses[file] || [];
const unproven = (file) => artifact.unproven[file] || {};

const cases = [];
const test = (name, run) => cases.push({ name, run });

test('U-A. sole className on an intrinsic tag → proven', () => {
  assert.ok(proven(STYLES).includes('soloA2'));
});

test('U-A2. several usages, every one solo (including via tsconfig paths alias) → proven', () => {
  assert.ok(proven(STYLES).includes('soloA'));
});

test('U-B. className passed to a component → unproven with the component named', () => {
  assert.strictEqual(unproven(STYLES).composedB, 'composed-with-component:Button');
});

test('U-C. clsx composition and conditional composition → unproven', () => {
  assert.strictEqual(unproven(STYLES).clsxC1, 'composed-in-call:clsx');
  assert.strictEqual(unproven(STYLES).clsxC2, 'composed-in-call:clsx');
  assert.ok(unproven(STYLES).condC3, 'conditional usage must be unproven');
});

test('U-D. aliased to a variable first → unproven', () => {
  assert.strictEqual(unproven(STYLES).aliasVia, 'aliased-to-variable');
});

test('U-E. non-className prop → unproven with the prop named', () => {
  assert.strictEqual(unproven(STYLES).skeletonE, 'non-className-prop:containerClassName');
});

test('U-F. object literal / spread route → unproven', () => {
  assert.strictEqual(unproven(STYLES).spreadF, 'object-literal');
});

test('U-G. dynamic access poisons every export of that file', () => {
  assert.strictEqual(unproven(DYNAMIC).dynG1, 'dynamic-access');
  assert.strictEqual(unproven(DYNAMIC).dynG2, 'dynamic-access');
  assert.strictEqual(proven(DYNAMIC).length, 0);
});

test('U-G2. namespace escaping through a cast is poisoned too', () => {
  assert.strictEqual(unproven('src/dynamic2.css.ts').dynCast, 'namespace-escapes');
});

test('U-H1. usage through a re-export is followed and classified', () => {
  assert.ok(proven(STYLES).includes('reexportedH'));
});

test('U-H2. no usage found (closed world) → proven', () => {
  assert.ok(proven(STYLES).includes('unusedU'));
});

test('U-paths. tsconfig paths alias is really resolved: alias-only composition is unproven', () => {
  assert.strictEqual(unproven(STYLES).aliasOnlyComposed, 'composed-with-component:Button');
});

test('C1. styleVariants member access is never dropped → unproven', () => {
  assert.strictEqual(unproven(STYLES).variantsMap, 'property-access-chain');
});

test('C2. composition inside the declaring css.ts → unproven; the unused composer stays proven', () => {
  assert.strictEqual(unproven(STYLES).intraBase, 'referenced-within-css-file');
  assert.ok(proven(STYLES).includes('intraCard'));
});

test('C3. double export-star barrel: unique name resolves through, ambiguous name poisons both sides', () => {
  assert.strictEqual(unproven('src/a2.css.ts').starHole, 'composed-with-component:Button');
  assert.ok(proven('src/b2.css.ts').includes('otherStar'), 'unused sibling stays proven');
  assert.strictEqual(unproven('src/a3.css.ts').dupName, 'reexport-unresolved');
  assert.strictEqual(unproven('src/b3.css.ts').dupName, 'reexport-unresolved');
});

test('C4. import + local `export { x }` barrel → unproven', () => {
  assert.strictEqual(unproven(STYLES).localHole, 'reexported-locally');
});

test('C5. unresolvable specifier that may hide a css module is reported in the artifact', () => {
  assert.ok(artifact.unresolvedImports.some((entry) => entry.specifier === '@missing/ghost.css'));
});

test('M2. .jsx and .js consumers are scanned', () => {
  assert.strictEqual(unproven('src/jsxstyles.css.ts').holeJsx, 'composed-with-component:Button');
});

test('M3. require() consumers poison everything they can reach', () => {
  assert.strictEqual(unproven('src/require.css.ts').requireHole, 'commonjs-or-dynamic-import');
  assert.strictEqual(unproven('src/require.css.ts').requireHole2, 'commonjs-or-dynamic-import');
});

test('M1. consumers outside tsconfig include are still scanned (full-root walk)', () => {
  assert.strictEqual(unproven('src/exclstyles.css.ts').holeExcluded, 'composed-with-component:Button');
});

test('M1-b. an explicit --exclude really hides consumers — documented foot-gun, recorded in `excluded`', () => {
  const excludedRun = analyzeProject({ rootDir: fixtureRoot, tsconfigPath: 'tsconfig.json', exclude: ['**/excluded-stories/**'] });
  assert.ok((excludedRun.provenSoloClasses['src/exclstyles.css.ts'] || []).includes('holeExcluded'));
  assert.ok(excludedRun.excluded.length > 0, 'excluded files must be recorded in the artifact');
});

test('F1. `export { x as y }` alias inside css.ts is one identity — composition via the alias unproves both', () => {
  assert.ok(unproven('src/alias.css.ts').card, 'local name must be unproven');
  assert.ok(unproven('src/alias.css.ts').cardAlias, 'alias name must be unproven');
});

test('F2. namespace import of a css.ts barrel poisons the origin', () => {
  assert.ok(unproven('src/origin.css.ts').originCard);
});

test('F3. `export * as ns` poisons the re-exported css module', () => {
  assert.ok(unproven('src/starns.css.ts').starNsCard);
});

test('F4. bare unresolved specifiers are recorded unconditionally', () => {
  assert.ok(artifact.unresolvedImports.some((entry) => entry.specifier === 'clsx'), 'uninstalled bare package must be recorded');
  assert.strictEqual(artifact.tsconfigLoaded, true);
});

test('F5. dot-directory consumers (.storybook) are scanned; default skips are recorded', () => {
  assert.strictEqual(unproven('src/dotstyles.css.ts').dotCard, 'composed-with-component:Button');
  assert.ok(Array.isArray(artifact.skippedDirectories));
});

test('F9. dotted lowercase JSX tags are not intrinsic', () => {
  assert.strictEqual(unproven('src/lowertag.css.ts').lowerTag, 'composed-with-component:ui.card');
});

test('artifact carries input hashes and a global source hash', () => {
  assert.ok(/^[0-9a-f]{64}$/.test(artifact.sourceHash));
  assert.ok(/^[0-9a-f]{64}$/.test(artifact.inputs[STYLES]));
  assert.ok(Object.keys(artifact.inputs).length > 10, 'every scanned file must be recorded');
});

let failed = 0;
for (const { name, run } of cases) {
  try {
    run();
    console.log(`✅ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`❌ ${name}`);
    console.log(`   ${error.message.split('\n')[0]}`);
  }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed > 0 ? 1 : 0);
