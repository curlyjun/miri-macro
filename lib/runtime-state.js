"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_RUNTIME_DIR = path.join(__dirname, "..", "runtime");

class RuntimeState {
  constructor({
    statePath,
    now = () => Date.now(),
    cooldownMs = (Number(process.env.ERROR_NOTIFY_COOLDOWN_HOURS) || 6) * 3600 * 1000,
  } = {}) {
    this.statePath = statePath;
    this.now = now;
    this.cooldownMs = cooldownMs;
    this.state = {
      failures: {},
      weeklyDigestDate: null,
      completed: [],
      ...this.#load(),
    };
    // 예전 일일 상태 알림의 흔적
    delete this.state.dailyHealthDate;
  }

  #load() {
    if (!this.statePath) return { failures: {} };
    try {
      return JSON.parse(fs.readFileSync(this.statePath, "utf8"));
    } catch {
      return { failures: {} };
    }
  }

  #save() {
    if (!this.statePath) return;
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    const temporaryPath = `${this.statePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(this.state, null, 2));
    fs.renameSync(temporaryPath, this.statePath);
  }

  // minCount: 이만큼 연속으로 실패해야 처음 알린다. 5분마다 도는 모니터의 일시적 네트워크 끊김처럼
  // 다음 실행에서 저절로 낫는 실패는 알림 없이 넘기기 위해서다. 알리지 않은 실패는 복구도 알리지 않는다.
  recordFailure(scope, fingerprint, { minCount = 1 } = {}) {
    const current = this.state.failures[scope];
    const now = this.now();
    if (!current || current.fingerprint !== fingerprint) {
      const notify = minCount <= 1;
      this.state.failures[scope] = {
        fingerprint,
        firstAt: now,
        lastAt: now,
        lastNotifiedAt: notify ? now : null,
        notified: notify,
        count: 1,
      };
      this.#save();
      return { notify, type: notify ? "NEW_FAILURE" : "SUPPRESSED", count: 1 };
    }

    current.lastAt = now;
    current.count += 1;
    // 예전 기록에는 notified가 없다. 그때는 실패하면 바로 알렸으므로 알린 것으로 본다.
    const notified = current.notified ?? true;
    let type;
    if (!notified) {
      type = current.count >= minCount ? "NEW_FAILURE" : "SUPPRESSED";
    } else {
      type = now - current.lastNotifiedAt >= this.cooldownMs ? "ONGOING_FAILURE" : "SUPPRESSED";
    }
    const notify = type !== "SUPPRESSED";
    if (notify) {
      current.lastNotifiedAt = now;
      current.notified = true;
    }
    this.#save();
    return { notify, type, count: current.count, firstAt: current.firstAt };
  }

  recordSuccess(scope) {
    const current = this.state.failures[scope];
    if (!current) return { notify: false, type: "HEALTHY" };
    delete this.state.failures[scope];
    this.#save();
    const notified = current.notified ?? true;
    return { notify: notified, type: notified ? "RECOVERED" : "HEALTHY", count: current.count };
  }

  // 모니터가 돌 때마다 시각을 남기고 직전 시각을 돌려준다. 맥이 잠들어 실행이 빠진 구간을 찾는 데 쓴다.
  markMonitorRun() {
    const previous = this.state.lastMonitorAt ?? null;
    this.state.lastMonitorAt = this.now();
    this.#save();
    return previous;
  }

  // 자동예약이 실행된 날(KST)을 최근 14일만 남긴다. 잠든 사이 놓친 자동예약을 찾는 데 쓴다.
  recordAutobookRun(dateKey) {
    const runs = new Set(this.state.autobookRuns || []);
    runs.add(dateKey);
    this.state.autobookRuns = [...runs].sort().slice(-14);
    this.#save();
  }

  markWeeklyDigest(dateKey) {
    this.state.weeklyDigestDate = dateKey;
    this.#save();
  }

  recordCompleted(target, date, seatNo) {
    const key = `${target}:${date}`;
    const existingIndex = this.state.completed.findIndex(
      (item) => `${item.target}:${item.date}` === key,
    );
    const item = { target, date, seatNo, bookedAt: this.now() };
    if (existingIndex >= 0) this.state.completed[existingIndex] = item;
    else this.state.completed.push(item);
    this.#save();
    return item;
  }

  getCompleted() {
    return [...this.state.completed];
  }

  // MiRi가 알려준 공휴일을 모아 둔다. 설정 화면이 다음 예약 일정에서 공휴일을 건너뛰는 데 쓴다.
  recordHolidays(holidays) {
    const today = new Date(this.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const merged = new Map(
      (this.state.holidays || []).filter((h) => h.date >= today).map((h) => [h.date, h]),
    );
    for (const holiday of holidays || []) {
      if (holiday?.date >= today) merged.set(holiday.date, { date: holiday.date, name: holiday.name });
    }
    const next = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
    if (JSON.stringify(next) !== JSON.stringify(this.state.holidays || [])) {
      this.state.holidays = next;
      this.#save();
    }
    return next;
  }
}

async function withProcessLock(
  name,
  task,
  {
    dir = DEFAULT_RUNTIME_DIR,
    staleMs = 10 * 60 * 1000,
    now = () => Date.now(),
  } = {},
) {
  fs.mkdirSync(dir, { recursive: true });
  const lockPath = path.join(dir, `${name}.lock`);

  try {
    const existing = Number(fs.readFileSync(lockPath, "utf8"));
    if (Number.isFinite(existing) && now() - existing < staleMs) {
      return { skipped: true, reason: "LOCKED" };
    }
    fs.unlinkSync(lockPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  let handle;
  try {
    handle = fs.openSync(lockPath, "wx");
    fs.writeFileSync(handle, String(now()));
  } catch (error) {
    if (error.code === "EEXIST") return { skipped: true, reason: "LOCKED" };
    throw error;
  }

  try {
    return { skipped: false, value: await task() };
  } finally {
    fs.closeSync(handle);
    try {
      fs.unlinkSync(lockPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

module.exports = { DEFAULT_RUNTIME_DIR, RuntimeState, withProcessLock };
