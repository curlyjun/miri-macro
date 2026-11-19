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

test("주간 현황을 보낸 날을 남기고 예전 일일 상태 기록은 지운다", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miri-state-"));
  const statePath = path.join(dir, "state.json");
  fs.writeFileSync(statePath, JSON.stringify({ failures: {}, dailyHealthDate: "2026-11-18" }));
  const state = new RuntimeState({ statePath });

  state.markWeeklyDigest("2026-11-22");
  const saved = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(saved.weeklyDigestDate, "2026-11-22");
  assert.equal("dailyHealthDate" in saved, false);
});

test("예약 완료 날짜를 예약 시각과 함께 중복 없이 기록한다", () => {
  const state = new RuntimeState({ now: () => 1000 });

  state.recordCompleted("출근", "2026-07-14", 17);
  state.recordCompleted("출근", "2026-07-14", 17);

  assert.deepEqual(state.getCompleted(), [
    { target: "출근", date: "2026-07-14", seatNo: 17, bookedAt: 1000 },
  ]);
});

test("공휴일은 날짜별로 합쳐 두고 지난 날짜는 버린다", () => {
  const state = new RuntimeState({ now: () => Date.parse("2026-09-17T01:00:00Z") });

  state.recordHolidays([{ date: "2026-09-10", name: "지난 날" }, { date: "2026-09-24", name: "추석 연휴" }]);
  assert.deepEqual(state.recordHolidays([{ date: "2026-10-03", name: "개천절" }]), [
    { date: "2026-09-24", name: "추석 연휴" },
    { date: "2026-10-03", name: "개천절" },
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

test("일시적 실패는 minCount만큼 연속돼야 알리고, 알리지 않은 실패는 복구도 알리지 않는다", () => {
  const state = new RuntimeState();

  assert.equal(state.recordFailure("monitor", "fetch failed", { minCount: 2 }).notify, false);
  assert.deepEqual(state.recordSuccess("monitor"), { notify: false, type: "HEALTHY", count: 1 });

  state.recordFailure("monitor", "fetch failed", { minCount: 2 });
  const second = state.recordFailure("monitor", "fetch failed", { minCount: 2 });
  assert.equal(second.notify, true);
  assert.equal(second.type, "NEW_FAILURE");
  assert.equal(state.recordSuccess("monitor").type, "RECOVERED");
});

test("notified가 없는 예전 실패 기록은 이미 알린 것으로 보고 복구를 알린다", () => {
  const state = new RuntimeState();
  state.state.failures.monitor = { fingerprint: "x", firstAt: 1, lastAt: 1, lastNotifiedAt: 1, count: 3 };

  assert.equal(state.recordSuccess("monitor").notify, true);
});

test("모니터 실행 시각과 자동예약 실행일을 남긴다", () => {
  let now = 1000;
  const state = new RuntimeState({ now: () => now });

  assert.equal(state.markMonitorRun(), null);
  now = 2000;
  assert.equal(state.markMonitorRun(), 1000);

  for (let day = 1; day <= 16; day += 1) state.recordAutobookRun(`2026-11-${String(day).padStart(2, "0")}`);
  assert.equal(state.state.autobookRuns.length, 14);
  assert.equal(state.state.autobookRuns[0], "2026-11-03");
});
