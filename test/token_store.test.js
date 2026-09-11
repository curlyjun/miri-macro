const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  isTokenAlive,
  loadAccessToken,
  loadRefreshToken,
  saveTokens,
  tokenExpiry,
} = require("../lib/token-store");

function tempTokenPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miri-token-"));
  return path.join(dir, "auth.json");
}

// MiRi 액세스 토큰과 같은 "JWT|공개키" 모양을 만든다.
function accessToken(expMs) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "ES512" })}.${part({ exp: Math.floor(expMs / 1000) })}.sig|MIGbPUBLICKEY`;
}

const NOW = Date.parse("2026-09-11T00:00:00Z");
const now = () => NOW;

test("저장된 토큰이 없으면 .env 값을 쓴다", () => {
  const tokenPath = tempTokenPath();

  assert.equal(loadRefreshToken("env-1", { tokenPath }), "env-1");
  assert.equal(loadAccessToken("env-1", { tokenPath, now }), null);
});

test("refresh로 받은 토큰을 저장하고 다음 실행에서 이어 쓴다", () => {
  const tokenPath = tempTokenPath();

  saveTokens("env-1", { refreshToken: "rotated-1" }, { tokenPath });
  assert.equal(loadRefreshToken("env-1", { tokenPath }), "rotated-1");

  saveTokens("env-1", { refreshToken: "rotated-2" }, { tokenPath });
  assert.equal(loadRefreshToken("env-1", { tokenPath }), "rotated-2");
});

test("액세스 토큰만 저장해도 이전 refresh 토큰은 남긴다", () => {
  const tokenPath = tempTokenPath();
  saveTokens("env-1", { refreshToken: "rotated-1" }, { tokenPath });

  saveTokens("env-1", { accessToken: accessToken(NOW + 3600_000), refreshToken: undefined }, { tokenPath });
  assert.equal(loadRefreshToken("env-1", { tokenPath }), "rotated-1");
});

test("만료까지 10분 넘게 남은 액세스 토큰만 재사용한다", () => {
  const tokenPath = tempTokenPath();

  const fresh = accessToken(NOW + 3600_000);
  saveTokens("env-1", { accessToken: fresh }, { tokenPath });
  assert.equal(loadAccessToken("env-1", { tokenPath, now }), fresh);

  saveTokens("env-1", { accessToken: accessToken(NOW + 5 * 60_000) }, { tokenPath });
  assert.equal(loadAccessToken("env-1", { tokenPath, now }), null);
});

test(".env 토큰을 새로 바꾸면 저장된 토큰을 모두 버린다", () => {
  const tokenPath = tempTokenPath();
  saveTokens(
    "env-1",
    { refreshToken: "rotated-1", accessToken: accessToken(NOW + 3600_000) },
    { tokenPath },
  );

  assert.equal(loadRefreshToken("env-2", { tokenPath }), "env-2");
  assert.equal(loadAccessToken("env-2", { tokenPath, now }), null);
});

test("저장 파일이 깨져 있으면 .env 값으로 돌아간다", () => {
  const tokenPath = tempTokenPath();
  fs.writeFileSync(tokenPath, "{not json");

  assert.equal(loadRefreshToken("env-1", { tokenPath }), "env-1");
});

test("저장 파일은 소유자만 읽을 수 있다", () => {
  const tokenPath = tempTokenPath();
  saveTokens("env-1", { refreshToken: "rotated-1" }, { tokenPath });

  assert.equal(fs.statSync(tokenPath).mode & 0o777, 0o600);
});

test("JWT|공개키 형태에서 만료 시각을 읽고, 읽을 수 없으면 만료로 본다", () => {
  assert.equal(tokenExpiry(accessToken(NOW)), NOW);
  assert.equal(tokenExpiry("not-a-jwt"), null);
  assert.equal(isTokenAlive(accessToken(NOW + 1000), { now }), true);
  assert.equal(isTokenAlive(accessToken(NOW - 1000), { now }), false);
  assert.equal(isTokenAlive(undefined, { now }), false);
});
