const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { RuntimeState, withProcessLock } = require("../lib/runtime-state");

test("같은 장애는 6시간 동안 억제하고 이후 지속 알림을 보낸다", () => {
  let now = Date.parse("2026-07-13T00:00:00Z");
  const state = new RuntimeState({ now: () => now, cooldownMs: 6 * 3600 * 1000 });

  assert.equal(state.recordFailure("monitor", "ETIMEDOUT").type, "NEW_FAILURE");
  now += 5 * 60 * 1000;
  assert.equal(state.recordFailure("monitor", "ETIMEDOUT").notify, false);
  now += 6 * 3600 * 1000;
  assert.equal(state.recordFailure("monitor", "ETIMEDOUT").type, "ONGOING_FAILURE");
});

test("장애 뒤 정상 실행은 복구를 한 번만 알린다", () => {
  const state = new RuntimeState();
  state.recordFailure("monitor", "network");

  assert.equal(state.recordSuccess("monitor").type, "RECOVERED");
  assert.equal(state.recordSuccess("monitor").notify, false);
});

test("일일 상태는 같은 날짜에 한 번만 보낸다", () => {
  const state = new RuntimeState();

  assert.equal(state.recordDailyHealth("2026-07-13").notify, true);
  assert.equal(state.recordDailyHealth("2026-07-13").notify, false);
  assert.equal(state.recordDailyHealth("2026-07-14").notify, true);
});

test("예약 완료 날짜를 중복 없이 기록한다", () => {
  const state = new RuntimeState();

  state.recordCompleted("출근", "2026-07-14", 17);
  state.recordCompleted("출근", "2026-07-14", 17);

  assert.deepEqual(state.getCompleted(), [
    { target: "출근", date: "2026-07-14", seatNo: 17 },
  ]);
});

test("살아 있는 잠금이 있으면 중복 실행을 건너뛴다", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miri-lock-"));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "monitor.lock"), String(Date.now()));
  let ran = false;

  const result = await withProcessLock(
    "monitor",
    async () => {
      ran = true;
    },
    { dir },
  );

  assert.equal(result.skipped, true);
  assert.equal(ran, false);
});
