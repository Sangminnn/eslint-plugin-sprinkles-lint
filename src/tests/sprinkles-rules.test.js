import { ESLint } from "eslint";

const eslint = new ESLint({
  overrideConfigFile: "./eslint.config.mjs",
});

async function runTests() {
  console.log("🔍 Starting lint...");

  const results = await eslint.lintFiles(["src/tests/test-files/*.js"]);

  console.log("📁 Found files:", results.length);

  results.forEach((result) => {
    console.log(`\n검사 파일: ${result.filePath}`);
    console.log("메시지 수:", result.messages.length);

    if (result.messages.length === 0) {
      console.log("✅ 문제 없음");
    } else {
      result.messages.forEach((msg) => {
        console.log(`❌ ${msg.ruleId}: ${msg.message}`);
      });
    }
  });
}

runTests().catch(console.error);
