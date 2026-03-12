"use strict";

require("dotenv").config();

const API_ROOT = "https://commute-miri-api.e-bus.co.kr/aibos/client/api";
const SERVICE_INFO_URL = `${API_ROOT}/v1/public/service/MIRI`;
const FALLBACK_SERVICE_UID = "MIRI00000000000000000000000SVC";

let baseUrl = `${API_ROOT}/v1/service/${FALLBACK_SERVICE_UID}`;
let refreshUrl = `${API_ROOT}/v1/public/service/${FALLBACK_SERVICE_UID}/member/refresh-token`;

function setServiceUid(uid) {
  baseUrl = `${API_ROOT}/v1/service/${uid}`;
  refreshUrl = `${API_ROOT}/v1/public/service/${uid}/member/refresh-token`;
}

function getBaseUrl() {
  return baseUrl;
}

function getRefreshUrl() {
  return refreshUrl;
}

const WEEKDAY_MAP = {
  0: "SUN",
  1: "MON",
  2: "TUE",
  3: "WED",
  4: "THU",
  5: "FRI",
  6: "SAT",
};

const WEEKDAY_CODE_MAP = {
  MON: "WKD-MON",
  TUE: "WKD-TUE",
  WED: "WKD-WED",
  THU: "WKD-THU",
  FRI: "WKD-FRI",
  SAT: "WKD-SAT",
  SUN: "WKD-SUN",
};

// ──────────────── 공통 유틸 ────────────────

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
    Accept: "application/json, text/plain, */*",
    Origin: "https://commute.e-bus.co.kr",
    Referer: "https://commute.e-bus.co.kr/",
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148/iosapp",
    "Accept-Language": "ko-KR,ko;q=0.9",
    "Sec-Fetch-Site": "same-site",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function matchesWeekday(weekdayCode, weekdays) {
  return weekdays.some((w) => WEEKDAY_CODE_MAP[w] === weekdayCode);
}

function nowKST() {
  return new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

// ──────────────── 서비스 UID 동적 조회 ────────────────

async function fetchServiceUid() {
  try {
    const res = await fetch(SERVICE_INFO_URL, { headers: getHeaders() });
    if (!res.ok) {
      console.warn(`[서비스] UID 조회 실패: HTTP ${res.status} - 기존 값 사용`);
      return null;
    }
    const json = await res.json();
    if (json.resultCode !== 0 || !json.data?.uid) {
      console.warn(`[서비스] UID 조회 실패: ${json.resultMessage} - 기존 값 사용`);
      return null;
    }
    return json.data.uid;
  } catch (err) {
    console.warn(`[서비스] UID 조회 오류: ${err.message} - 기존 값 사용`);
    return null;
  }
}

// ──────────────── 토큰 자동 갱신 ────────────────

async function refreshAccessToken() {
  const refreshToken = process.env.MIRI_REFRESH_TOKEN;
  const memberUid = process.env.MIRI_MEMBER_UID;
  if (!refreshToken || !memberUid) return null;

  try {
    console.log("[토큰] refresh 시도...");
    const res = await fetch(getRefreshUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.BEARER_TOKEN || ""}`,
        Accept: "application/json, text/plain, */*",
        Origin: "https://commute.e-bus.co.kr",
        Referer: "https://commute.e-bus.co.kr/",
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148/iosapp",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ memberUid, refreshToken }).toString(),
    });
    if (!res.ok) {
      console.warn(`[토큰] refresh 실패: HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    if (json.resultCode !== 0) {
      console.warn("[토큰] refresh 실패:", json.resultMessage);
      return null;
    }
    console.log("[토큰] refresh 성공");
    return json.data.accessToken;
  } catch (err) {
    console.warn("[토큰] refresh 오류:", err.message);
    return null;
  }
}

// ──────────────── 텔레그램 ────────────────

async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn(
      "[Telegram] TELEGRAM_BOT_TOKEN 또는 TELEGRAM_CHAT_ID가 설정되지 않았습니다.",
    );
    return;
  }
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: "HTML",
        }),
      },
    );
    const json = await res.json();
    if (!json.ok) console.error("[Telegram] 전송 실패:", json.description);
  } catch (err) {
    console.error("[Telegram] 오류:", err.message);
  }
}

// ──────────────── MiRi API ────────────────

async function getBookableDates(target) {
  const url =
    `${getBaseUrl()}/book/bookable-date` +
    `?lineTurnUid=${target.lineTurnUid}` +
    `&onStationUid=${target.onStationUid}` +
    `&withCalendarYn=true`;
  const res = await fetch(url, { headers: getHeaders() });
  if (res.status === 401) {
    await sendTelegram(
      "⚠️ <b>MiRi 토큰 만료 (자동 갱신 실패)</b>\n" +
        "MIRI_REFRESH_TOKEN이 만료되었습니다.\n" +
        "Proxyman으로 새 토큰을 캡처한 뒤\n" +
        "GitHub Secrets → BEARER_TOKEN, MIRI_REFRESH_TOKEN을 업데이트해주세요.",
    );
    process.exit(1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getBookableSeats(lineTurnUid, date, allocUid) {
  const url =
    `${getBaseUrl()}/book/bookable-seat` +
    `?lineTurnUid=${lineTurnUid}` +
    `&date=${date}` +
    `&allocUid=${allocUid}`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function bookSeat(target, date, allocUid, seatNo) {
  const res = await fetch(`${getBaseUrl()}/book-etoken`, {
    method: "POST",
    headers: { ...getHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      autoAssignDupSeatYn: false,
      lines: [
        {
          lineTurnUid: target.lineTurnUid,
          onStationUid: target.onStationUid,
          offStationUid: target.offStationUid,
          terms: [{ date, seats: [{ allocUid, seatNo }] }],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ──────────────── 좌석 선택 ────────────────

function selectBestSeat(seatsData, pref) {
  const raw = Array.isArray(seatsData) ? seatsData[0] : seatsData;
  const seats = raw?.seats;

  if (!seats) {
    console.error(
      "[좌석] seats 필드를 찾을 수 없습니다. 응답 구조:",
      JSON.stringify(Object.keys(raw || {})),
    );
    return null;
  }

  const sample = seats.flat(Infinity).find((s) => s && s.seatNo !== "");
  if (sample) {
    console.log(
      "[좌석 구조] 샘플:",
      JSON.stringify({
        seatNo: sample.seatNo,
        rowNo: sample.rowNo,
        columnNo: sample.columnNo,
        priority: sample.priority,
      }),
    );
  }

  const available = seats
    .flat(Infinity)
    .filter((s) => s && !s.bookedYn && s.seatNo !== "");

  if (!pref) {
    const fallback = available.sort((a, b) => a.priority - b.priority)[0];
    if (fallback) console.log(`[좌석] 기본 선택: ${fallback.seatNo}`);
    return fallback || null;
  }

  // 1순위: 선호 열 + fromRow 이상, 앞줄 우선
  const preferred = available
    .filter(
      (s) =>
        s.rowNo >= pref.fromRow && pref.preferredColumns.includes(s.columnNo),
    )
    .sort(
      (a, b) =>
        a.rowNo - b.rowNo ||
        pref.preferredColumns.indexOf(a.columnNo) -
          pref.preferredColumns.indexOf(b.columnNo),
    );

  if (preferred.length > 0) {
    console.log(
      `[좌석] 선호 좌석: ${preferred[0].seatNo} (${preferred[0].rowNo}줄 열${preferred[0].columnNo})`,
    );
    return preferred[0];
  }

  // 2순위: fromRow 이상 아무 좌석
  const fromRow = available
    .filter((s) => s.rowNo >= pref.fromRow)
    .sort((a, b) => a.priority - b.priority);

  if (fromRow.length > 0) {
    console.log(`[좌석] 2순위(줄 조건만): ${fromRow[0].seatNo}`);
    return fromRow[0];
  }

  // 최후: 아무 좌석
  const last = available.sort((a, b) => a.priority - b.priority)[0];
  if (last) console.log(`[좌석] 폴백: ${last.seatNo}`);
  return last || null;
}

// ──────────────── 공통 초기화 ────────────────

async function initCommon() {
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

  // 토큰 자동 갱신
  if (process.env.MIRI_REFRESH_TOKEN) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      process.env.BEARER_TOKEN = newToken;
    } else if (!process.env.BEARER_TOKEN) {
      console.error("오류: 토큰 갱신 실패. BEARER_TOKEN도 없어 실행 불가.");
      process.exit(1);
    } else {
      console.warn("[토큰] 갱신 실패 - 기존 BEARER_TOKEN으로 계속 시도합니다.");
    }
  }
}

module.exports = {
  API_ROOT,
  FALLBACK_SERVICE_UID,
  WEEKDAY_MAP,
  WEEKDAY_CODE_MAP,
  getBaseUrl,
  getRefreshUrl,
  setServiceUid,
  getHeaders,
  sleep,
  matchesWeekday,
  nowKST,
  fetchServiceUid,
  refreshAccessToken,
  sendTelegram,
  getBookableDates,
  getBookableSeats,
  bookSeat,
  selectBestSeat,
  initCommon,
};
