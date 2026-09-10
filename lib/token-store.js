"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_TOKEN_PATH = path.join(__dirname, "..", "runtime", "auth.json");

// MiRi는 refresh할 때마다 새 refreshToken을 내려준다. 이를 버리고 .env 값만 계속 쓰면
// 처음 발급받은 토큰의 수명이 끝나는 순간 멈추므로, 받은 토큰을 runtime/에 이어 저장한다.
// seed는 저장 토큰이 파생된 .env 값이다. 사용자가 .env를 새 토큰으로 바꾸면 seed가
// 달라지므로 저장 토큰을 버리고 .env 값을 다시 쓴다.
function read(tokenPath) {
  try {
    return JSON.parse(fs.readFileSync(tokenPath, "utf8"));
  } catch {
    return null;
  }
}

function loadRefreshToken(envToken, { tokenPath = DEFAULT_TOKEN_PATH } = {}) {
  const stored = read(tokenPath);
  if (stored?.refreshToken && stored.seed === envToken) return stored.refreshToken;
  return envToken;
}

function saveRefreshToken(
  refreshToken,
  envToken,
  { tokenPath = DEFAULT_TOKEN_PATH, now = () => Date.now() } = {},
) {
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  const temporaryPath = `${tokenPath}.tmp`;
  const body = JSON.stringify({ seed: envToken, refreshToken, updatedAt: now() }, null, 2);
  fs.writeFileSync(temporaryPath, body, { mode: 0o600 });
  fs.renameSync(temporaryPath, tokenPath);
}

module.exports = { DEFAULT_TOKEN_PATH, loadRefreshToken, saveRefreshToken };
