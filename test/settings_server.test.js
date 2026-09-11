const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createSettingsServer } = require("../server");

const TARGET = {
  name: "출근",
  lineTurnUid: "line",
  onStationUid: "on",
  offStationUid: "off",
  autoBookEnabled: true,
  monitorEnabled: false,
  weekdays: ["MON"],
  monitorDates: [],
  seatPreference: { preferredSeats: [], fallbackMode: "any" },
};

async function startServer(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miri-settings-"));
  const paths = {
    runtimePath: path.join(dir, "runtime", "config.json"),
    repoPath: path.join(dir, "config.json"),
    docsDir: dir,
    lineJsonPath: path.join(dir, "line.json"),
  };
  fs.writeFileSync(paths.repoPath, JSON.stringify({ targets: [TARGET] }));
  fs.writeFileSync(path.join(dir, "index.html"), "<h1>예약 설정</h1>");
  fs.writeFileSync(path.join(dir, "config-utils.js"), "var ConfigUtils = {};");

  const server = createSettingsServer(paths);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return { base: `http://127.0.0.1:${server.address().port}`, paths };
}

async function getConfig(base) {
  return (await fetch(`${base}/api/config`)).json();
}

function putConfig(base, body) {
  return fetch(`${base}/api/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("runtime 사본이 없으면 저장소 설정을 버전과 함께 돌려준다", async (t) => {
  const { base } = await startServer(t);

  const data = await getConfig(base);
  assert.equal(data.config.targets[0].name, "출근");
  assert.match(data.version, /^[0-9a-f]{40}$/);
});

test("저장하면 runtime/config.json에 쓰고 저장소 파일은 건드리지 않는다", async (t) => {
  const { base, paths } = await startServer(t);
  const { version } = await getConfig(base);
  const repoBefore = fs.readFileSync(paths.repoPath, "utf8");

  const res = await putConfig(base, { config: { targets: [{ ...TARGET, name: "퇴근" }] }, version });
  assert.equal(res.status, 200);
  const saved = await res.json();

  assert.equal(JSON.parse(fs.readFileSync(paths.runtimePath, "utf8")).targets[0].name, "퇴근");
  assert.equal(fs.readFileSync(paths.repoPath, "utf8"), repoBefore);
  const reloaded = await getConfig(base);
  assert.equal(reloaded.config.targets[0].name, "퇴근");
  assert.equal(reloaded.version, saved.version);
});

test("다른 곳에서 먼저 저장했으면 409로 거절한다", async (t) => {
  const { base, paths } = await startServer(t);
  const { version } = await getConfig(base);
  await putConfig(base, { config: { targets: [{ ...TARGET, name: "먼저" }] }, version });

  const res = await putConfig(base, { config: { targets: [{ ...TARGET, name: "나중" }] }, version });
  assert.equal(res.status, 409);
  assert.equal(JSON.parse(fs.readFileSync(paths.runtimePath, "utf8")).targets[0].name, "먼저");
});

test("검증에 실패한 설정은 저장하지 않는다", async (t) => {
  const { base, paths } = await startServer(t);
  const { version } = await getConfig(base);

  const res = await putConfig(base, { config: { targets: [{ ...TARGET, lineTurnUid: "" }] }, version });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /예약 대상 1: .*노선/);
  assert.equal(fs.existsSync(paths.runtimePath), false);
});

test("설정 없이 보낸 요청은 거절한다", async (t) => {
  const { base, paths } = await startServer(t);
  const { version } = await getConfig(base);

  const res = await putConfig(base, { version });
  assert.equal(res.status, 400);
  assert.equal(fs.existsSync(paths.runtimePath), false);
});

test("설정 페이지와 쿼리가 붙은 스크립트 경로를 제공한다", async (t) => {
  const { base } = await startServer(t);

  assert.match(await (await fetch(`${base}/`)).text(), /예약 설정/);
  const script = await fetch(`${base}/config-utils.js?v=2`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type"), /javascript/);
  assert.equal((await fetch(`${base}/server.js`)).status, 404);
});
