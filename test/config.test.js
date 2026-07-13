const assert = require("node:assert/strict");
const test = require("node:test");

const { normalizeConfig, validateTarget } = require("../lib/config");

test("기존 설정은 빈 요일을 자동예약 비활성화로 변환한다", () => {
  const result = normalizeConfig({
    targets: [
      {
        name: "출근",
        lineTurnUid: "line",
        onStationUid: "on",
        offStationUid: "off",
        weekdays: [],
        monitorDates: [],
        seatPreference: { preferredSeats: [] },
      },
    ],
  });

  assert.equal(result.targets[0].autoBookEnabled, false);
  assert.equal(result.targets[0].monitorEnabled, false);
  assert.equal(result.targets[0].seatPreference.fallbackMode, "any");
});

test("활성화된 자동예약은 요일이 필요하다", () => {
  const result = validateTarget({
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

  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /요일/);
});

test("활성화된 모니터는 날짜가 필요하다", () => {
  const result = validateTarget({
    name: "출근",
    lineTurnUid: "line",
    onStationUid: "on",
    offStationUid: "off",
    autoBookEnabled: false,
    monitorEnabled: true,
    weekdays: [],
    monitorDates: [],
    seatPreference: { preferredSeats: [], fallbackMode: "preferredOnly" },
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /모니터링 날짜/);
});
