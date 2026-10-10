/**
 * Lints one file in a brand-new process and reports what the analysis had to re-read, so the disk
 * cache can be tested across real process boundaries rather than by clearing an in-memory map.
 *
 * usage: node lint-once.js <projectRoot> <relativeTarget>
 */

const path = require('path');
const { ESLint } = require('eslint');
const { getExtractCount } = require('../../analyzer/analyze');

const [projectRoot, target] = process.argv.slice(2);
const pluginPath = path.resolve(__dirname, '../../..');

(async () => {
  const eslint = new ESLint({
    fix: true,
    cwd: projectRoot,
    useEslintrc: false,
    overrideConfig: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      plugins: ['sprinkles-lint'],
      rules: { 'sprinkles-lint/no-use-style-declared-sprinkles': ['error', { configPath: path.join(pluginPath, 'src/sprinkles.js') }] },
    },
    resolvePluginsRelativeTo: pluginPath,
  });
  const [result] = await eslint.lintFiles([path.join(projectRoot, target)]);
  process.stdout.write(JSON.stringify({ extracts: getExtractCount(), fixed: result.output !== undefined, messageIds: result.messages.map((message) => message.messageId) }));
})();
