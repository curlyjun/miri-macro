"use strict";

const { attemptBooking } = require("./booking");
const { escapeHtml } = require("./telegram");

async function bookAvailableSeat({ target, dateInfo, executedAt, deps }) {
  console.log(`  [${dateInfo.date}] 좌석 조회 및 예약 시도`);
  const result = await attemptBooking({ target, dateInfo, deps });

  const common =
    `🚌 ${escapeHtml(target.name)}\n` +
    `📅 ${escapeHtml(dateInfo.date)}\n`;
  let message;
  if (result.status === "BOOKED") {
    const info = result.info || {};
    message =
      `✅ <b>빈 좌석 발견 - 예약 완료!</b>\n` +
      common +
      `💺 ${escapeHtml(result.seatNo)}번 좌석 예약 완료\n` +
      `⏰ ${escapeHtml(info.departureTimeText)} 출발 → ${escapeHtml(info.arrivalTimeText)} 도착\n` +
      `📍 ${escapeHtml(info.expectedOnStationName)} → ${escapeHtml(info.expectedOffStationName)}\n` +
      `🕐 실행 시간: ${escapeHtml(executedAt)}`;
    await deps.sendTelegram(message);
    return { booked: true, seatNo: result.seatNo };
  }

  const reasonMap = {
    NO_ALLOC: "allocUid 없음",
    NO_SEAT: "선택 가능한 좌석 없음",
    API_ERROR: result.message || "MiRi API 오류",
  };
  const title = result.stage === "BOOK"
    ? "빈 좌석 발견했지만 예약 실패"
    : result.stage === "SEATS"
      ? "빈 좌석 알림 후 좌석 조회 실패"
      : result.status === "NO_SEAT"
        ? "빈 좌석 알림 후 좌석 선택 실패"
        : "빈 좌석 알림 후 예약 실패";
  message =
    `❌ <b>${title}</b>\n` +
    common +
    (result.seatNo ? `💺 시도 좌석: ${escapeHtml(result.seatNo)}번\n` : "") +
    `사유: ${escapeHtml(reasonMap[result.status] || result.status)}\n` +
    `🕐 실행 시간: ${escapeHtml(executedAt)}`;
  await deps.sendTelegram(message);
  return {
    booked: false,
    reason: result.status === "API_ERROR"
      ? result.stage === "BOOK" ? "BOOK_API_ERROR" : "SEAT_API_ERROR"
      : result.status,
    seatNo: result.seatNo,
  };
}

module.exports = { bookAvailableSeat };
