const assert = require("node:assert/strict");
const test = require("node:test");

const { attemptBooking } = require("../lib/booking");

test("dry-run은 좌석을 선택하지만 예약 API를 호출하지 않는다", async () => {
  let bookCalls = 0;
  const result = await attemptBooking({
    target: {
      lineTurnUid: "line",
      seatPreference: { preferredSeats: [17], fallbackMode: "any" },
    },
    dateInfo: { date: "2026-07-14", allocs: [{ allocUid: "alloc" }] },
    dryRun: true,
    deps: {
      getBookableSeats: async () => ({ resultCode: 0, data: [{ seats: [] }] }),
      selectBestSeat: () => ({ seatNo: 17 }),
      bookSeat: async () => {
        bookCalls += 1;
      },
    },
  });

  assert.equal(result.status, "DRY_RUN");
  assert.equal(result.seatNo, 17);
  assert.equal(bookCalls, 0);
});

test("allocUid가 없으면 예약을 시도하지 않는다", async () => {
  const result = await attemptBooking({
    target: { lineTurnUid: "line" },
    dateInfo: { date: "2026-07-14", allocs: [] },
    deps: {},
  });

  assert.equal(result.status, "NO_ALLOC");
});

test("예약 API 성공 결과를 구조화해 반환한다", async () => {
  const result = await attemptBooking({
    target: { lineTurnUid: "line", seatPreference: {} },
    dateInfo: { date: "2026-07-14", allocs: [{ allocUid: "alloc" }] },
    deps: {
      getBookableSeats: async () => ({ resultCode: 0, data: [] }),
      selectBestSeat: () => ({ seatNo: 9 }),
      bookSeat: async () => ({ resultCode: 0, data: [{ departureTimeText: "06:35" }] }),
    },
  });

  assert.equal(result.status, "BOOKED");
  assert.equal(result.seatNo, 9);
  assert.equal(result.info.departureTimeText, "06:35");
});
