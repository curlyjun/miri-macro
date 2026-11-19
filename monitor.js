"use strict";

const path = require("path");
const {
  loadConfig,
  normalizeConfig,
  validateTarget,
} = require("./lib/config");
const { attemptBooking } = require("./lib/booking");
const { runMonitorTargets } = require("./lib/monitoring");
const { RuntimeState, withProcessLock } = require("./lib/runtime-state");
const { escapeHtml } = require("./lib/telegram");
const { isTransientError, reportFatal } = require("./lib/run-alerts");
const { buildWeeklyDigest } = require("./lib/weekly-digest");
const {
  WEEKDAY_MAP,
  nowKST,
  sendTelegram,
  flushTelegramOutbox,
  getBookableDates,
  getBookableSeats,
  bookSeat,
  selectBestSeat,
  initCommon,
} = require("./lib/common");

const RUNTIME_DIR = path.join(__dirname, "runtime");
const STATE_PATH = path.join(RUNTIME_DIR, "state.json");
const KST_OFFSET_MS = 9 * 3600 * 1000;
// 모니터는 5분마다 돈다. 이보다 오래 비면 맥이 잠들었던 것으로 본다.
const SLEEP_GAP_MS = 30 * 60 * 1000;
// 자동예약은 09:59에 시작해 10:00에 예약한다. 이 여유가 지나도 실행 기록이 없으면 놓친 것이다.
const AUTOBOOK_GRACE_MS = 5 * 60 * 1000;
// 모니터의 일시적 실패(네트워크 끊김 등)는 이만큼 연속으로 실패해야 알린다. 한 번은 다음 실행에서 대개 낫는다.
const TRANSIENT_MIN_FAILURES = 2;

const kstDate = (ms) => new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
const kstClock = (ms) => new Date(ms + KST_OFFSET_MS).toISOString().slice(5, 16).replace("-", "/").replace("T", " ");
function addDays(date, days) {
  const cursor = new Date(`${date}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10);
}
const shortDate = (date) => {
  const d = new Date(`${date}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${"일월화수목금토"[d.getUTCDay()]})`;
};

// 잠든 사이(previous ~ now) 10:00 자동예약이 실행되지 않은 날 중, 대상 날짜가 실제 예약 요일인 것만 고른다.
function findMissedAutobooks({ previous, now, targets = [], holidays = [], autobookRuns = [] }) {
  const holidaySet = new Set(holidays.map((h) => h.date));
  const ran = new Set(autobookRuns);
  const missed = [];
  for (let day = kstDate(previous); day <= kstDate(now); day = addDays(day, 1)) {
    const openAt = Date.parse(`${day}T10:00:00+09:00`);
    if (openAt <= previous || openAt + AUTOBOOK_GRACE_MS > now || ran.has(day)) continue;
    const targetDate = addDays(day, 7);
    if (holidaySet.has(targetDate)) continue;
    const weekday = WEEKDAY_MAP[new Date(`${targetDate}T00:00:00Z`).getUTCDay()];
    const names = targets.filter((t) => t.autoBookEnabled && t.weekdays?.includes(weekday)).map((t) => t.name);
    if (names.length) missed.push({ day, targetDate, names });
  }
  return missed;
}

function describeSleepGap({ previous, now, missed }) {
  const minutes = Math.round((now - previous) / 60000);
  const span = minutes >= 60 ? `${Math.floor(minutes / 60)}시간 ${minutes % 60}분` : `${minutes}분`;
  let message =
    `⏸ <b>맥이 잠들어 있었어요</b>\n` +
    `${kstClock(previous)} ~ ${kstClock(now)} (${span}) 동안 빈자리 확인을 못 했어요.`;
  if (missed.length) {
    message +=
      `\n\n❗ <b>놓친 자동예약</b>\n` +
      missed
        .map((m) => `• ${shortDate(m.day)} 10:00 → ${shortDate(m.targetDate)} ${m.names.map(escapeHtml).join(", ")}`)
        .join("\n") +
      `\n아직 자리가 있을 수 있으니 설정 페이지에서 빈자리 예약 날짜로 넣어 주세요.`;
  }
  return `${message}\n\n맥이 잠들지 않게 Amphetamine 세션(무기한)을 확인해 주세요.`;
}

function kstParts(now = Date.now()) {
  const date = new Date(now + 9 * 3600 * 1000);
  return {
    date: date.toISOString().slice(0, 10),
    hour: date.getUTCHours(),
  };
}

async function runMonitor({
  dryRun = false,
  config = loadConfig(),
  state = new RuntimeState({ statePath: STATE_PATH }),
  deps = {},
} = {}) {
  const executedAt = nowKST();
  const modeLabel = dryRun ? "관찰" : "모니터링";
  console.log(`[${executedAt}] ${modeLabel} 시작`);

  const normalized = normalizeConfig(config);
  const sender = deps.sendTelegram || sendTelegram;

  if (!dryRun) {
    const now = state.now();
    const previous = state.markMonitorRun();
    if (previous && now - previous >= SLEEP_GAP_MS) {
      const missed = findMissedAutobooks({
        previous,
        now,
        targets: normalized.targets,
        holidays: state.state.holidays || [],
        autobookRuns: state.state.autobookRuns || [],
      });
      console.warn(`[모니터] ${Math.round((now - previous) / 60000)}분 동안 실행되지 않았습니다. 놓친 자동예약 ${missed.length}건`);
      await sender(describeSleepGap({ previous, now, missed }));
    }
  }
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
  const { date: today, hour } = kstParts(state.now());

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
      onHolidays: (holidays) => state.recordHolidays?.(holidays),
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

  if (summary.errors.length) {
    const fingerprint = summary.errors
      .map((item) => `${item.target}:${item.message}`)
      .sort()
      .join("|");
    const transient = summary.errors.every((item) => isTransientError(item.error));
    const incident = state.recordFailure(dryRun ? "observe" : "monitor", fingerprint, {
      minCount: transient ? TRANSIENT_MIN_FAILURES : 1,
    });
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
  }

  // 일요일 저녁에 다음 주 예약 현황을 한 번 보낸다. 실패하면 표시하지 않아 다음 실행에서 다시 시도한다.
  const digestHour = Number(process.env.WEEKLY_DIGEST_HOUR) || 20;
  const isSunday = new Date(`${today}T00:00:00Z`).getUTCDay() === 0;
  if (!dryRun && isSunday && hour >= digestHour && state.state.weeklyDigestDate !== today) {
    try {
      const message = await buildWeeklyDigest({
        targets: normalized.targets.filter((target) => validateTarget(target).valid),
        today,
        holidays: state.state.holidays || [],
        getBookableDates: deps.getBookableDates || getBookableDates,
      });
      if (message) await sender(message);
      state.markWeeklyDigest(today);
    } catch (error) {
      console.error("[주간 현황] 만들기 실패:", error.message);
    }
  }

  try {
    await (deps.flushTelegramOutbox || flushTelegramOutbox)();
  } catch (error) {
    console.error("[Telegram] 큐 처리 실패:", error.message);
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
      minCount: isTransientError(error) ? TRANSIENT_MIN_FAILURES : 1,
    });
    process.exitCode = 1;
  });
}

module.exports = { describeSleepGap, findMissedAutobooks, kstParts, main, runMonitor };
