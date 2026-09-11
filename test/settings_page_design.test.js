const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const page = fs.readFileSync(path.join(__dirname, "..", "docs", "index.html"), "utf8");

test("기본 입력칸 규칙은 :where()로 우선순위를 낮춰 컴포넌트 규칙을 덮지 않는다", () => {
  assert.match(page, /:where\(input\[type="text"\]/);
  assert.doesNotMatch(page, /^\s*input\[type="text"\][^{]*\{/m);
});

test("시스템 다크 모드를 따르고 한 줄 머리글만 쓴다", () => {
  assert.match(page, /@media \(prefers-color-scheme: dark\)/);
  assert.match(page, /class="app-bar"/);
  assert.doesNotMatch(page, /class="global-nav"|class="sub-nav"/);
});

test("예약 대상은 같은 표면을 쓰고 번갈아 검은 배경으로 바뀌지 않는다", () => {
  assert.doesNotMatch(page, /nth-child\(even\)/);
});

test("휴대폰에서 누르는 요소는 44px 이상이다", () => {
  for (const selector of [".icon-btn", ".day-btn", ".seat", ".link-btn", ".btn"]) {
    const rule = page.match(new RegExp(`\\n\\s*${selector.replace(".", "\\.")} \\{[^}]*\\}`))?.[0] || "";
    assert.match(rule, /(min-height|height): 44px/, selector);
  }
});

test("기능 켜기·끄기는 스위치 역할로 알린다", () => {
  assert.match(page, /role="switch"/);
  assert.doesNotMatch(page, /모니터링 날짜|runtime\/config\.json|이 Mac/);
});
