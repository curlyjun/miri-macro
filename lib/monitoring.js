"use strict";

function flattenBookableDates(groups) {
  return Array.isArray(groups)
    ? groups.flatMap((group) => (Array.isArray(group?.bookableDates) ? group.bookableDates : []))
    : [];
}

// 공휴일은 운행하지 않아 bookableDates에서 빠지고, 월별 calendarHolidays에만 이름과 함께 실린다.
function flattenHolidays(groups) {
  return Array.isArray(groups)
    ? groups
        .flatMap((group) => (Array.isArray(group?.calendarHolidays) ? group.calendarHolidays : []))
        .filter((holiday) => holiday?.date)
        .map((holiday) => ({ date: holiday.date, name: holiday.displayText || "공휴일" }))
    : [];
}

async function runMonitorTargets({ targets, today, dryRun = false, deps }) {
  const summary = {
    targetsChecked: 0,
    datesChecked: 0,
    booked: 0,
    dryRuns: 0,
    errors: [],
    completedDates: [],
  };

  for (const target of targets) {
    if (!target.monitorEnabled || !target.monitorDates?.length) continue;
    summary.targetsChecked += 1;
    try {
      const response = await deps.getBookableDates(target);
      if (response.resultCode !== 0) {
        throw new Error(response.resultMessage || "예약 가능 날짜 조회 실패");
      }

      const dates = flattenBookableDates(response.data);
      deps.onHolidays?.(flattenHolidays(response.data));
      for (const dateInfo of dates) {
        if (!target.monitorDates.includes(dateInfo.date) || dateInfo.date < today) continue;
        summary.datesChecked += 1;
        const alreadyBooked =
          dateInfo.myBookRangeCount > 0 || dateInfo.myBooks?.length > 0;
        if (alreadyBooked) {
          summary.completedDates.push({ target: target.name, date: dateInfo.date });
          continue;
        }
        if (!dateInfo.bookableYn || !dateInfo.seatRemainYn) continue;

        const result = await deps.attemptBooking({ target, dateInfo, dryRun, deps });
        deps.onResult?.({ target, dateInfo, result, dryRun });
        if (result.status === "BOOKED") {
          summary.booked += 1;
          summary.completedDates.push({ target: target.name, date: dateInfo.date });
        } else if (result.status === "DRY_RUN") {
          summary.dryRuns += 1;
        } else if (result.status === "API_ERROR") {
          throw new Error(result.message);
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

module.exports = { flattenBookableDates, flattenHolidays, runMonitorTargets };
