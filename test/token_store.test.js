const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadRefreshToken, saveRefreshToken } = require("../lib/token-store");

function tempTokenPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miri-token-"));
  return path.join(dir, "auth.json");
}

test("저장된 토큰이 없으면 .env 값을 쓴다", () => {
  const tokenPath = tempTokenPath();

  assert.equal(loadRefreshToken("env-1", { tokenPath }), "env-1");
});

test("refresh로 받은 토큰을 저장하고 다음 실행에서 이어 쓴다", () => {
  const tokenPath = tempTokenPath();

  saveRefreshToken("rotated-1", "env-1", { tokenPath });
  assert.equal(loadRefreshToken("env-1", { tokenPath }), "rotated-1");

  saveRefreshToken("rotated-2", "env-1", { tokenPath });
  assert.equal(loadRefreshToken("env-1", { tokenPath }), "rotated-2");
});

test(".env 토큰을 새로 바꾸면 저장된 토큰을 버린다", () => {
  const tokenPath = tempTokenPath();
  saveRefreshToken("rotated-1", "env-1", { tokenPath });

  assert.equal(loadRefreshToken("env-2", { tokenPath }), "env-2");
});

test("저장 파일이 깨져 있으면 .env 값으로 돌아간다", () => {
  const tokenPath = tempTokenPath();
  fs.writeFileSync(tokenPath, "{not json");

  assert.equal(loadRefreshToken("env-1", { tokenPath }), "env-1");
});

test("저장 파일은 소유자만 읽을 수 있다", () => {
  const tokenPath = tempTokenPath();
  saveRefreshToken("rotated-1", "env-1", { tokenPath });

  assert.equal(fs.statSync(tokenPath).mode & 0o777, 0o600);
});
