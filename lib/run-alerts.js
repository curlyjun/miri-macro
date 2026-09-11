"use strict";

const { escapeHtml } = require("./telegram");

// 토큰이 만료되면 실행마다 같은 이유로 실패한다. 오류 문구만으로는 할 일을 알 수 없으므로
// 갱신 방법을 함께 보낸다.
const TOKEN_RENEWAL_GUIDE =
  "PC 브라우저에서 https://commute.e-bus.co.kr/MIRI/login 에 로그인(자동 로그인 체크)한 뒤 " +
  "F12 콘솔로 토큰을 복사해 .env의 BEARER_TOKEN, MIRI_REFRESH_TOKEN을 바꿔주세요. " +
  "자세한 방법은 TELEGRAM_SETUP.md의 'MiRi 토큰 갱신 방법'에 있습니다.";

function isAuthFailure(error) {
  return error.code === "TOKEN_EXPIRED" || error.code === "UNAUTHORIZED";
}

async function reportFatal({ scope, error, state, sendTelegram, executedAt = "" }) {
  const fingerprint = `${error.code || error.name || "ERROR"}:${error.message}`;
  const incident = state.recordFailure(`fatal:${scope}`, fingerprint);
  if (!incident.notify) return incident;

  const body = isAuthFailure(error)
    ? `🔑 <b>MiRi 토큰 만료 — 갱신 필요</b> (${escapeHtml(scope)})\n${escapeHtml(TOKEN_RENEWAL_GUIDE)}`
    : `🚨 <b>${escapeHtml(scope)} 치명 오류</b>\n${escapeHtml(error.message)}`;
  await sendTelegram(
    body +
      `\n반복 횟수: ${incident.count || 1}` +
      (executedAt ? `\n🕐 ${escapeHtml(executedAt)}` : ""),
  );
  return incident;
}

module.exports = { reportFatal };
