"use strict";

const { WEEKDAY_MAP } = require("./common");
const { flattenBookableDates } = require("./monitoring");

// 예약은 매일 10:00 KST에 열린다. cron은 09:59에 띄워 토큰 준비를 미리 끝내 둔다.
const OPEN_HOUR_KST = 10;
const MAX_EARLY_START_MS = 5 * 60 * 1000;

// 열리는 순간 좌석이 빠지므로 처음 30초는 1초 간격으로, 그 뒤로는 10초 간격으로 1분 더 확인한다.
const DEFAULT_RETRY_DELAYS_MS = [...Array(30).fill(1000), ...Array(6).fill(10000)];

function getTargetDate(now = Date.now()) {
  const target = new Date(now + 9 * 3600 * 1000 + 7 * 24 * 3600 * 1000);
  return {
    date: target.toISOString().slice(0, 10),
    weekday: WEEKDAY_MAP[target.getUTCDay()],
  };
}

// 열리기 5분 안에 시작했으면 10:00:00 정각까지 기다릴 시간을, 아니면 0을 돌려준다.
function msUntilOpen(now = Date.now()) {
  const kst = new Date(now + 9 * 3600 * 1000);
  const openAt =
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), OPEN_HOUR_KST) -
    9 * 3600 * 1000;
  const wait = openAt - now;
  return wait > 0 && wait <= MAX_EARLY_START_MS ? wait : 0;
}

async function runAutoBookTargets({
  targets,
  targetDate,
  targetWeekday,
  maxAttempts,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  deps,
}) {
  const summary = {
    targetsChecked: 0,
    booked: 0,
    alreadyBooked: 0,
    notOpen: 0,
    errors: [],
  };
  const attempts = maxAttempts ?? retryDelaysMs.length + 1;
  const delayAfter = (attempt) => retryDelaysMs[Math.min(attempt - 1, retryDelaysMs.length - 1)];
  const sleep = deps.sleep || (() => Promise.resolve());

  for (const target of targets) {
    if (!target.autoBookEnabled || !target.weekdays?.includes(targetWeekday)) continue;
    summary.targetsChecked += 1;
    try {
      let finished = false;
      for (let attempt = 1; attempt <= attempts && !finished; attempt += 1) {
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
          if (attempt < attempts) {
            await sleep(delayAfter(attempt));
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
        } else if (attempt < attempts) {
          await sleep(delayAfter(attempt));
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

module.exports = { DEFAULT_RETRY_DELAYS_MS, getTargetDate, msUntilOpen, runAutoBookTargets };
