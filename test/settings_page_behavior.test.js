const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildPreview,
  countChanges,
  dateStrip,
  formatLineName,
  formatShortDate,
  nextAutoBookRuns,
  normalizeUiTarget,
  removePastMonitorDates,
  validateUiTarget,
} = require("../docs/config-utils");

const page = fs.readFileSync(path.join(__dirname, "..", "docs", "index.html"), "utf8");

const TARGET = {
  _key: "a",
  name: "출근",
  lineTurnUid: "line",
  onStationUid: "on",
  offStationUid: "off",
  autoBookEnabled: true,
  monitorEnabled: false,
  weekdays: ["MON", "THU"],
  monitorDates: [],
  seatPreference: { preferredSeats: [17, 13], fallbackMode: "any" },
};

test("기존 UI 설정을 안전한 토글과 폴백 기본값으로 변환한다", () => {
  const target = normalizeUiTarget({ weekdays: [], monitorDates: [], seatPreference: {} });
  assert.equal(target.autoBookEnabled, false);
  assert.equal(target.monitorEnabled, false);
  assert.equal(target.seatPreference.fallbackMode, "any");
});

test("요일은 월요일부터 순서대로 정리한다", () => {
  assert.deepEqual(normalizeUiTarget({ weekdays: ["FRI", "MON", "SUN", "MON"] }).weekdays, ["MON", "FRI", "SUN"]);
});

test("검증 오류를 칸별로 돌려줘 화면이 해당 칸에 표시할 수 있다", () => {
  const result = validateUiTarget({ ...TARGET, name: " ", lineTurnUid: "", weekdays: [] });
  assert.equal(result.valid, false);
  assert.deepEqual(Object.keys(result.fields).sort(), ["name", "route", "weekdays"]);
  assert.match(result.errors.join(" "), /요일/);
});

test("활성화된 빈자리 예약에 지난 날짜가 있으면 오류로 돌려준다", () => {
  const result = validateUiTarget(
    { ...TARGET, autoBookEnabled: false, monitorEnabled: true, monitorDates: ["2026-07-12"] },
    "2026-07-13",
  );
  assert.match(result.fields.monitorDates, /지난 날짜/);
});

test("과거 모니터링 날짜를 일괄 제거한다", () => {
  assert.deepEqual(
    removePastMonitorDates(["2026-07-12", "2026-07-13", "2026-07-14"], "2026-07-13"),
    ["2026-07-13", "2026-07-14"],
  );
});

test("날짜를 요일이 붙은 짧은 형식으로, 다른 해면 연도를 붙여 보여준다", () => {
  assert.equal(formatShortDate("2026-09-17", "2026-09-11"), "9/17(목)");
  assert.equal(formatShortDate("2027-01-04", "2026-12-30"), "2027년 1/4(월)");
});

test("오늘 10:00이 지났으면 내일 실행분부터, 이미 예약된 날짜는 건너뛰고 다음 자동예약을 센다", () => {
  const after = Date.parse("2026-09-11T01:30:00Z"); // 금 10:30 KST
  assert.deepEqual(nextAutoBookRuns(["MON", "THU", "FRI"], after, { count: 2, booked: ["2026-09-18"] }), [
    { runDate: "2026-09-14", targetDate: "2026-09-21" },
    { runDate: "2026-09-17", targetDate: "2026-09-24" },
  ]);

  const before = Date.parse("2026-09-11T00:30:00Z"); // 금 09:30 KST
  assert.deepEqual(nextAutoBookRuns(["FRI"], before, { count: 1 }), [
    { runDate: "2026-09-11", targetDate: "2026-09-18" },
  ]);
  assert.deepEqual(nextAutoBookRuns([], before), []);
});

test("빈자리 날짜 띠는 오늘부터 14일을 요일·주말 표시와 함께 만든다", () => {
  const strip = dateStrip("2026-09-11");
  assert.equal(strip.length, 14);
  assert.deepEqual(strip[0], { date: "2026-09-11", month: 9, day: 11, weekday: "금", weekend: false });
  assert.equal(strip[1].weekend, true);
  assert.equal(strip[13].date, "2026-09-24");
});

test("바뀐 칸 수를 세되 요일 순서만 다른 것은 변경으로 보지 않는다", () => {
  const base = [TARGET];
  assert.equal(countChanges(base, [{ ...TARGET, weekdays: ["THU", "MON"] }]), 0);
  assert.equal(countChanges(base, [{ ...TARGET, name: "퇴근" }]), 1);
  assert.equal(countChanges(base, [{ ...TARGET, seatPreference: { preferredSeats: [13, 17], fallbackMode: "any" } }]), 1);
  assert.equal(countChanges(base, [TARGET, { ...TARGET, _key: "b" }]), 1);
  assert.equal(countChanges(base, []), 1);
});

test("노선 이름의 -> 를 화살표로 바꾼다", () => {
  assert.equal(formatLineName("화성 -> 서울"), "화성 → 서울");
});

test("설정 미리보기에 7일 뒤부터 다음 예약 날짜 3개와 좌석 정책을 표시한다", () => {
  const preview = buildPreview(
    { ...TARGET, weekdays: ["MON", "THU"], monitorEnabled: true, monitorDates: ["2026-07-14"], seatPreference: { fallbackMode: "preferredOnly" } },
    "2026-07-13",
  );
  assert.match(preview, /2026-07-20/);
  assert.match(preview, /2026-07-23/);
  assert.match(preview, /2026-07-27/);
  assert.match(preview, /선호 좌석만/);
});

test("페이지는 PAT 없이 로컬 설정 서버와 상태 API로 읽고 쓴다", () => {
  assert.match(page, /fetch\('api\/config'/);
  assert.match(page, /fetch\('api\/status'/);
  assert.match(page, /fetch\('line\.json'\)/);
  assert.doesNotMatch(page, /api\.github\.com|raw\.githubusercontent\.com|gh_pat/);
});

test("저장 바가 변경·오류·충돌·저장됨 상태를 보여주고 오류 칸으로 이동시킨다", () => {
  assert.match(page, /저장하지 않은 변경/);
  assert.match(page, /저장 전에 고칠 곳/);
  assert.match(page, /res\.status === 409/);
  assert.match(page, /저장됨 · 5분 안에 적용돼요/);
  assert.match(page, /data-error-for="name"/);
  assert.match(page, /function jumpToError/);
});

test("되돌릴 수 없는 동작은 확인하거나 되돌릴 수 있다", () => {
  assert.match(page, /id="confirm-sheet"/);
  assert.match(page, /function requestReload[\s\S]*changeCount\(\)[\s\S]*showModal/);
  assert.match(page, /data-action="undo"/);
  assert.match(page, /beforeunload/);
});

test("바텀시트는 키보드에 가려지지 않게 보이는 영역에 맞춘다", () => {
  assert.match(page, /interactive-widget=resizes-content/);
  assert.match(page, /visualViewport\?\.addEventListener\('resize', fitSheetsToKeyboard\)/);
  assert.match(page, /\.sheet \{[^}]*margin: auto auto var\(--kb\)/);
  assert.match(page, /\.sheet \{[^}]*calc\(var\(--vvh\) - 8px\)/);
});

test("시트가 열려 있는 동안 뒤 페이지 스크롤을 잠그고 시트 안 스크롤이 새지 않게 한다", () => {
  assert.match(page, /function openSheet\(sheet\) \{\s*lockPageScroll\(\);\s*sheet\.showModal\(\);/);
  assert.match(page, /sheet\.addEventListener\('close', unlockPageScroll\)/);
  assert.doesNotMatch(page, /\$\('(route|confirm)-sheet'\)\.showModal\(\)/);
  assert.match(page, /\.sheet-body \{[^}]*overscroll-behavior: contain/);
  assert.match(page, /\.sheet-body \{[^}]*padding: 12px 24px/);
});

test("출발 시간만 바꾸면 같은 승하차 정류장을 유지한다", () => {
  const turnCase = page.slice(page.indexOf("case 'route-turn'"), page.indexOf("case 'route-next'"));
  assert.match(turnCase, /s\.uid === r\.onUid && s\.onYn/);
  assert.match(turnCase, /s\.uid === r\.offUid && s\.offYn/);
});

test("노선 시트에는 키보드 입력이 없고, 노선이 있으면 버스는 두고 시간·정류장만 바꾼다", () => {
  const openRoute = page.slice(page.indexOf("function openRoute"), page.indexOf("function closeRoute"));
  assert.match(openRoute, /steps: info \? \['turn', 'on', 'off'\] : \['line', 'turn', 'on', 'off'\]/);
  assert.doesNotMatch(page, /data-input="route-query"|<input type="search"/);
  assert.match(page, /data-action="route-region"/);
});

test("시트 손잡이와 제목 줄을 끌어내리면 닫힌다", () => {
  assert.match(page, /function enableSheetDrag/);
  assert.match(page, /enableSheetDrag\(\$\('route-sheet'\), closeRoute\)/);
  assert.match(page, /enableSheetDrag\(\$\('confirm-sheet'\)/);
  assert.match(page, /\.sheet-drag \{[^}]*touch-action: none/);
});

test("노선 변경은 초안에 담았다가 적용할 때만 대상에 반영한다", () => {
  assert.match(page, /data-action="route-apply"/);
  assert.match(page, /data-action="route-cancel"/);
  const openRoute = page.slice(page.indexOf("function openRoute"), page.indexOf("function closeRoute"));
  assert.doesNotMatch(openRoute, /t\.lineTurnUid\s*=/);
  assert.match(page, /function applyRoute[\s\S]*t\.lineTurnUid = r\.turnUid/);
});
