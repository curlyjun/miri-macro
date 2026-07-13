"use strict";

async function attemptBooking({ target, dateInfo, dryRun = false, deps }) {
  const allocUid = dateInfo.allocs?.[0]?.allocUid;
  if (!allocUid) return { status: "NO_ALLOC", date: dateInfo.date };

  const seatsJson = await deps.getBookableSeats(
    target.lineTurnUid,
    dateInfo.date,
    allocUid,
  );
  if (seatsJson.resultCode !== 0) {
    return {
      status: "API_ERROR",
      stage: "SEATS",
      message: seatsJson.resultMessage || "좌석 조회 실패",
    };
  }

  const seat = deps.selectBestSeat(seatsJson.data, target.seatPreference);
  if (!seat) return { status: "NO_SEAT", date: dateInfo.date };

  if (dryRun) {
    return { status: "DRY_RUN", date: dateInfo.date, seatNo: seat.seatNo, allocUid };
  }

  const bookResult = await deps.bookSeat(target, dateInfo.date, allocUid, seat.seatNo);
  if (bookResult.resultCode !== 0) {
    return {
      status: "API_ERROR",
      stage: "BOOK",
      seatNo: seat.seatNo,
      message: bookResult.resultMessage || "예약 실패",
    };
  }

  return {
    status: "BOOKED",
    date: dateInfo.date,
    seatNo: seat.seatNo,
    info: bookResult.data?.[0] || {},
  };
}

module.exports = { attemptBooking };
