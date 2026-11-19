"use strict";

const { escapeHtml } = require("./telegram");
const { flattenBookableDates, flattenHolidays } = require("./monitoring");

const WEEKDAY_CODES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function addDays(date, days) {
  const cursor = new Date(`${date}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10);
}

const weekdayOf = (date) => WEEKDAY_CODES[new Date(`${date}T00:00:00Z`).getUTCDay()];

function shortDate(date) {
  const d = new Date(`${date}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${"일월화수목금토"[d.getUTCDay()]})`;
}

// today 다음에 오는 월~금 다섯 날짜.
function nextWeekdays(today) {
  let monday = addDays(today, 1);
  while (weekdayOf(monday) !== "MON") monday = addDays(monday, 1);
  return [0, 1, 2, 3, 4].map((offset) => addDays(monday, offset));
}

// 자동예약은 7일 전 10:00에 열리므로 일요일에 보면 다음 주 예약은 이미 결과가 나와 있다.
// MiRi가 돌려주는 myBooks를 쓰므로 앱에서 직접 예약하거나 취소한 것도 그대로 반영된다.
async function buildWeeklyDigest({ targets, today, holidays = [], getBookableDates }) {
  const relevant = targets.filter((t) => t.autoBookEnabled || t.monitorEnabled);
  if (!relevant.length) return null;

  const dates = nextWeekdays(today);
  const operating = new Set();
  const booked = new Map(); // date -> [{ name, seatNo }]
  const holidayNames = new Map(holidays.map((h) => [h.date, h.name]));

  for (const target of relevant) {
    const response = await getBookableDates(target);
    if (response.resultCode !== 0) {
      throw new Error(response.resultMessage || "예약 가능 날짜 조회 실패");
    }
    for (const holiday of flattenHolidays(response.data)) holidayNames.set(holiday.date, holiday.name);
    for (const info of flattenBookableDates(response.data)) {
      operating.add(info.date);
      for (const book of info.myBooks || []) {
        const list = booked.get(info.date) || [];
        list.push({ name: target.name, seatNo: book.seatNo });
        booked.set(info.date, list);
      }
    }
  }

  const showNames = relevant.length > 1;
  let missing = 0;
  const lines = dates.map((date) => {
    const weekday = weekdayOf(date);
    let status;
    if (booked.has(date)) {
      status = "✅ " + booked
        .get(date)
        .map((b) => (showNames ? `${escapeHtml(b.name)} ` : "") + `${escapeHtml(b.seatNo)}번`)
        .join(", ");
    } else if (holidayNames.has(date)) {
      status = `🎌 ${escapeHtml(holidayNames.get(date))}`;
    } else if (relevant.some((t) => t.monitorEnabled && t.monitorDates?.includes(date))) {
      status = "👀 빈자리 감지 중";
    } else if (relevant.some((t) => t.autoBookEnabled && t.weekdays?.includes(weekday))) {
      missing += 1;
      status = "❗ 예약 안 됨";
    } else if (!operating.has(date)) {
      status = "· 운행 없음";
    } else {
      status = "· 예약 안 함";
    }
    return `${shortDate(date)} ${status}`;
  });

  let message =
    `🗓 <b>다음 주 출근버스</b> (${shortDate(dates[0])} ~ ${shortDate(dates[4])})\n` + lines.join("\n");
  if (missing) {
    message += `\n\n❗ 표시한 날은 설정 페이지에서 빈자리 감지 날짜로 넣어 주세요.`;
  }
  return message;
}

module.exports = { buildWeeklyDigest, nextWeekdays };
