const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("공통 라이브러리는 프로세스를 직접 종료하지 않는다", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "common.js"), "utf8");
  assert.doesNotMatch(source, /process\.exit\(/);
});
