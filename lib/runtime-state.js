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
      dailyHealthDate: null,
      completed: [],
      ...this.#load(),
    };
  }

  #load() {
    if (!this.statePath) return { failures: {}, dailyHealthDate: null };
    try {
      return JSON.parse(fs.readFileSync(this.statePath, "utf8"));
    } catch {
      return { failures: {}, dailyHealthDate: null };
    }
  }

  #save() {
    if (!this.statePath) return;
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    const temporaryPath = `${this.statePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(this.state, null, 2));
    fs.renameSync(temporaryPath, this.statePath);
  }

  recordFailure(scope, fingerprint) {
    const current = this.state.failures[scope];
    const now = this.now();
    if (!current || current.fingerprint !== fingerprint) {
      this.state.failures[scope] = {
        fingerprint,
        firstAt: now,
        lastAt: now,
        lastNotifiedAt: now,
        count: 1,
      };
      this.#save();
      return { notify: true, type: "NEW_FAILURE", count: 1 };
    }

    current.lastAt = now;
    current.count += 1;
    const notify = now - current.lastNotifiedAt >= this.cooldownMs;
    if (notify) current.lastNotifiedAt = now;
    this.#save();
    return {
      notify,
      type: notify ? "ONGOING_FAILURE" : "SUPPRESSED",
      count: current.count,
      firstAt: current.firstAt,
    };
  }

  recordSuccess(scope) {
    const current = this.state.failures[scope];
    if (!current) return { notify: false, type: "HEALTHY" };
    delete this.state.failures[scope];
    this.#save();
    return { notify: true, type: "RECOVERED", count: current.count };
  }

  recordDailyHealth(dateKey) {
    if (this.state.dailyHealthDate === dateKey) {
      return { notify: false, type: "ALREADY_SENT" };
    }
    this.state.dailyHealthDate = dateKey;
    this.#save();
    return { notify: true, type: "DAILY_HEALTH" };
  }

  recordCompleted(target, date, seatNo) {
    const key = `${target}:${date}`;
    const existingIndex = this.state.completed.findIndex(
      (item) => `${item.target}:${item.date}` === key,
    );
    const item = { target, date, seatNo };
    if (existingIndex >= 0) this.state.completed[existingIndex] = item;
    else this.state.completed.push(item);
    this.#save();
    return item;
  }

  getCompleted() {
    return [...this.state.completed];
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
