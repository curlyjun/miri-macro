"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_TOKEN_PATH = path.join(__dirname, "..", "runtime", "auth.json");
const ACCESS_TOKEN_MARGIN_MS = 10 * 60 * 1000;

// refresh 결과(액세스 토큰, 새 refresh 토큰)를 runtime/에 저장해 다음 실행에서 이어 쓴다.
// seed는 저장값이 파생된 .env의 refresh 토큰이다. 사용자가 .env를 새 토큰으로 바꾸면 seed가
// 달라지므로 저장값을 모두 버리고 .env 값을 다시 쓴다.
function read(tokenPath) {
  try {
    return JSON.parse(fs.readFileSync(tokenPath, "utf8"));
  } catch {
    return null;
  }
}

function readRecord(tokenPath, envToken) {
  const stored = read(tokenPath);
  return stored?.seed === envToken ? stored : null;
}

// MiRi 액세스 토큰은 "JWT|공개키" 형태다. JWT의 exp로 만료 시각을 알 수 있다.
function tokenExpiry(token) {
  try {
    const jwt = String(token).split("|")[0];
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
    return Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function isTokenAlive(token, { now = () => Date.now(), marginMs = 0 } = {}) {
  const expiry = tokenExpiry(token);
  return expiry != null && expiry - now() > marginMs;
}

function loadRefreshToken(envToken, { tokenPath = DEFAULT_TOKEN_PATH } = {}) {
  return readRecord(tokenPath, envToken)?.refreshToken || envToken;
}

// 액세스 토큰은 약 25시간짜리라 매 실행마다 refresh할 필요가 없다. 만료가 가까우면 버린다.
function loadAccessToken(envToken, { tokenPath = DEFAULT_TOKEN_PATH, now = () => Date.now() } = {}) {
  const token = readRecord(tokenPath, envToken)?.accessToken;
  return token && isTokenAlive(token, { now, marginMs: ACCESS_TOKEN_MARGIN_MS }) ? token : null;
}

function saveTokens(
  envToken,
  tokens,
  { tokenPath = DEFAULT_TOKEN_PATH, now = () => Date.now() } = {},
) {
  const record = { ...readRecord(tokenPath, envToken) };
  for (const [key, value] of Object.entries(tokens)) {
    if (value) record[key] = value;
  }
  record.seed = envToken;
  record.updatedAt = now();

  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  const temporaryPath = `${tokenPath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(record, null, 2), { mode: 0o600 });
  fs.renameSync(temporaryPath, tokenPath);
}

module.exports = {
  DEFAULT_TOKEN_PATH,
  isTokenAlive,
  loadAccessToken,
  loadRefreshToken,
  saveTokens,
  tokenExpiry,
};
