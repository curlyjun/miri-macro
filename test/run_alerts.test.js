const assert = require("node:assert/strict");
const test = require("node:test");

const { reportFatal } = require("../lib/run-alerts");

test("치명 오류도 런타임 상태가 허용할 때만 알린다", async () => {
  const messages = [];
  const state = {
    recordFailure: () => ({ notify: true, type: "NEW_FAILURE", count: 1 }),
  };
  await reportFatal({
    scope: "monitor",
    error: new Error("token <expired>"),
    state,
    sendTelegram: async (message) => messages.push(message),
    executedAt: "now",
  });

  assert.equal(messages.length, 1);
  assert.match(messages[0], /token &lt;expired&gt;/);
});

test("토큰 만료는 원인과 갱신 방법을 함께 알린다", async () => {
  const messages = [];
  const error = new Error("MiRi refresh 토큰이 만료되어 새 토큰을 받을 수 없습니다.");
  error.code = "TOKEN_EXPIRED";
  await reportFatal({
    scope: "monitor",
    error,
    state: { recordFailure: () => ({ notify: true, count: 1 }) },
    sendTelegram: async (message) => messages.push(message),
  });

  assert.match(messages[0], /토큰 만료 — 갱신 필요/);
  assert.match(messages[0], /commute\.e-bus\.co\.kr\/MIRI\/login/);
  assert.match(messages[0], /MIRI_REFRESH_TOKEN/);
  assert.doesNotMatch(messages[0], /치명 오류/);
});

test("억제된 치명 오류는 텔레그램을 보내지 않는다", async () => {
  let sent = false;
  await reportFatal({
    scope: "monitor",
    error: new Error("network"),
    state: { recordFailure: () => ({ notify: false }) },
    sendTelegram: async () => { sent = true; },
  });
  assert.equal(sent, false);
});
