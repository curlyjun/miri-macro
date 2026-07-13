const assert = require("node:assert/strict");
const test = require("node:test");

const { formatAppliedConfig } = require("../monitor");

test("적용 설정을 짧은 커밋과 동기화 시각으로 표시한다", () => {
  assert.equal(
    formatAppliedConfig("323f5c8e64dcf298e05e5a425491f571d2f0439e|2026-07-13 10:40"),
    "323f5c8 (2026-07-13 10:40 동기화)",
  );
});

test("기존 전체 커밋만 저장된 상태 파일도 짧게 표시한다", () => {
  assert.equal(
    formatAppliedConfig("323f5c8e64dcf298e05e5a425491f571d2f0439e"),
    "323f5c8",
  );
});
