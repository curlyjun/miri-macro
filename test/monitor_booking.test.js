const assert = require("node:assert/strict");
const test = require("node:test");

const { bookAvailableSeat } = require("../lib/monitor_booking");

test("books the selected seat and sends a monitor success message", async () => {
  const calls = [];
  const target = {
    name: "[M4434] 06:35 버스",
    lineTurnUid: "line-turn-1",
    seatPreference: { preferredSeats: [17] },
  };
  const dateInfo = {
    date: "2026-07-14",
    allocs: [{ allocUid: "alloc-1" }],
  };

  const result = await bookAvailableSeat({
    target,
    dateInfo,
    executedAt: "2026. 7. 13. 오전 9:00:00",
    deps: {
      getBookableSeats: async (lineTurnUid, date, allocUid) => {
        calls.push(["getBookableSeats", lineTurnUid, date, allocUid]);
        return {
          resultCode: 0,
          data: [{ seats: [[{ seatNo: 17, bookedYn: false, priority: 2 }]] }],
        };
      },
      selectBestSeat: (seatsData, pref) => {
        calls.push(["selectBestSeat", seatsData.length, pref.preferredSeats[0]]);
        return { seatNo: 17 };
      },
      bookSeat: async (bookTarget, date, allocUid, seatNo) => {
        calls.push(["bookSeat", bookTarget.name, date, allocUid, seatNo]);
        return {
          resultCode: 0,
          data: [
            {
              departureTimeText: "06:35",
              arrivalTimeText: "07:25",
              expectedOnStationName: "승차",
              expectedOffStationName: "하차",
            },
          ],
        };
      },
      sendTelegram: async (message) => {
        calls.push(["sendTelegram", message]);
      },
    },
  });

  assert.equal(result.booked, true);
  assert.equal(result.seatNo, 17);
  assert.deepEqual(calls.slice(0, 3), [
    ["getBookableSeats", "line-turn-1", "2026-07-14", "alloc-1"],
    ["selectBestSeat", 1, 17],
    ["bookSeat", "[M4434] 06:35 버스", "2026-07-14", "alloc-1", 17],
  ]);
  assert.match(calls[3][1], /빈 좌석 발견/);
  assert.match(calls[3][1], /17번 좌석 예약 완료/);
});

test("sends a failure message when no selectable seat remains", async () => {
  const messages = [];

  const result = await bookAvailableSeat({
    target: {
      name: "[M4434] 06:35 버스",
      lineTurnUid: "line-turn-1",
      seatPreference: { preferredSeats: [17] },
    },
    dateInfo: {
      date: "2026-07-14",
      allocs: [{ allocUid: "alloc-1" }],
    },
    executedAt: "2026. 7. 13. 오전 9:00:00",
    deps: {
      getBookableSeats: async () => ({ resultCode: 0, data: [] }),
      selectBestSeat: () => null,
      bookSeat: async () => {
        throw new Error("bookSeat should not be called");
      },
      sendTelegram: async (message) => messages.push(message),
    },
  });

  assert.equal(result.booked, false);
  assert.equal(result.reason, "NO_SEAT");
  assert.match(messages[0], /빈 좌석 알림 후 좌석 선택 실패/);
});
