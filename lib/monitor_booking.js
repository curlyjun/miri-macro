"use strict";

async function bookAvailableSeat({ target, dateInfo, executedAt, deps }) {
  const allocUid = dateInfo.allocs?.[0]?.allocUid;
  if (!allocUid) {
    const message =
      `❌ <b>빈 좌석 알림 후 예약 실패</b>\n` +
      `🚌 ${target.name}\n` +
      `📅 ${dateInfo.date}\n` +
      `사유: allocUid 없음\n` +
      `🕐 실행 시간: ${executedAt}`;
    await deps.sendTelegram(message);
    return { booked: false, reason: "NO_ALLOC" };
  }

  console.log(`  [${dateInfo.date}] 좌석 조회 중 (allocUid=${allocUid})`);
  const seatsJson = await deps.getBookableSeats(
    target.lineTurnUid,
    dateInfo.date,
    allocUid,
  );

  if (seatsJson.resultCode !== 0) {
    const message =
      `❌ <b>빈 좌석 알림 후 좌석 조회 실패</b>\n` +
      `🚌 ${target.name}\n` +
      `📅 ${dateInfo.date}\n` +
      `사유: ${seatsJson.resultMessage}\n` +
      `🕐 실행 시간: ${executedAt}`;
    await deps.sendTelegram(message);
    return { booked: false, reason: "SEAT_API_ERROR" };
  }

  const bestSeat = deps.selectBestSeat(seatsJson.data, target.seatPreference);
  if (!bestSeat) {
    const message =
      `❌ <b>빈 좌석 알림 후 좌석 선택 실패</b>\n` +
      `🚌 ${target.name}\n` +
      `📅 ${dateInfo.date}\n` +
      `사유: 선택 가능한 좌석 없음\n` +
      `🕐 실행 시간: ${executedAt}`;
    await deps.sendTelegram(message);
    return { booked: false, reason: "NO_SEAT" };
  }

  console.log(`  [${dateInfo.date}] 예약 시도: ${bestSeat.seatNo}번 좌석`);
  const bookResult = await deps.bookSeat(
    target,
    dateInfo.date,
    allocUid,
    bestSeat.seatNo,
  );

  if (bookResult.resultCode !== 0) {
    const message =
      `❌ <b>빈 좌석 발견했지만 예약 실패</b>\n` +
      `🚌 ${target.name}\n` +
      `📅 ${dateInfo.date}\n` +
      `💺 시도 좌석: ${bestSeat.seatNo}번\n` +
      `사유: ${bookResult.resultMessage}\n` +
      `🕐 실행 시간: ${executedAt}`;
    await deps.sendTelegram(message);
    return { booked: false, reason: "BOOK_API_ERROR", seatNo: bestSeat.seatNo };
  }

  const info = bookResult.data?.[0] || {};
  const message =
    `✅ <b>빈 좌석 발견 - 예약 완료!</b>\n` +
    `🚌 ${target.name}\n` +
    `📅 ${dateInfo.date}\n` +
    `💺 ${bestSeat.seatNo}번 좌석 예약 완료\n` +
    `⏰ ${info.departureTimeText ?? ""} 출발 → ${info.arrivalTimeText ?? ""} 도착\n` +
    `📍 ${info.expectedOnStationName ?? ""} → ${info.expectedOffStationName ?? ""}\n` +
    `🕐 실행 시간: ${executedAt}`;
  await deps.sendTelegram(message);

  return { booked: true, seatNo: bestSeat.seatNo };
}

module.exports = {
  bookAvailableSeat,
};
