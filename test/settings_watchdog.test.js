const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const watchdogPath = path.join(__dirname, "..", "scripts", "settings-watchdog.sh");
const script = fs.readFileSync(watchdogPath, "utf8");

test("감시 스크립트는 실제 응답 헤더로 설정 서버가 살아 있는지 확인한다", () => {
  assert.match(script, /x-miri-settings: 1/i);
  assert.match(script, /SETTINGS_PORT:-8790/);
  assert.notEqual(fs.statSync(watchdogPath).mode & 0o111, 0);
});

test("응답이 없으면 남은 프로세스를 정리하고 node --watch로 다시 띄운다", () => {
  assert.match(script, /pkill -f "\$\{ROOT_DIR\}\/server\.js"/);
  assert.match(script, /nohup node --watch/);
});
