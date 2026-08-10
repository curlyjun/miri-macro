const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { createApiClient } = require("../lib/api-client");

function response(status, { body = {}, text = "" } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => text,
  };
}

test("텔레그램 클라이언트는 일시적 전송 실패를 재시도한다", async () => {
  let calls = 0;
  const client = createApiClient({
    retries: 3,
    sleepImpl: async () => {},
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) throw new Error("fetch failed");
      return response(200, { body: { ok: true } });
    },
  });

  const json = await client.requestJson("https://api.telegram.test/sendMessage");
  assert.equal(json.ok, true);
  assert.equal(calls, 3);
});

test("실패 응답 본문을 오류 메시지에 남긴다", async () => {
  const client = createApiClient({
    retries: 0,
    includeErrorBody: true,
    fetchImpl: async () =>
      response(400, {
        text: '{"ok":false,"error_code":400,"description":"Bad Request: chat not found"}',
      }),
  });

  await assert.rejects(client.requestJson("https://api.telegram.test/sendMessage"), (error) => {
    assert.match(error.message, /chat not found/);
    assert.equal(error.status, 400);
    return true;
  });
});

test("본문 로깅을 켜지 않은 클라이언트는 상태 코드만 남긴다", async () => {
  const client = createApiClient({
    retries: 0,
    fetchImpl: async () => response(400, { text: "무시되어야 한다" }),
  });

  await assert.rejects(
    client.requestJson("https://api.test"),
    (error) => error.message === "HTTP 400",
  );
});

test("텔레그램 전송은 IPv4를 먼저 시도하도록 고정한다", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "common.js"), "utf8");
  assert.match(source, /setDefaultResultOrder\("ipv4first"\)/);
});

test("모니터와 자동예약은 실행 끝에 미전송 큐를 비운다", () => {
  for (const entry of ["monitor.js", "auto_book.js"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", entry), "utf8");
    assert.match(source, /deps\.flushTelegramOutbox \|\| flushTelegramOutbox/, entry);
  }
});
