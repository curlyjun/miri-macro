const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { describeAppliedConfig } = require("../monitor");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "miri-applied-"));
}

test("설정 페이지 저장본의 마지막 저장 시각을 KST로 표시한다", () => {
  const runtimePath = path.join(tempDir(), "config.json");
  fs.writeFileSync(runtimePath, "{}");
  const savedAt = new Date("2026-07-13T01:40:00Z");
  fs.utimesSync(runtimePath, savedAt, savedAt);

  assert.equal(describeAppliedConfig({ runtimePath }), "로컬 설정 (2026-07-13 10:40 저장)");
});

test("설정 페이지에서 저장한 적이 없으면 저장소 설정이라고 표시한다", () => {
  const runtimePath = path.join(tempDir(), "없음.json");

  assert.equal(describeAppliedConfig({ runtimePath }), "저장소 config.json");
});
