const assert = require("node:assert/strict");
const test = require("node:test");

const { buildWeeklyDigest, nextWeekdays } = require("../lib/weekly-digest");
const { runMonitor } = require("../monitor");
const { RuntimeState } = require("../lib/runtime-state");

const target = {
  name: "[M4434] 06:35 버스",
  lineTurnUid: "turn",
  onStationUid: "on",
  offStationUid: "off",
  autoBookEnabled: true,
  weekdays: ["MON", "THU", "FRI"],
  monitorEnabled: true,
  monitorDates: ["2026-11-24"],
  preferredSeats: [17],
  fallbackSeatSelection: "ANY",
};

const day = (date, seatNo) => ({ date, ...(seatNo ? { myBooks: [{ allocUid: "a", seatNo }] } : {}) });
const response = (dates, holidays = []) => ({
  resultCode: 0,
  data: [{ bookableDates: dates, calendarHolidays: holidays }],
});

test("다음 주 월~금을 고른다", () => {
  assert.deepEqual(nextWeekdays("2026-11-22"), ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"]);
  assert.deepEqual(nextWeekdays("2026-11-23")[0], "2026-11-30");
});

test("예약 좌석·감지 중·예약 안 함·예약 안 된 날을 날짜별로 보여준다", async () => {
  const message = await buildWeeklyDigest({
    targets: [target],
    today: "2026-11-22",
    getBookableDates: async () =>
      response([day("2026-11-23", "17"), day("2026-11-24"), day("2026-11-25"), day("2026-11-26", "13"), day("2026-11-27")]),
  });

  assert.match(message, /다음 주 출근버스<\/b> \(11\/23\(월\) ~ 11\/27\(금\)\)/);
  assert.match(message, /11\/23\(월\) ✅ 17번/);
  assert.match(message, /11\/24\(화\) 👀 빈자리 감지 중/);
  assert.match(message, /11\/25\(수\) · 예약 안 함/);
  assert.match(message, /11\/26\(목\) ✅ 13번/);
  assert.match(message, /11\/27\(금\) ❗ 예약 안 됨/);
  assert.match(message, /빈자리 감지 날짜로 넣어 주세요/);
  assert.doesNotMatch(message, /M4434/);
});

test("공휴일과 운행하지 않는 날은 예약 안 됨으로 치지 않는다", async () => {
  const message = await buildWeeklyDigest({
    targets: [{ ...target, monitorDates: [] }],
    today: "2026-12-20",
    holidays: [{ date: "2026-12-25", name: "성탄절" }],
    getBookableDates: async () => response([day("2026-12-21", "17"), day("2026-12-22"), day("2026-12-23"), day("2026-12-24", "17")]),
  });

  assert.match(message, /12\/25\(금\) 🎌 성탄절/);
  assert.doesNotMatch(message, /❗/);
});

test("노선이 여럿이면 예약마다 노선 이름을 붙인다", async () => {
  const other = { ...target, name: "퇴근", lineTurnUid: "turn2" };
  const message = await buildWeeklyDigest({
    targets: [target, other],
    today: "2026-11-22",
    getBookableDates: async (t) => response([day("2026-11-23", t.name === "퇴근" ? "5" : "17")]),
  });
  assert.match(message, /11\/23\(월\) ✅ \[M4434\] 06:35 버스 17번, 퇴근 5번/);
});

test("모니터는 일요일 20시 이후 한 번만 주간 현황을 보내고 평일에는 보내지 않는다", async () => {
  let now = Date.parse("2026-11-22T20:05:00+09:00");
  const state = new RuntimeState({ now: () => now });
  state.markMonitorRun();
  const messages = [];
  const deps = {
    getBookableDates: async () => response([day("2026-11-23", "17")]),
    sendTelegram: async (message) => messages.push(message),
    flushTelegramOutbox: async () => {},
  };
  const config = { targets: [{ ...target, monitorEnabled: false, monitorDates: [] }] };

  await runMonitor({ config, state, deps });
  now += 5 * 60 * 1000;
  await runMonitor({ config, state, deps });
  assert.equal(messages.filter((m) => m.includes("다음 주 출근버스")).length, 1);

  now = Date.parse("2026-11-23T20:05:00+09:00");
  state.markMonitorRun();
  await runMonitor({ config, state, deps });
  assert.equal(messages.filter((m) => m.includes("다음 주 출근버스")).length, 1);
  assert.equal(messages.some((m) => m.includes("일일 상태")), false);
});

test("주간 현황 조회가 실패하면 표시하지 않고 다음 실행에서 다시 시도한다", async () => {
  const now = Date.parse("2026-11-22T21:00:00+09:00");
  const state = new RuntimeState({ now: () => now });
  const messages = [];
  let fail = true;
  const deps = {
    getBookableDates: async () => (fail ? { resultCode: 500, resultMessage: "점검 중" } : response([])),
    sendTelegram: async (message) => messages.push(message),
    flushTelegramOutbox: async () => {},
  };
  const config = { targets: [{ ...target, monitorEnabled: false, monitorDates: [] }] };

  await runMonitor({ config, state, deps });
  assert.equal(state.state.weeklyDigestDate, null);
  fail = false;
  await runMonitor({ config, state, deps });
  assert.equal(state.state.weeklyDigestDate, "2026-11-22");
  assert.equal(messages.filter((m) => m.includes("다음 주 출근버스")).length, 1);
});
