const assert = require("node:assert/strict");
const test = require("node:test");

const { describeSleepGap, findMissedAutobooks } = require("../monitor");

const TARGETS = [{ name: "출근", autoBookEnabled: true, weekdays: ["MON", "THU", "FRI"] }];
const at = (iso) => Date.parse(`${iso}+09:00`);

test("잠든 사이 실행되지 않은 10:00 자동예약 중 예약 요일인 날만 놓친 것으로 본다", () => {
  // 11/12(목) 10:00 → 11/19(목) 대상, 11/13(금) → 11/20(금), 11/14(토) → 11/21(토, 요일 아님)
  const missed = findMissedAutobooks({
    previous: at("2026-11-12T09:30:00"),
    now: at("2026-11-14T12:00:00"),
    targets: TARGETS,
    autobookRuns: ["2026-11-13"],
  });

  assert.deepEqual(missed, [{ day: "2026-11-12", targetDate: "2026-11-19", names: ["출근"] }]);
});

test("공휴일 대상, 아직 여유 시간 안인 실행, 잠들기 전 실행은 놓친 것으로 보지 않는다", () => {
  assert.deepEqual(findMissedAutobooks({
    previous: at("2026-11-12T09:30:00"),
    now: at("2026-11-12T11:00:00"),
    targets: TARGETS,
    holidays: [{ date: "2026-11-19", name: "휴일" }],
  }), []);
  assert.deepEqual(findMissedAutobooks({
    previous: at("2026-11-12T09:30:00"),
    now: at("2026-11-12T10:03:00"),
    targets: TARGETS,
  }), []);
  assert.deepEqual(findMissedAutobooks({
    previous: at("2026-11-12T10:30:00"),
    now: at("2026-11-12T20:00:00"),
    targets: TARGETS,
  }), []);
});

test("잠든 시간과 놓친 자동예약을 알림 문구로 만든다", () => {
  const message = describeSleepGap({
    previous: at("2026-11-12T09:30:00"),
    now: at("2026-11-12T11:05:00"),
    missed: [{ day: "2026-11-12", targetDate: "2026-11-19", names: ["출근 <06:35>"] }],
  });

  assert.match(message, /11\/12 09:30 ~ 11\/12 11:05 \(1시간 35분\)/);
  assert.match(message, /11\/12\(목\) 10:00 → 11\/19\(목\) 출근 &lt;06:35&gt;/);
  assert.match(message, /Amphetamine/);
});
