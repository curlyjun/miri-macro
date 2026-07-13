var ConfigUtils = (function createConfigUtils() {
  "use strict";

  const DAY_CODES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

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
      weekdays: [...new Set(weekdays)],
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

  function validateUiTarget(input, today) {
    const target = normalizeUiTarget(input);
    const errors = [];
    if (!target.name?.trim()) errors.push("예약 이름이 필요합니다.");
    if (!target.lineTurnUid) errors.push("노선을 선택해주세요.");
    if (!target.onStationUid) errors.push("승차 정류장을 선택해주세요.");
    if (!target.offStationUid) errors.push("하차 정류장을 선택해주세요.");
    if (target.autoBookEnabled && target.weekdays.length === 0) {
      errors.push("자동예약 요일을 하나 이상 선택해주세요.");
    }
    if (target.monitorEnabled && target.monitorDates.length === 0) {
      errors.push("모니터링 날짜를 하나 이상 선택해주세요.");
    }
    if (
      target.monitorEnabled &&
      today &&
      target.monitorDates.some((date) => date < today)
    ) {
      errors.push("과거 모니터링 날짜를 정리해주세요.");
    }
    return { valid: errors.length === 0, errors, target };
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
    normalizeUiTarget,
    removePastMonitorDates,
    upcomingDates,
    validateUiTarget,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = ConfigUtils;
}
