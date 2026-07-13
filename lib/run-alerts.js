"use strict";

const { escapeHtml } = require("./telegram");

async function reportFatal({ scope, error, state, sendTelegram, executedAt = "" }) {
  const fingerprint = `${error.code || error.name || "ERROR"}:${error.message}`;
  const incident = state.recordFailure(`fatal:${scope}`, fingerprint);
  if (!incident.notify) return incident;

  await sendTelegram(
    `🚨 <b>${escapeHtml(scope)} 치명 오류</b>\n` +
      `${escapeHtml(error.message)}\n` +
      `반복 횟수: ${incident.count || 1}` +
      (executedAt ? `\n🕐 ${escapeHtml(executedAt)}` : ""),
  );
  return incident;
}

module.exports = { reportFatal };
