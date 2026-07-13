const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const runnerPath = path.join(__dirname, "..", "scripts", "run-oracle.sh");

test("Oracle 래퍼가 허용 작업만 실행하고 원격 설정을 검증 후 적용한다", () => {
  const script = fs.readFileSync(runnerPath, "utf8");
  assert.match(script, /monitor\|autobook\|observe\|update-lines/);
  assert.match(script, /git fetch origin main/);
  assert.match(script, /git show origin\/main:config\.json/);
  assert.match(script, /normalizeConfig/);
  assert.match(script, /validateConfig/);
  assert.match(script, /applied-config-commit/);
  assert.match(script, /npm run "\$TASK"/);
});
