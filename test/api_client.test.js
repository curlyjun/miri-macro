const assert = require("node:assert/strict");
const test = require("node:test");

const { createApiClient } = require("../lib/api-client");

function response(status, body = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test("5xx 응답을 최대 두 번 재시도한다", async () => {
  let calls = 0;
  const client = createApiClient({
    fetchImpl: async () => {
      calls += 1;
      return calls < 3 ? response(503) : response(200, { resultCode: 0 });
    },
    sleepImpl: async () => {},
    retries: 2,
  });

  const result = await client.requestJson("https://example.test");
  assert.equal(result.resultCode, 0);
  assert.equal(calls, 3);
});

test("401 응답은 토큰 갱신 후 한 번 다시 요청한다", async () => {
  let calls = 0;
  let refreshes = 0;
  let token = "old";
  const headers = [];
  const client = createApiClient({
    fetchImpl: async (_url, options) => {
      calls += 1;
      headers.push(options.headers.Authorization);
      return calls === 1 ? response(401) : response(200, { resultCode: 0 });
    },
    refreshAuth: async () => {
      refreshes += 1;
      token = "new";
      return true;
    },
    sleepImpl: async () => {},
  });

  await client.requestJson("https://example.test", {
    headers: () => ({ Authorization: `Bearer ${token}` }),
  });
  assert.equal(calls, 2);
  assert.equal(refreshes, 1);
  assert.deepEqual(headers, ["Bearer old", "Bearer new"]);
});

test("제한 시간을 넘긴 요청을 중단한다", async () => {
  const client = createApiClient({
    timeoutMs: 5,
    retries: 0,
    fetchImpl: async (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
  });

  await assert.rejects(
    client.requestJson("https://example.test"),
    (error) => error.code === "TIMEOUT",
  );
});
