/**
 * The import specifier a fix adds for `sprinkles` is derived by reversing tsconfig `paths`. The
 * base directory has to follow TypeScript (getPathsBasePath): `baseUrl` when set, otherwise the
 * directory of the config that declared `paths`. Each layout below resolves the same module, so
 * every case must derive the same specifier.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { deriveSprinklesImportSource } = require('../analyzer/import-source');

const LAYOUTS = {
  'baseUrl "." with "@/*": ["src/*"]': { 'tsconfig.json': { compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } } },
  'baseUrl "src" with "@/*": ["*"] (a Next.js app layout)': { 'tsconfig.json': { compilerOptions: { baseUrl: 'src', paths: { '@/*': ['*'] } } } },
  'no baseUrl, paths inherited through extends': {
    'config/base.json': { compilerOptions: { paths: { '@/*': ['../src/*'] } } },
    'tsconfig.json': { extends: './config/base.json' },
  },
  'baseUrl and paths inherited through extends': {
    'config/base.json': { compilerOptions: { baseUrl: '../src', paths: { '@/*': ['*'] } } },
    'tsconfig.json': { extends: './config/base.json' },
  },
  'baseUrl local, paths inherited through extends': {
    'config/base.json': { compilerOptions: { paths: { '@/*': ['*'] } } },
    'tsconfig.json': { extends: './config/base.json', compilerOptions: { baseUrl: 'src' } },
  },
};

const writeLayout = (files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sprinkles-import-source-'));
  for (const [relativePath, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
    fs.writeFileSync(path.join(root, relativePath), JSON.stringify(content));
  }
  fs.mkdirSync(path.join(root, 'src/styles'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/styles/sprinkles.css.ts'), 'export const sprinkles = (value: unknown) => value;\n');
  fs.mkdirSync(path.join(root, 'src/app'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/app/page.css.ts'), 'export {};\n');
  return root;
};

let failed = 0;
for (const [name, files] of Object.entries(LAYOUTS)) {
  const root = writeLayout(files);
  const derived = deriveSprinklesImportSource({
    sprinklesFilePath: path.join(root, 'src/styles/sprinkles.css.ts'),
    tsconfigPath: path.join(root, 'tsconfig.json'),
    containingFile: path.join(root, 'src/app/page.css.ts'),
  });
  try {
    assert.strictEqual(derived, '@/styles/sprinkles.css');
    console.log(`✅ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`❌ ${name}`);
    console.log(`   derived ${JSON.stringify(derived)}`);
  }
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n${Object.keys(LAYOUTS).length - failed}/${Object.keys(LAYOUTS).length} passed`);
process.exit(failed > 0 ? 1 : 0);
