const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const runnerPath = path.join(__dirname, "..", "scripts", "run.sh");

test("실행 래퍼가 허용 작업만 npm으로 실행한다", () => {
  const script = fs.readFileSync(runnerPath, "utf8");
  assert.match(script, /monitor\|autobook\|observe\|update-lines/);
  assert.match(script, /npm run "\$TASK"/);

  const result = spawnSync(runnerPath, ["rm-rf"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /사용법/);
});

test("실행 래퍼는 GitHub에서 설정을 받아오지 않는다", () => {
  const script = fs.readFileSync(runnerPath, "utf8");
  assert.doesNotMatch(script, /git (fetch|show|pull)/);
});
