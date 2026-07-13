"use strict";

const path = require("path");
const rawConfig = require("./config.json");
const { normalizeConfig, validateTarget } = require("./lib/config");
const { attemptBooking } = require("./lib/booking");
const { getTargetDate, runAutoBookTargets } = require("./lib/auto-booking");
const { RuntimeState, withProcessLock } = require("./lib/runtime-state");
const { escapeHtml } = require("./lib/telegram");
const { reportFatal } = require("./lib/run-alerts");
const {
  sleep,
  nowKST,
  sendTelegram,
  getBookableDates,
  getBookableSeats,
  bookSeat,
  selectBestSeat,
  initCommon,
} = require("./lib/common");

const STATE_PATH = path.join(__dirname, "runtime", "state.json");

async function runAutoBook({
  config = rawConfig,
  state = new RuntimeState({ statePath: STATE_PATH }),
  deps = {},
} = {}) {
  const { date: targetDate, weekday: targetWeekday } = getTargetDate();
  const executedAt = nowKST();
  const results = [];
  const normalized = normalizeConfig(config);
  const validationErrors = [];
  const targets = normalized.targets.filter((target) => {
    const validation = validateTarget(target);
    if (!validation.valid) {
      validationErrors.push({ target: target.name, message: validation.errors.join(" ") });
      return false;
    }
    return true;
  });

  console.log(`[${executedAt}] 자동 예약 시작 - 대상: ${targetDate} (${targetWeekday})`);
  const summary = await runAutoBookTargets({
    targets,
    targetDate,
    targetWeekday,
    deps: {
      getBookableDates: deps.getBookableDates || getBookableDates,
      getBookableSeats: deps.getBookableSeats || getBookableSeats,
      selectBestSeat: deps.selectBestSeat || selectBestSeat,
      bookSeat: deps.bookSeat || bookSeat,
      attemptBooking: deps.attemptBooking || attemptBooking,
      sleep: deps.sleep || sleep,
      onResult: (item) => results.push(item),
    },
  });
  summary.errors.push(...validationErrors);
  const sender = deps.sendTelegram || sendTelegram;

  for (const { target, dateInfo, result } of results) {
    const scope = `autobook:${target.name}:${targetDate}`;
    if (result.status === "BOOKED") {
      state.recordCompleted(target.name, targetDate, result.seatNo);
      state.recordSuccess(scope);
      const info = result.info || {};
      await sender(
        `✅ <b>예약 완료!</b>\n` +
          `🚌 ${escapeHtml(target.name)}\n` +
          `📅 ${escapeHtml(targetDate)} (${escapeHtml(targetWeekday)})\n` +
          `💺 ${escapeHtml(result.seatNo)}번 좌석\n` +
          `⏰ ${escapeHtml(info.departureTimeText)} 출발 → ${escapeHtml(info.arrivalTimeText)} 도착\n` +
          `📍 ${escapeHtml(info.expectedOnStationName)} → ${escapeHtml(info.expectedOffStationName)}\n` +
          `🕐 실행 시간: ${escapeHtml(executedAt)}`,
      );
    } else if (result.status === "ALREADY_BOOKED") {
      state.recordSuccess(scope);
      await sender(
        `✅ <b>${escapeHtml(targetDate)} 이미 예약되어 있습니다.</b>\n` +
          `🚌 ${escapeHtml(target.name)}\n🕐 실행 시간: ${escapeHtml(executedAt)}`,
      );
    } else if (["NOT_OPEN", "NOT_BOOKABLE", "NO_SEAT", "NO_ALLOC"].includes(result.status)) {
      const incident = state.recordFailure(scope, result.status);
      if (incident.notify) {
        await sender(
          `❌ <b>자동 예약 실패</b>\n` +
            `🚌 ${escapeHtml(target.name)}\n📅 ${escapeHtml(targetDate)}\n` +
            `사유: ${escapeHtml(result.status)}\n` +
            `빈자리 모니터링 설정이 켜져 있으면 계속 확인합니다.`,
        );
      }
    }
  }

  if (summary.errors.length) {
    const fingerprint = summary.errors
      .map((item) => `${item.target}:${item.message}`)
      .sort()
      .join("|");
    const incident = state.recordFailure("autobook", fingerprint);
    if (incident.notify) {
      await sender(
        `⚠️ <b>자동예약 실행 오류</b>\n` +
          summary.errors
            .map((item) => `• ${escapeHtml(item.target)}: ${escapeHtml(item.message)}`)
            .join("\n"),
      );
    }
  } else {
    const recovery = state.recordSuccess("autobook");
    if (recovery.notify) {
      await sender(`✅ <b>자동예약 실행 복구됨</b>\n누적 실패 ${recovery.count}회 후 정상화`);
    }
  }

  console.log("자동 예약 완료");
  return summary;
}

async function main() {
  await initCommon();
  const result = await withProcessLock("autobook", () => runAutoBook());
  if (result.skipped) console.log("[autobook] 이전 실행이 진행 중이라 건너뜁니다.");
  return result;
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error("치명적 오류:", error);
    await reportFatal({
      scope: "autobook",
      error,
      state: new RuntimeState({ statePath: STATE_PATH }),
      sendTelegram,
      executedAt: nowKST(),
    });
    process.exitCode = 1;
  });
}

module.exports = { main, runAutoBook };
