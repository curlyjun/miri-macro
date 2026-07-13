const assert = require("node:assert/strict");
const test = require("node:test");

const { selectBestSeat } = require("../lib/common");

const seatsData = [
  {
    seats: [
      [
        { seatNo: 1, bookedYn: false, priority: 2 },
        { seatNo: 2, bookedYn: false, priority: 1 },
      ],
    ],
  },
];

test("any 정책은 선호 좌석이 없으면 남은 좌석으로 폴백한다", () => {
  const seat = selectBestSeat(seatsData, {
    preferredSeats: [17],
    fallbackMode: "any",
  });

  assert.equal(seat.seatNo, 2);
});

test("preferredOnly 정책은 선호 좌석이 없으면 예약하지 않는다", () => {
  const seat = selectBestSeat(seatsData, {
    preferredSeats: [17],
    fallbackMode: "preferredOnly",
  });

  assert.equal(seat, null);
});
