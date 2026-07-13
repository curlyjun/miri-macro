const assert = require("node:assert/strict");
const test = require("node:test");

const { getTargetDate, runAutoBookTargets } = require("../lib/auto-booking");

test("KST 기준 7일 뒤 날짜와 요일을 계산한다", () => {
  const result = getTargetDate(Date.parse("2026-07-12T16:00:00Z"));
  assert.deepEqual(result, { date: "2026-07-20", weekday: "MON" });
});

test("자동예약이 꺼진 대상과 요일이 맞지 않는 대상을 건너뛴다", async () => {
  let dateCalls = 0;
  const summary = await runAutoBookTargets({
    targets: [
      { name: "꺼짐", autoBookEnabled: false, weekdays: ["MON"] },
      { name: "화요일", autoBookEnabled: true, weekdays: ["TUE"] },
    ],
    targetDate: "2026-07-20",
    targetWeekday: "MON",
    deps: {
      getBookableDates: async () => {
        dateCalls += 1;
      },
      attemptBooking: async () => ({ status: "BOOKED" }),
    },
  });

  assert.equal(dateCalls, 0);
  assert.equal(summary.targetsChecked, 0);
});

test("여러 월 응답에서 대상 날짜를 찾아 공통 예약 엔진을 호출한다", async () => {
  const attempts = [];
  const summary = await runAutoBookTargets({
    targets: [{ name: "출근", autoBookEnabled: true, weekdays: ["MON"] }],
    targetDate: "2026-08-03",
    targetWeekday: "MON",
    deps: {
      getBookableDates: async () => ({
        resultCode: 0,
        data: [
          { bookableDates: [{ date: "2026-07-31" }] },
          { bookableDates: [{ date: "2026-08-03", bookableYn: true, seatRemainYn: true }] },
        ],
      }),
      attemptBooking: async (args) => {
        attempts.push(args);
        return { status: "BOOKED", seatNo: 9 };
      },
    },
  });

  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].dateInfo.date, "2026-08-03");
  assert.equal(summary.booked, 1);
});

test("예약 날짜가 아직 열리지 않았으면 설정된 횟수만큼 다시 확인한다", async () => {
  let calls = 0;
  const summary = await runAutoBookTargets({
    targets: [{ name: "출근", autoBookEnabled: true, weekdays: ["MON"] }],
    targetDate: "2026-08-03",
    targetWeekday: "MON",
    maxAttempts: 3,
    deps: {
      getBookableDates: async () => {
        calls += 1;
        return { resultCode: 0, data: [] };
      },
      attemptBooking: async () => ({ status: "BOOKED" }),
      sleep: async () => {},
    },
  });

  assert.equal(calls, 3);
  assert.equal(summary.notOpen, 1);
});

test("이미 예약된 날짜는 예약 가능 플래그와 무관하게 완료 처리한다", async () => {
  let attempts = 0;
  const summary = await runAutoBookTargets({
    targets: [{ name: "출근", autoBookEnabled: true, weekdays: ["MON"] }],
    targetDate: "2026-08-03",
    targetWeekday: "MON",
    maxAttempts: 1,
    deps: {
      getBookableDates: async () => ({
        resultCode: 0,
        data: [
          {
            bookableDates: [
              {
                date: "2026-08-03",
                bookableYn: false,
                seatRemainYn: false,
                myBookRangeCount: 1,
              },
            ],
          },
        ],
      }),
      attemptBooking: async () => {
        attempts += 1;
      },
    },
  });

  assert.equal(summary.alreadyBooked, 1);
  assert.equal(attempts, 0);
});
