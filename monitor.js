"use strict";

const fs = require("fs");
const path = require("path");
const rawConfig = require("./config.json");
const { normalizeConfig, validateTarget } = require("./lib/config");
const { attemptBooking } = require("./lib/booking");
const { runMonitorTargets } = require("./lib/monitoring");
const { RuntimeState, withProcessLock } = require("./lib/runtime-state");
const { escapeHtml } = require("./lib/telegram");
const { reportFatal } = require("./lib/run-alerts");
const {
  nowKST,
  sendTelegram,
  getBookableDates,
  getBookableSeats,
  bookSeat,
  selectBestSeat,
  initCommon,
} = require("./lib/common");

const RUNTIME_DIR = path.join(__dirname, "runtime");
const STATE_PATH = path.join(RUNTIME_DIR, "state.json");

function kstParts(now = Date.now()) {
  const date = new Date(now + 9 * 3600 * 1000);
  return {
    date: date.toISOString().slice(0, 10),
    hour: date.getUTCHours(),
  };
}

function readAppliedCommit() {
  try {
    return fs.readFileSync(path.join(RUNTIME_DIR, "applied-config-commit"), "utf8").trim();
  } catch {
    return "로컬 설정";
  }
}

async function runMonitor({
  dryRun = false,
  config = rawConfig,
  state = new RuntimeState({ statePath: STATE_PATH }),
  deps = {},
} = {}) {
  const executedAt = nowKST();
  const modeLabel = dryRun ? "관찰" : "모니터링";
  console.log(`[${executedAt}] ${modeLabel} 시작`);

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
  const results = [];
  const { date: today, hour } = kstParts();

  const summary = await runMonitorTargets({
    targets,
    today,
    dryRun,
    deps: {
      getBookableDates: deps.getBookableDates || getBookableDates,
      getBookableSeats: deps.getBookableSeats || getBookableSeats,
      selectBestSeat: deps.selectBestSeat || selectBestSeat,
      bookSeat: deps.bookSeat || bookSeat,
      attemptBooking: deps.attemptBooking || attemptBooking,
      onResult: (item) => results.push(item),
    },
  });
  summary.errors.push(...validationErrors);

  for (const item of results) {
    const { target, dateInfo, result } = item;
    if (result.status === "BOOKED") {
      state.recordCompleted(target.name, dateInfo.date, result.seatNo);
      const info = result.info || {};
      await (deps.sendTelegram || sendTelegram)(
        `✅ <b>빈 좌석 발견 - 예약 완료!</b>\n` +
          `🚌 ${escapeHtml(target.name)}\n` +
          `📅 ${escapeHtml(dateInfo.date)}\n` +
          `💺 ${escapeHtml(result.seatNo)}번 좌석 예약 완료\n` +
          `⏰ ${escapeHtml(info.departureTimeText)} 출발 → ${escapeHtml(info.arrivalTimeText)} 도착\n` +
          `📍 ${escapeHtml(info.expectedOnStationName)} → ${escapeHtml(info.expectedOffStationName)}\n` +
          `🕐 실행 시간: ${escapeHtml(executedAt)}`,
      );
    } else if (result.status === "DRY_RUN") {
      const incident = state.recordFailure(
        `observe:${target.name}:${dateInfo.date}`,
        `seat:${result.seatNo}`,
      );
      if (incident.notify) {
        await (deps.sendTelegram || sendTelegram)(
          `🔎 <b>관찰 모드 - 예약 가능</b>\n` +
            `🚌 ${escapeHtml(target.name)}\n` +
            `📅 ${escapeHtml(dateInfo.date)}\n` +
            `💺 실제 실행 시 ${escapeHtml(result.seatNo)}번 좌석 예약 예정`,
        );
      }
    }
  }

  const sender = deps.sendTelegram || sendTelegram;
  if (summary.errors.length) {
    const fingerprint = summary.errors
      .map((item) => `${item.target}:${item.message}`)
      .sort()
      .join("|");
    const incident = state.recordFailure(dryRun ? "observe" : "monitor", fingerprint);
    if (incident.notify) {
      const title = incident.type === "NEW_FAILURE" ? "모니터링 장애 발생" : "모니터링 장애 지속";
      await sender(
        `⚠️ <b>${title}</b>\n` +
          summary.errors
            .map((item) => `• ${escapeHtml(item.target)}: ${escapeHtml(item.message)}`)
            .join("\n") +
          `\n반복 횟수: ${incident.count}\n🕐 ${escapeHtml(executedAt)}`,
      );
    }
  } else {
    const recovery = state.recordSuccess(dryRun ? "observe" : "monitor");
    if (recovery.notify) {
      await sender(`✅ <b>${modeLabel} 복구됨</b>\n누적 실패 ${recovery.count}회 후 정상화\n🕐 ${escapeHtml(executedAt)}`);
    }
    const healthHour = Number(process.env.HEALTH_REPORT_HOUR) || 9;
    if (!dryRun && hour >= healthHour) {
      const health = state.recordDailyHealth(today);
      if (health.notify) {
        await sender(
          `💚 <b>MiRi 매크로 일일 상태</b>\n` +
            `확인 대상: ${summary.targetsChecked}개\n` +
            `확인 날짜: ${summary.datesChecked}개\n` +
            `적용 설정: ${escapeHtml(readAppliedCommit())}\n` +
            `🕐 ${escapeHtml(executedAt)}`,
        );
      }
    }
  }

  console.log(`${modeLabel} 완료`);
  return summary;
}

async function main({ dryRun = false } = {}) {
  await initCommon();
  const lockName = dryRun ? "observe" : "monitor";
  const result = await withProcessLock(lockName, () => runMonitor({ dryRun }));
  if (result.skipped) console.log(`[${lockName}] 이전 실행이 진행 중이라 건너뜁니다.`);
  return result;
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error("치명적 오류:", error);
    await reportFatal({
      scope: "monitor",
      error,
      state: new RuntimeState({ statePath: STATE_PATH }),
      sendTelegram,
      executedAt: nowKST(),
    });
    process.exitCode = 1;
  });
}

module.exports = { kstParts, main, runMonitor };
