const assert = require("node:assert/strict");
const test = require("node:test");

const { escapeHtml } = require("../lib/telegram");

test("텔레그램 동적 값을 HTML 이스케이프한다", () => {
  assert.equal(escapeHtml("A&B <출근>"), "A&amp;B &lt;출근&gt;");
});
