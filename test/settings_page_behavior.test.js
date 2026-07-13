const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildPreview,
  normalizeUiTarget,
  removePastMonitorDates,
  validateUiTarget,
} = require("../docs/config-utils");

const page = fs.readFileSync(path.join(__dirname, "..", "docs", "index.html"), "utf8");

test("기존 UI 설정을 안전한 토글과 폴백 기본값으로 변환한다", () => {
  const target = normalizeUiTarget({ weekdays: [], monitorDates: [], seatPreference: {} });
  assert.equal(target.autoBookEnabled, false);
  assert.equal(target.monitorEnabled, false);
  assert.equal(target.seatPreference.fallbackMode, "any");
});

test("활성화된 자동예약의 요일 누락을 저장 오류로 반환한다", () => {
  const result = validateUiTarget({
    name: "출근",
    lineTurnUid: "line",
    onStationUid: "on",
    offStationUid: "off",
    autoBookEnabled: true,
    monitorEnabled: false,
    weekdays: [],
    monitorDates: [],
    seatPreference: { preferredSeats: [], fallbackMode: "any" },
  });
  assert.match(result.errors.join(" "), /요일/);
});

test("설정 미리보기에 7일 뒤부터 다음 예약 날짜 3개와 좌석 정책을 표시한다", () => {
  const preview = buildPreview(
    {
      name: "출근",
      autoBookEnabled: true,
      monitorEnabled: true,
      weekdays: ["MON", "THU"],
      monitorDates: ["2026-07-14"],
      seatPreference: { fallbackMode: "preferredOnly" },
    },
    "2026-07-13",
  );

  assert.match(preview, /2026-07-20/);
  assert.match(preview, /2026-07-23/);
  assert.match(preview, /2026-07-27/);
  assert.match(preview, /선호 좌석만/);
});

test("과거 모니터링 날짜를 일괄 제거한다", () => {
  assert.deepEqual(
    removePastMonitorDates(["2026-07-12", "2026-07-13", "2026-07-14"], "2026-07-13"),
    ["2026-07-13", "2026-07-14"],
  );
});

test("활성화된 모니터에 과거 날짜가 있으면 저장 오류로 반환한다", () => {
  const result = validateUiTarget(
    {
      name: "출근",
      lineTurnUid: "line",
      onStationUid: "on",
      offStationUid: "off",
      autoBookEnabled: false,
      monitorEnabled: true,
      weekdays: [],
      monitorDates: ["2026-07-12"],
      seatPreference: { preferredSeats: [], fallbackMode: "any" },
    },
    "2026-07-13",
  );
  assert.match(result.errors.join(" "), /과거/);
});

test("페이지에 토글, 폴백, 충돌 복구와 이탈 경고 계약이 있다", () => {
  assert.match(page, /auto-book-toggle/);
  assert.match(page, /monitor-toggle/);
  assert.match(page, /fallback-select/);
  assert.match(page, /validateConfigForSave/);
  assert.match(page, /beforeunload/);
  assert.match(page, /res\.status === 409/);
  assert.match(page, /reload-conflict/);
  assert.doesNotMatch(page, /configData\.targets = cards\.map/);
});
