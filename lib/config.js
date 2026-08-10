"use strict";

const fs = require("fs");
const path = require("path");

const RUNTIME_CONFIG_PATH = path.join(__dirname, "..", "runtime", "config.json");
const REPO_CONFIG_PATH = path.join(__dirname, "..", "config.json");

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

// run-oracle.sh는 origin/main에서 받은 설정을 runtime/config.json에 둔다. 추적 중인
// config.json을 덮어쓰면 VM 작업 트리가 항상 dirty가 되어 git pull이 막히기 때문이다.
// 로컬에서는 runtime 사본이 없으므로 저장소의 config.json을 그대로 쓴다.
function loadConfig({ runtimePath = RUNTIME_CONFIG_PATH, repoPath = REPO_CONFIG_PATH } = {}) {
  for (const candidate of [runtimePath, repoPath]) {
    let raw;
    try {
      raw = fs.readFileSync(candidate, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    return JSON.parse(raw);
  }
  throw new Error(`설정 파일을 찾을 수 없습니다: ${runtimePath} 또는 ${repoPath}`);
}

module.exports = {
  REPO_CONFIG_PATH,
  RUNTIME_CONFIG_PATH,
  loadConfig,
  normalizeConfig,
  normalizeTarget,
  validateConfig,
  validateTarget,
};
