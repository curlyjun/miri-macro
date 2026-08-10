const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadConfig } = require("../lib/config");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "miri-config-"));
}

test("동기화된 runtime 설정이 있으면 저장소 설정보다 우선한다", () => {
  const dir = tempDir();
  const runtimePath = path.join(dir, "runtime.json");
  const repoPath = path.join(dir, "repo.json");
  fs.writeFileSync(runtimePath, JSON.stringify({ targets: [{ name: "동기화됨" }] }));
  fs.writeFileSync(repoPath, JSON.stringify({ targets: [{ name: "저장소" }] }));

  assert.equal(loadConfig({ runtimePath, repoPath }).targets[0].name, "동기화됨");
});

test("runtime 사본이 없으면 저장소 설정으로 되돌아간다", () => {
  const dir = tempDir();
  const repoPath = path.join(dir, "repo.json");
  fs.writeFileSync(repoPath, JSON.stringify({ targets: [{ name: "저장소" }] }));

  const config = loadConfig({ runtimePath: path.join(dir, "없음.json"), repoPath });
  assert.equal(config.targets[0].name, "저장소");
});

test("동기화된 설정이 깨져 있으면 조용히 옛 설정으로 예약하지 않는다", () => {
  const dir = tempDir();
  const runtimePath = path.join(dir, "runtime.json");
  const repoPath = path.join(dir, "repo.json");
  fs.writeFileSync(runtimePath, "{ 깨진 JSON");
  fs.writeFileSync(repoPath, JSON.stringify({ targets: [] }));

  assert.throws(() => loadConfig({ runtimePath, repoPath }), SyntaxError);
});

test("설정 파일이 하나도 없으면 오류를 낸다", () => {
  const dir = tempDir();
  assert.throws(
    () => loadConfig({ runtimePath: path.join(dir, "a.json"), repoPath: path.join(dir, "b.json") }),
    /설정 파일을 찾을 수 없습니다/,
  );
});

test("진입점은 실행 시점에 설정을 읽는다", () => {
  for (const entry of ["monitor.js", "auto_book.js"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", entry), "utf8");
    assert.match(source, /config = loadConfig\(\)/, entry);
    assert.doesNotMatch(source, /require\("\.\/config\.json"\)/, entry);
  }
});
