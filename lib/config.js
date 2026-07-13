"use strict";

const VALID_WEEKDAYS = new Set(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);
const VALID_FALLBACK_MODES = new Set(["any", "preferredOnly"]);

function normalizeTarget(target = {}) {
  const weekdays = Array.isArray(target.weekdays)
    ? target.weekdays.filter((day) => VALID_WEEKDAYS.has(day))
    : [];
  const monitorDates = Array.isArray(target.monitorDates)
    ? [...new Set(target.monitorDates)].sort()
    : [];
  const preferredSeats = Array.isArray(target.seatPreference?.preferredSeats)
    ? target.seatPreference.preferredSeats
    : [];
  const fallbackMode = VALID_FALLBACK_MODES.has(target.seatPreference?.fallbackMode)
    ? target.seatPreference.fallbackMode
    : "any";

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
    weekdays,
    monitorDates,
    seatPreference: { preferredSeats, fallbackMode },
  };
}

function normalizeConfig(config = {}) {
  return {
    ...config,
    targets: Array.isArray(config.targets)
      ? config.targets.filter(Boolean).map(normalizeTarget)
      : [],
  };
}

function validateTarget(input) {
  const target = normalizeTarget(input);
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

  return { valid: errors.length === 0, errors, target };
}

function validateConfig(config) {
  const normalized = normalizeConfig(config);
  const targets = normalized.targets.map((target, index) => ({
    index,
    ...validateTarget(target),
  }));
  return {
    valid: targets.every((result) => result.valid),
    targets,
    config: normalized,
  };
}

module.exports = {
  normalizeConfig,
  normalizeTarget,
  validateConfig,
  validateTarget,
};
