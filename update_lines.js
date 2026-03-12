"use strict";

const fs = require("fs");
const path = require("path");
const {
  getBaseUrl,
  getHeaders,
  nowKST,
  fetchServiceUid,
  FALLBACK_SERVICE_UID,
  setServiceUid,
  sendTelegram,
} = require("./lib/common");

const LINE_JSON_PATH = path.join(__dirname, "line.json");

async function fetchLineRoute() {
  const url = `${getBaseUrl()}/line/route?searchText=&sortOrder=no%20asc`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function diffLines(oldData, newData) {
  const oldMap = new Map(oldData.map((l) => [l.uid, l]));
  const newMap = new Map(newData.map((l) => [l.uid, l]));

  const added = newData.filter((l) => !oldMap.has(l.uid));
  const removed = oldData.filter((l) => !newMap.has(l.uid));
  const renamed = newData
    .filter((l) => oldMap.has(l.uid) && oldMap.get(l.uid).name !== l.name)
    .map((l) => ({ uid: l.uid, no: l.no, oldName: oldMap.get(l.uid).name, newName: l.name }));

  return { added, removed, renamed };
}

async function runUpdateLines() {
  const executedAt = nowKST();
  console.log(`[${executedAt}] 노선 데이터 갱신 시작`);

  // 기존 line.json 로드
  let oldData = [];
  try {
    const raw = fs.readFileSync(LINE_JSON_PATH, "utf-8");
    oldData = JSON.parse(raw).data || [];
    console.log(`  기존 line.json: ${oldData.length}개 노선`);
  } catch (err) {
    console.warn(`  line.json 로드 실패 (최초 실행일 수 있음): ${err.message}`);
  }

  // 신규 데이터 조회
  const json = await fetchLineRoute();
  if (json.resultCode !== 0) {
    const msg = `❌ <b>노선 데이터 조회 실패</b>\n${json.resultMessage}\n🕐 ${executedAt}`;
    console.error(msg.replace(/<[^>]+>/g, ""));
    await sendTelegram(msg);
    return;
  }

  const newData = json.data || [];
  console.log(`  신규 데이터: ${newData.length}개 노선`);

  // 변경 감지
  const { added, removed, renamed } = diffLines(oldData, newData);
  const hasChanges = added.length > 0 || removed.length > 0 || renamed.length > 0;

  if (hasChanges) {
    // line.json 업데이트
    fs.writeFileSync(LINE_JSON_PATH, JSON.stringify(json, null, 2), "utf-8");
    console.log("  line.json 업데이트 완료");

    let changeText = "";
    if (added.length > 0) {
      changeText += `\n➕ 추가 (${added.length}개): ${added.map((l) => `[${l.no}] ${l.name}`).join(", ")}`;
    }
    if (removed.length > 0) {
      changeText += `\n➖ 삭제 (${removed.length}개): ${removed.map((l) => `[${l.no}] ${l.name}`).join(", ")}`;
    }
    if (renamed.length > 0) {
      changeText += `\n✏️ 이름변경 (${renamed.length}개): ${renamed.map((r) => `[${r.no}] ${r.oldName} → ${r.newName}`).join(", ")}`;
    }

    const msg =
      `🔄 <b>노선 데이터 변경 감지!</b>\n` +
      `📊 총 ${newData.length}개 노선 (기존 ${oldData.length}개)` +
      changeText +
      `\n✅ line.json 업데이트 완료\n🕐 ${executedAt}`;
    console.log(msg.replace(/<[^>]+>/g, ""));
    await sendTelegram(msg);
  } else {
    const msg =
      `🔍 <b>노선 데이터 조회 완료</b>\n` +
      `📊 총 ${newData.length}개 노선 (변경 없음)\n` +
      `🕐 ${executedAt}`;
    console.log(msg.replace(/<[^>]+>/g, ""));
    await sendTelegram(msg);
  }

  console.log("노선 데이터 갱신 완료");
}

async function main() {
  if (!process.env.BEARER_TOKEN && !process.env.MIRI_REFRESH_TOKEN) {
    console.error(
      "오류: BEARER_TOKEN 또는 MIRI_REFRESH_TOKEN 환경변수가 필요합니다.",
    );
    process.exit(1);
  }

  // 서비스 UID 동적 조회 (실패 시 폴백)
  const serviceUid = await fetchServiceUid();
  if (serviceUid && serviceUid !== FALLBACK_SERVICE_UID) {
    console.log(`[서비스] UID 업데이트: ${serviceUid}`);
    setServiceUid(serviceUid);
  }

  await runUpdateLines();
}

main().catch((err) => {
  console.error("치명적 오류:", err);
  process.exit(1);
});
