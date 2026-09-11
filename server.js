"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const zlib = require("zlib");
const { REPO_CONFIG_PATH, RUNTIME_CONFIG_PATH, validateConfig } = require("./lib/config");

// 같은 Wi-Fi의 다른 기기가 설정을 바꾸지 못하도록 기본은 루프백에만 연다.
// 모바일에서 쓰려면 SETTINGS_HOST에 이 Mac의 Tailscale IP를 줘 tailnet 안에서만 열리게 한다.
const DEFAULT_HOST = "127.0.0.1";
// personal-assets가 8787을 쓰므로 겹치지 않게 둔다.
const DEFAULT_PORT = 8790;

function readConfigText({ runtimePath, repoPath }) {
  for (const candidate of [runtimePath, repoPath]) {
    try {
      return fs.readFileSync(candidate, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  throw new Error("설정 파일을 찾을 수 없습니다.");
}

function versionOf(text) {
  return crypto.createHash("sha1").update(text).digest("hex");
}

function writeConfigText(runtimePath, text) {
  fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
  const temporaryPath = `${runtimePath}.tmp`;
  fs.writeFileSync(temporaryPath, text);
  fs.renameSync(temporaryPath, runtimePath);
}

function send(req, res, status, body, type) {
  let payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const headers = { "Content-Type": type, "Cache-Control": "no-store", "X-Miri-Settings": "1" };
  // line.json이 6MB라 모바일에서 그대로 받으면 느리다. gzip하면 크게 준다.
  if (/\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
    payload = zlib.gzipSync(payload);
    headers["Content-Encoding"] = "gzip";
  }
  res.writeHead(status, headers);
  res.end(payload);
}

function sendJson(req, res, status, value) {
  send(req, res, status, JSON.stringify(value), "application/json; charset=utf-8");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function describeErrors(validation) {
  return validation.targets
    .filter((item) => !item.valid)
    .map((item) => `예약 대상 ${item.index + 1}: ${item.errors.join(" ")}`)
    .join("\n");
}

function createSettingsServer({
  runtimePath = RUNTIME_CONFIG_PATH,
  repoPath = REPO_CONFIG_PATH,
  docsDir = path.join(__dirname, "docs"),
  lineJsonPath = path.join(__dirname, "line.json"),
} = {}) {
  const files = {
    "/": [path.join(docsDir, "index.html"), "text/html; charset=utf-8"],
    "/config-utils.js": [path.join(docsDir, "config-utils.js"), "text/javascript; charset=utf-8"],
    "/line.json": [lineJsonPath, "application/json; charset=utf-8"],
  };

  async function handleConfig(req, res) {
    if (req.method === "GET") {
      const text = readConfigText({ runtimePath, repoPath });
      return sendJson(req, res, 200, { config: JSON.parse(text), version: versionOf(text) });
    }
    if (req.method !== "PUT") {
      return sendJson(req, res, 405, { error: "허용되지 않는 요청입니다." });
    }

    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      body = null;
    }
    if (!Array.isArray(body?.config?.targets)) {
      return sendJson(req, res, 400, { error: "요청 형식이 올바르지 않습니다." });
    }
    // 폰과 PC에서 동시에 고칠 때 나중 저장이 앞선 변경을 모르고 덮어쓰지 않게 한다.
    if (body.version !== versionOf(readConfigText({ runtimePath, repoPath }))) {
      return sendJson(req, res, 409, { error: "다른 곳에서 설정이 변경되었습니다." });
    }
    const validation = validateConfig(body.config);
    if (!validation.valid) {
      return sendJson(req, res, 400, { error: describeErrors(validation) });
    }

    const text = `${JSON.stringify(body.config, null, 2)}\n`;
    writeConfigText(runtimePath, text);
    return sendJson(req, res, 200, { version: versionOf(text) });
  }

  return http.createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, "http://localhost");
      if (pathname === "/api/config") return await handleConfig(req, res);
      const file = files[pathname];
      if (!file || req.method !== "GET") {
        return sendJson(req, res, 404, { error: "없는 경로입니다." });
      }
      return send(req, res, 200, fs.readFileSync(file[0]), file[1]);
    } catch (error) {
      console.error("[설정]", error);
      return sendJson(req, res, 500, { error: error.message });
    }
  });
}

// 포트를 이미 누가 쓰고 있을 때, 그게 이 설정 서버인지 응답 헤더로 확인한다.
async function isOwnServer(host, port) {
  try {
    const res = await fetch(`http://${host}:${port}/`, { signal: AbortSignal.timeout(3000) });
    return res.headers.get("x-miri-settings") === "1";
  } catch {
    return false;
  }
}

if (require.main === module) {
  const host = process.env.SETTINGS_HOST || DEFAULT_HOST;
  const port = Number(process.env.SETTINGS_PORT) || DEFAULT_PORT;
  const server = createSettingsServer();
  // cron이 5분마다 이 파일을 실행해 꺼진 서버를 되살린다. 이미 떠 있는 게 이 서버면
  // 조용히 끝내고, 다른 프로그램이 포트를 차지했으면 매번 로그에 남겨 알아챌 수 있게 한다.
  server.on("error", async (error) => {
    if (error.code !== "EADDRINUSE") throw error;
    if (await isOwnServer(host, port)) process.exit(0);
    console.error(
      `[설정] ${new Date().toISOString()} ${host}:${port}를 다른 프로그램이 쓰고 있습니다. SETTINGS_PORT로 다른 포트를 지정하세요.`,
    );
    process.exit(1);
  });
  server.listen(port, host, () => {
    console.log(`[설정] ${new Date().toISOString()} http://${host}:${port} 에서 대기 중`);
  });
}

module.exports = { createSettingsServer, isOwnServer };
