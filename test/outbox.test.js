const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { enqueue, flush, size } = require("../lib/outbox");

function tempOutbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miri-outbox-"));
  return path.join(dir, "outbox.jsonl");
}

test("전송 실패한 메시지를 보관했다가 다음 실행에서 흘려보낸다", async () => {
  const outboxPath = tempOutbox();
  enqueue("예약 완료 1", { outboxPath });
  enqueue("예약 완료 2", { outboxPath });
  assert.equal(size(outboxPath), 2);

  const sent = [];
  const result = await flush(async (message) => sent.push(message), { outboxPath });

  assert.deepEqual(sent, ["예약 완료 1", "예약 완료 2"]);
  assert.equal(result.sent, 2);
  assert.equal(size(outboxPath), 0);
});

test("전송 경로가 아직 막혀 있으면 남은 항목을 그대로 보관한다", async () => {
  const outboxPath = tempOutbox();
  enqueue("첫째", { outboxPath });
  enqueue("둘째", { outboxPath });
  enqueue("셋째", { outboxPath });

  let calls = 0;
  const result = await flush(
    async () => {
      calls += 1;
      if (calls > 1) throw new Error("fetch failed");
    },
    { outboxPath },
  );

  assert.equal(result.sent, 1);
  assert.equal(result.pending, 2);
  assert.equal(calls, 2);

  const remaining = [];
  await flush(async (message) => remaining.push(message), { outboxPath });
  assert.deepEqual(remaining, ["둘째", "셋째"]);
});

test("재시도해도 소용없는 오류는 버려서 뒤 항목을 막지 않는다", async () => {
  const outboxPath = tempOutbox();
  enqueue("깨진 메시지", { outboxPath });
  enqueue("정상 메시지", { outboxPath });

  const sent = [];
  const result = await flush(
    async (message) => {
      if (message === "깨진 메시지") {
        const error = new Error("Bad Request: can't parse entities");
        error.permanent = true;
        throw error;
      }
      sent.push(message);
    },
    { outboxPath },
  );

  assert.equal(result.dropped, 1);
  assert.equal(result.sent, 1);
  assert.deepEqual(sent, ["정상 메시지"]);
  assert.equal(size(outboxPath), 0);
});

test("24시간이 지난 메시지는 전송하지 않고 만료시킨다", async () => {
  const outboxPath = tempOutbox();
  let now = Date.parse("2026-08-06T01:00:00Z");
  enqueue("지난 메시지", { outboxPath, now: () => now });
  now += 25 * 3600 * 1000;
  enqueue("최근 메시지", { outboxPath, now: () => now });

  const sent = [];
  const result = await flush(async (message) => sent.push(message), {
    outboxPath,
    now: () => now,
  });

  assert.equal(result.expired, 1);
  assert.deepEqual(sent, ["최근 메시지"]);
});

test("큐가 상한을 넘으면 오래된 메시지부터 버린다", () => {
  const outboxPath = tempOutbox();
  for (let i = 1; i <= 5; i += 1) enqueue(`메시지 ${i}`, { outboxPath, maxEntries: 3 });

  assert.equal(size(outboxPath), 3);
  const lines = fs.readFileSync(outboxPath, "utf8").trim().split("\n");
  assert.deepEqual(
    lines.map((line) => JSON.parse(line).message),
    ["메시지 3", "메시지 4", "메시지 5"],
  );
});

test("큐 파일이 없으면 빈 큐로 취급한다", async () => {
  const outboxPath = path.join(os.tmpdir(), "miri-outbox-없음", "outbox.jsonl");
  assert.equal(size(outboxPath), 0);
  const result = await flush(async () => assert.fail("호출되면 안 된다"), { outboxPath });
  assert.equal(result.sent, 0);
});
