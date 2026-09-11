var ConfigUtils = (function createConfigUtils() {
  "use strict";

  const DAY_CODES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
  const WEEK_ORDER = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  const KST_OFFSET_MS = 9 * 3600 * 1000;
  // 자동예약은 매일 이 시각(KST)에 7일 뒤 날짜를 예약한다.
  const AUTOBOOK_HOUR_KST = 10;
  const COMPARED_FIELDS = [
    "name", "lineTurnUid", "onStationUid", "offStationUid",
    "autoBookEnabled", "weekdays", "monitorEnabled", "monitorDates", "seatPreference",
  ];

  function normalizeUiTarget(target = {}) {
    const weekdays = Array.isArray(target.weekdays) ? target.weekdays : [];
    const monitorDates = Array.isArray(target.monitorDates) ? target.monitorDates : [];
    return {
      ...target,
      autoBookEnabled:
        typeof target.autoBookEnabled === "boolean"
          ? target.autoBookEnabled
          : weekdays.length > 0,
      monitorEnabled:
        typeof target.monitorEnabled === "boolean"
          ? target.monitorEnabled
          : monitorDates.length > 0,
      weekdays: [...new Set(weekdays)].sort((a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b)),
      monitorDates: [...new Set(monitorDates)].sort(),
      seatPreference: {
        preferredSeats: Array.isArray(target.seatPreference?.preferredSeats)
          ? target.seatPreference.preferredSeats
          : [],
        fallbackMode:
          target.seatPreference?.fallbackMode === "preferredOnly"
            ? "preferredOnly"
            : "any",
      },
    };
  }

  // fields는 화면에서 오류를 해당 칸 옆에 붙이기 위한 칸별 첫 오류다.
  function validateUiTarget(input, today) {
    const target = normalizeUiTarget(input);
    const errors = [];
    const fields = {};
    const fail = (field, message) => {
      errors.push(message);
      if (!fields[field]) fields[field] = message;
    };
    if (!target.name?.trim()) fail("name", "예약 이름을 입력해 주세요.");
    if (!target.lineTurnUid) fail("route", "노선을 선택해주세요.");
    if (!target.onStationUid) fail("route", "승차 정류장을 선택해주세요.");
    if (!target.offStationUid) fail("route", "하차 정류장을 선택해주세요.");
    if (target.autoBookEnabled && target.weekdays.length === 0) {
      fail("weekdays", "자동예약 요일을 하나 이상 선택해주세요.");
    }
    if (target.monitorEnabled && target.monitorDates.length === 0) {
      fail("monitorDates", "빈자리 확인 날짜를 하나 이상 골라 주세요.");
    }
    if (target.monitorEnabled && today && target.monitorDates.some((date) => date < today)) {
      fail("monitorDates", "지난 날짜가 남아 있어요. 정리해 주세요.");
    }
    return { valid: errors.length === 0, errors, fields, target };
  }

  function kstToday(now = Date.now()) {
    return new Date(now + KST_OFFSET_MS).toISOString().slice(0, 10);
  }

  function addDays(date, days) {
    const cursor = new Date(`${date}T00:00:00Z`);
    cursor.setUTCDate(cursor.getUTCDate() + days);
    return cursor.toISOString().slice(0, 10);
  }

  function weekdayOf(date) {
    return DAY_CODES[new Date(`${date}T00:00:00Z`).getUTCDay()];
  }

  // "2026-09-17" → "9/17(목)". 올해가 아니면 연도를 붙인다.
  function formatShortDate(date, today) {
    const d = new Date(`${date}T00:00:00Z`);
    const label = `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${DAY_LABELS[d.getUTCDay()]})`;
    return today && date.slice(0, 4) !== today.slice(0, 4) ? `${date.slice(0, 4)}년 ${label}` : label;
  }

  // 오늘 10:00이 이미 지났으면 오늘 실행분은 끝났으므로 내일부터 센다. 이미 예약된 날짜는 건너뛴다.
  function nextAutoBookRuns(weekdays, now = Date.now(), { count = 3, booked = [] } = {}) {
    if (!weekdays?.length) return [];
    const kst = new Date(now + KST_OFFSET_MS);
    const today = kst.toISOString().slice(0, 10);
    const first = kst.getUTCHours() >= AUTOBOOK_HOUR_KST ? addDays(today, 1) : today;
    const selected = new Set(weekdays);
    const skip = new Set(booked);
    const runs = [];
    for (let i = 0; runs.length < count && i < 14 * count; i += 1) {
      const runDate = addDays(first, i);
      const targetDate = addDays(runDate, 7);
      if (selected.has(weekdayOf(targetDate)) && !skip.has(targetDate)) runs.push({ runDate, targetDate });
    }
    return runs;
  }

  function dateStrip(today, days = 14) {
    return Array.from({ length: days }, (_, i) => {
      const date = addDays(today, i);
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      return {
        date,
        month: Number(date.slice(5, 7)),
        day: Number(date.slice(8, 10)),
        weekday: DAY_LABELS[dow],
        weekend: dow === 0 || dow === 6,
      };
    });
  }

  function comparable(target) {
    const normalized = normalizeUiTarget(target);
    return COMPARED_FIELDS.map((field) => JSON.stringify(normalized[field] ?? null));
  }

  // 저장된 대상과 편집 중인 대상을 _key로 짝지어 바뀐 칸 수를 센다. 추가·삭제된 대상은 1개로 센다.
  function countChanges(before, after) {
    const previous = new Map(before.map((target) => [target._key, comparable(target)]));
    let changes = 0;
    for (const target of after) {
      const prev = previous.get(target._key);
      if (!prev) {
        changes += 1;
        continue;
      }
      previous.delete(target._key);
      comparable(target).forEach((value, i) => {
        if (value !== prev[i]) changes += 1;
      });
    }
    return changes + previous.size;
  }

  function formatLineName(name) {
    return String(name ?? "").replace(/\s*->\s*/g, " → ");
  }

  function upcomingDates(weekdays, today, count = 3) {
    if (!weekdays?.length) return [];
    const selected = new Set(weekdays);
    const cursor = new Date(`${today}T00:00:00Z`);
    cursor.setUTCDate(cursor.getUTCDate() + 7);
    const result = [];
    while (result.length < count) {
      if (selected.has(DAY_CODES[cursor.getUTCDay()])) {
        result.push(cursor.toISOString().slice(0, 10));
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return result;
  }

  function buildPreview(input, today) {
    const target = normalizeUiTarget(input);
    const autoDates = target.autoBookEnabled
      ? upcomingDates(target.weekdays, today).join(", ") || "요일 선택 필요"
      : "사용 안 함";
    const monitorDates = target.monitorEnabled
      ? target.monitorDates.join(", ") || "날짜 선택 필요"
      : "사용 안 함";
    const fallback = target.seatPreference.fallbackMode === "preferredOnly"
      ? "선호 좌석만 예약"
      : "선호 좌석 우선, 없으면 남은 좌석 예약";
    return `자동예약: ${autoDates}\n빈자리 예약: ${monitorDates}\n좌석 정책: ${fallback}`;
  }

  function removePastMonitorDates(dates, today) {
    return (dates || []).filter((date) => date >= today);
  }

  return {
    buildPreview,
    countChanges,
    dateStrip,
    formatLineName,
    formatShortDate,
    kstToday,
    nextAutoBookRuns,
    normalizeUiTarget,
    removePastMonitorDates,
    upcomingDates,
    validateUiTarget,
    weekdayOf,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = ConfigUtils;
}
