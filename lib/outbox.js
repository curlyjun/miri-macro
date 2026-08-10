"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_OUTBOX_PATH = path.join(__dirname, "..", "runtime", "outbox.jsonl");
const MAX_ENTRIES = 200;
const MAX_AGE_MS = 24 * 3600 * 1000;

function readEntries(outboxPath) {
  let raw;
  try {
    raw = fs.readFileSync(outboxPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return raw
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((entry) => entry && typeof entry.message === "string");
}

function writeEntries(outboxPath, entries) {
  fs.mkdirSync(path.dirname(outboxPath), { recursive: true });
  const temporaryPath = `${outboxPath}.tmp`;
  const body = entries.map((entry) => JSON.stringify(entry)).join("\n");
  fs.writeFileSync(temporaryPath, entries.length ? `${body}\n` : "");
  fs.renameSync(temporaryPath, outboxPath);
}

function enqueue(
  message,
  { outboxPath = DEFAULT_OUTBOX_PATH, now = () => Date.now(), maxEntries = MAX_ENTRIES } = {},
) {
  const entries = readEntries(outboxPath);
  entries.push({ message, queuedAt: now() });
  const overflow = Math.max(0, entries.length - maxEntries);
  const kept = entries.slice(overflow);
  writeEntries(outboxPath, kept);
  return { pending: kept.length, overflow };
}

// 전송 경로가 막혀 있으면 남은 항목은 다음 실행으로 미룬다. 재시도해도 소용없는
// 오류(error.permanent)만 큐에서 버려 앞줄이 막히지 않게 한다.
async function flush(
  send,
  { outboxPath = DEFAULT_OUTBOX_PATH, now = () => Date.now(), maxAgeMs = MAX_AGE_MS } = {},
) {
  const entries = readEntries(outboxPath);
  if (!entries.length) return { sent: 0, expired: 0, dropped: 0, pending: 0 };

  const current = now();
  const fresh = entries.filter((entry) => current - (entry.queuedAt || 0) <= maxAgeMs);
  const expired = entries.length - fresh.length;

  let sent = 0;
  let dropped = 0;
  let index = 0;
  for (; index < fresh.length; index += 1) {
    try {
      await send(fresh[index].message);
      sent += 1;
    } catch (error) {
      if (error?.permanent) {
        dropped += 1;
        continue;
      }
      break;
    }
  }

  const pending = fresh.slice(index);
  if (sent || dropped || expired) writeEntries(outboxPath, pending);
  return { sent, expired, dropped, pending: pending.length };
}

function size(outboxPath = DEFAULT_OUTBOX_PATH) {
  return readEntries(outboxPath).length;
}

module.exports = { DEFAULT_OUTBOX_PATH, MAX_AGE_MS, MAX_ENTRIES, enqueue, flush, size };
