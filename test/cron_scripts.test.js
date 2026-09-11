const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const scriptsDir = path.join(__dirname, "..", "scripts");
const usePath = path.join(scriptsDir, "use-node.sh");
const nvmScript = path.join(os.homedir(), ".nvm", "nvm.sh");

test("cron 스크립트는 버전을 박지 않고 nvm 기본 버전을 불러온다", () => {
  const useNode = fs.readFileSync(usePath, "utf8");
  assert.match(useNode, /nvm use --silent default/);
  assert.doesNotMatch(useNode, /versions\/node\/v\d/);
  for (const name of ["run.sh", "settings-watchdog.sh"]) {
    assert.match(fs.readFileSync(path.join(scriptsDir, name), "utf8"), /use-node\.sh/, name);
  }
});

test("PATH에 node가 없는 cron 환경에서도 node를 찾는다", { skip: !fs.existsSync(nvmScript) }, () => {
  const result = spawnSync("bash", ["-c", `set -euo pipefail; . "${usePath}"; node -v`], {
    env: { HOME: os.homedir(), PATH: "/usr/bin:/bin" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^v\d+\./);
});

test("로그가 한도를 넘으면 마지막 줄만 남기고 작은 로그는 그대로 둔다", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miri-logs-"));
  const big = path.join(dir, "monitor.log");
  const small = path.join(dir, "settings.log");
  fs.writeFileSync(big, Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n") + "\n");
  fs.writeFileSync(small, "ok\n");
  const bigInode = fs.statSync(big).ino;

  const result = spawnSync(path.join(scriptsDir, "trim-logs.sh"), [], {
    env: { ...process.env, LOG_DIR: dir, MAX_LOG_BYTES: "100", KEEP_LOG_LINES: "3" },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(big, "utf8"), "line 47\nline 48\nline 49\n");
  assert.equal(fs.statSync(big).ino, bigInode);
  assert.equal(fs.readFileSync(small, "utf8"), "ok\n");
});
