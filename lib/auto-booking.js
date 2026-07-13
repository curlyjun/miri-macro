"use strict";

const { WEEKDAY_MAP } = require("./common");
const { flattenBookableDates } = require("./monitoring");

function getTargetDate(now = Date.now()) {
  const target = new Date(now + 9 * 3600 * 1000 + 7 * 24 * 3600 * 1000);
  return {
    date: target.toISOString().slice(0, 10),
    weekday: WEEKDAY_MAP[target.getUTCDay()],
  };
}

async function runAutoBookTargets({
  targets,
  targetDate,
  targetWeekday,
  maxAttempts = 5,
  retryDelayMs = 10000,
  deps,
}) {
  const summary = {
    targetsChecked: 0,
    booked: 0,
    alreadyBooked: 0,
    notOpen: 0,
    errors: [],
  };

  for (const target of targets) {
    if (!target.autoBookEnabled || !target.weekdays?.includes(targetWeekday)) continue;
    summary.targetsChecked += 1;
    try {
      let finished = false;
      for (let attempt = 1; attempt <= maxAttempts && !finished; attempt += 1) {
        const response = await deps.getBookableDates(target);
        if (response.resultCode !== 0) {
          throw new Error(response.resultMessage || "예약 가능 날짜 조회 실패");
        }
        const dateInfo = flattenBookableDates(response.data).find(
          (item) => item.date === targetDate,
        );
        const alreadyBooked =
          dateInfo &&
          (dateInfo.myBookRangeCount > 0 || dateInfo.myBooks?.length > 0);
        if (alreadyBooked) {
          summary.alreadyBooked += 1;
          deps.onResult?.({ target, dateInfo, result: { status: "ALREADY_BOOKED" } });
          break;
        }
        if (!dateInfo || !dateInfo.bookableYn || !dateInfo.seatRemainYn) {
          if (attempt < maxAttempts) {
            await (deps.sleep || (() => Promise.resolve()))(retryDelayMs);
            continue;
          }
          summary.notOpen += 1;
          deps.onResult?.({
            target,
            dateInfo,
            result: { status: dateInfo ? "NOT_BOOKABLE" : "NOT_OPEN", date: targetDate },
          });
          break;
        }

        const result = await deps.attemptBooking({ target, dateInfo, deps });
        deps.onResult?.({ target, dateInfo, result });
        if (result.status === "BOOKED") {
          summary.booked += 1;
          finished = true;
        } else if (result.status === "API_ERROR") {
          throw new Error(result.message);
        } else if (attempt < maxAttempts) {
          await (deps.sleep || (() => Promise.resolve()))(retryDelayMs);
        }
      }
    } catch (error) {
      const item = { target: target.name, message: error.message, error };
      summary.errors.push(item);
      deps.onError?.(item);
    }
  }

  return summary;
}

module.exports = { getTargetDate, runAutoBookTargets };
