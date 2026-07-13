const assert = require("node:assert/strict");
const test = require("node:test");

const { flattenBookableDates, runMonitorTargets } = require("../lib/monitoring");

test("월별 응답에 나뉜 모든 예약 가능 날짜를 합친다", () => {
  const dates = flattenBookableDates([
    { bookableDates: [{ date: "2026-07-31" }] },
    { bookableDates: [{ date: "2026-08-01" }] },
  ]);

  assert.deepEqual(dates.map((item) => item.date), ["2026-07-31", "2026-08-01"]);
});

test("다음 달 모니터 날짜도 공통 예약 엔진에 전달한다", async () => {
  const attempts = [];
  const results = [];
  const summary = await runMonitorTargets({
    targets: [
      {
        name: "출근",
        lineTurnUid: "line",
        monitorEnabled: true,
        monitorDates: ["2026-08-01"],
      },
    ],
    today: "2026-07-13",
    dryRun: true,
    deps: {
      getBookableDates: async () => ({
        resultCode: 0,
        data: [
          { bookableDates: [{ date: "2026-07-31" }] },
          {
            bookableDates: [
              {
                date: "2026-08-01",
                bookableYn: true,
                seatRemainYn: true,
                allocs: [{ allocUid: "alloc" }],
              },
            ],
          },
        ],
      }),
      attemptBooking: async (args) => {
        attempts.push(args);
        return { status: "DRY_RUN", seatNo: 17 };
      },
      onResult: (item) => results.push(item),
    },
  });

  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].dateInfo.date, "2026-08-01");
  assert.equal(attempts[0].dryRun, true);
  assert.equal(summary.dryRuns, 1);
  assert.equal(results[0].result.seatNo, 17);
});

test("대상 오류를 모아 다음 대상을 계속 처리한다", async () => {
  const errors = [];
  const summary = await runMonitorTargets({
    targets: [
      { name: "오류", monitorEnabled: true, monitorDates: ["2026-07-14"] },
      { name: "정상", monitorEnabled: true, monitorDates: ["2026-07-14"] },
    ],
    today: "2026-07-13",
    deps: {
      getBookableDates: async (target) => {
        if (target.name === "오류") throw new Error("network");
        return { resultCode: 0, data: [] };
      },
      attemptBooking: async () => ({ status: "BOOKED" }),
      onError: (item) => errors.push(item),
    },
  });

  assert.equal(errors.length, 1);
  assert.equal(summary.errors.length, 1);
  assert.equal(summary.targetsChecked, 2);
});
