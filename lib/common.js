"use strict";

require("dotenv").config();

const dns = require("dns");
const { createApiClient } = require("./api-client");
const { enqueue: enqueueOutbox, flush: flushOutbox } = require("./outbox");

// api.telegram.org는 AAAA 레코드를 가진다. IPv6 주소만 붙어 있고 실제 경로가 없는
// 호스트에서는 텔레그램만 골라서 연결이 타임아웃되므로 IPv4를 먼저 시도한다.
if (typeof dns.setDefaultResultOrder === "function") {
  dns.setDefaultResultOrder("ipv4first");
}

const bootstrapClient = createApiClient({ refreshAuth: async () => false });
const telegramClient = createApiClient({
  refreshAuth: async () => false,
  retries: Number(process.env.TELEGRAM_RETRIES) || 3,
  includeErrorBody: true,
});

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
    const json = await bootstrapClient.requestJson(SERVICE_INFO_URL, {
      headers: getHeaders,
    });
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
    const json = await bootstrapClient.requestJson(getRefreshUrl(), {
      method: "POST",
      headers: () => ({
        Authorization: `Bearer ${process.env.BEARER_TOKEN || ""}`,
        Accept: "application/json, text/plain, */*",
        Origin: "https://commute.e-bus.co.kr",
        Referer: "https://commute.e-bus.co.kr/",
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148/iosapp",
        "Content-Type": "application/x-www-form-urlencoded",
      }),
      body: new URLSearchParams({ memberUid, refreshToken }).toString(),
    });
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

const apiClient = createApiClient({
  refreshAuth: async () => {
    const token = await refreshAccessToken();
    if (!token) return false;
    process.env.BEARER_TOKEN = token;
    return true;
  },
});

function requestJson(url, options = {}) {
  return apiClient.requestJson(url, {
    ...options,
    headers: options.headers || getHeaders,
  });
}

// ──────────────── 텔레그램 ────────────────

function hasTelegramCredentials() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

// 4xx는 같은 메시지를 다시 보내도 결과가 같으므로 큐에 쌓지 않는다. 429는 예외.
function isPermanentTelegramError(error) {
  return error?.status >= 400 && error.status < 500 && error.status !== 429;
}

// 실패하면 예외를 던진다. 큐 재전송에서 성공/실패를 구분해야 하므로 여기서는 삼키지 않는다.
async function sendTelegramRaw(message) {
  try {
    const json = await telegramClient.requestJson(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: "HTML",
        }),
      },
    );
    if (!json.ok) {
      const error = new Error(json.description || "텔레그램이 메시지를 거부했습니다.");
      error.permanent = true;
      throw error;
    }
    return json;
  } catch (error) {
    if (isPermanentTelegramError(error)) error.permanent = true;
    throw error;
  }
}

async function sendTelegram(message) {
  if (!hasTelegramCredentials()) {
    console.warn(
      "[Telegram] TELEGRAM_BOT_TOKEN 또는 TELEGRAM_CHAT_ID가 설정되지 않았습니다.",
    );
    return false;
  }
  try {
    await sendTelegramRaw(message);
    return true;
  } catch (error) {
    console.error("[Telegram] 전송 실패:", error.message);
    if (error.permanent) {
      console.error("[Telegram] 재시도해도 같은 결과라 큐에 넣지 않습니다.");
      return false;
    }
    try {
      const { pending } = enqueueOutbox(message);
      console.error(`[Telegram] 미전송 큐에 보관했습니다. 대기 ${pending}건`);
    } catch (queueError) {
      console.error("[Telegram] 큐 저장 실패:", queueError.message);
    }
    return false;
  }
}

// 5분마다 도는 monitor가 호출해 밀린 알림을 흘려보낸다. 단발성인 예약 완료 알림도
// 전송이 한 번 실패했다고 사라지지 않는다.
async function flushTelegramOutbox(options = {}) {
  if (!hasTelegramCredentials()) return { sent: 0, expired: 0, dropped: 0, pending: 0 };
  const result = await flushOutbox(sendTelegramRaw, options);
  if (result.sent || result.dropped || result.expired || result.pending) {
    console.log(
      `[Telegram] 큐 전송 ${result.sent}건 / 폐기 ${result.dropped}건 / 만료 ${result.expired}건 / 남음 ${result.pending}건`,
    );
  }
  return result;
}

// ──────────────── MiRi API ────────────────

async function getBookableDates(target) {
  const url =
    `${getBaseUrl()}/book/bookable-date` +
    `?lineTurnUid=${target.lineTurnUid}` +
    `&onStationUid=${target.onStationUid}` +
    `&withCalendarYn=true`;
  return requestJson(url);
}

async function getBookableSeats(lineTurnUid, date, allocUid) {
  const url =
    `${getBaseUrl()}/book/bookable-seat` +
    `?lineTurnUid=${lineTurnUid}` +
    `&date=${date}` +
    `&allocUid=${allocUid}`;
  return requestJson(url);
}

async function bookSeat(target, date, allocUid, seatNo) {
  return requestJson(`${getBaseUrl()}/book-etoken`, {
    method: "POST",
    headers: () => ({ ...getHeaders(), "Content-Type": "application/json" }),
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

  if (pref?.preferredSeats?.length) {
    for (const prefSeatNo of pref.preferredSeats) {
      const seat = available.find((s) => s.seatNo == prefSeatNo);
      if (seat) {
        console.log(`[좌석] 선호 좌석: ${seat.seatNo}번`);
        return seat;
      }
    }
  }

  if (pref?.fallbackMode === "preferredOnly") {
    console.log("[좌석] 선호 좌석만 예약하도록 설정되어 폴백하지 않습니다.");
    return null;
  }

  // 폴백: 우선순위 낮은 순으로 아무 좌석
  const fallback = available.sort((a, b) => a.priority - b.priority)[0] || null;
  if (fallback) console.log(`[좌석] 폴백: ${fallback.seatNo}`);
  return fallback;
}

// ──────────────── 공통 초기화 ────────────────

async function initCommon() {
  if (!process.env.BEARER_TOKEN && !process.env.MIRI_REFRESH_TOKEN) {
    throw new Error("BEARER_TOKEN 또는 MIRI_REFRESH_TOKEN 환경변수가 필요합니다.");
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
      throw new Error("토큰 갱신 실패. BEARER_TOKEN도 없어 실행할 수 없습니다.");
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
  requestJson,
  sendTelegram,
  sendTelegramRaw,
  flushTelegramOutbox,
  getBookableDates,
  getBookableSeats,
  bookSeat,
  selectBestSeat,
  initCommon,
};
