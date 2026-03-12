"use strict";

require("dotenv").config();

const config = require("./config.json");
const MODE = process.env.MODE || "monitor";

const API_ROOT = "https://commute-miri-api.e-bus.co.kr/aibos/client/api";
const BASE_URL = `${API_ROOT}/v1/service/MIRI00000000000000000000000SVC`;
const REFRESH_URL = `${API_ROOT}/v1/public/service/MIRI00000000000000000000000SVC/member/refresh-token`;

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

// ──────────────── 토큰 자동 갱신 ────────────────

async function refreshAccessToken() {
  const refreshToken = process.env.MIRI_REFRESH_TOKEN;
  const memberUid = process.env.MIRI_MEMBER_UID;
  if (!refreshToken || !memberUid) return null;

  try {
    console.log("[토큰] refresh 시도...");
    const res = await fetch(REFRESH_URL, {
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
    `${BASE_URL}/book/bookable-date` +
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
    `${BASE_URL}/book/bookable-seat` +
    `?lineTurnUid=${lineTurnUid}` +
    `&date=${date}` +
    `&allocUid=${allocUid}`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function bookSeat(target, date, allocUid, seatNo) {
  const res = await fetch(`${BASE_URL}/book-etoken`, {
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
  // bookable-seat 응답 구조: data.seats 또는 data[0].seats
  const raw = Array.isArray(seatsData) ? seatsData[0] : seatsData;
  const seats = raw?.seats;

  if (!seats) {
    console.error(
      "[좌석] seats 필드를 찾을 수 없습니다. 응답 구조:",
      JSON.stringify(Object.keys(raw || {})),
    );
    return null;
  }

  // 구조 확인 로그 (첫 실행 시 디버깅용)
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

// ──────────────── Monitor 모드 ────────────────

async function runMonitor() {
  console.log(`[${nowKST()}] 모니터링 시작`);

  for (const target of config.targets) {
    try {
      const json = await getBookableDates(target);
      if (json.resultCode !== 0) {
        console.error(`[${target.name}] API 오류: ${json.resultMessage}`);
        continue;
      }

      const dates = json.data[0].bookableDates;

      for (const d of dates) {
        // 이미 예약된 날짜 스킵
        const alreadyBooked =
          d.myBookRangeCount > 0 || (d.myBooks && d.myBooks.length > 0);
        if (alreadyBooked) {
          console.log(`  [${d.date}] 이미 예약됨 - 스킵`);
          continue;
        }

        // 요일 필터
        if (
          target.weekdays?.length &&
          !matchesWeekday(d.weekdayCode, target.weekdays)
        )
          continue;

        // 특정 날짜 필터 (dates 설정된 경우만)
        if (target.dates?.length && !target.dates.includes(d.date)) continue;

        const remaining = d.seatCount - d.bookCount;

        if (d.bookableYn && d.seatRemainYn) {
          console.log(`  [${d.date}] 잔여 ${remaining}석! 텔레그램 알림 전송`);
          await sendTelegram(
            `🚌 <b>${target.name}</b>\n` +
              `📅 ${d.date}\n` +
              `💺 잔여 좌석: ${remaining}석\n` +
              `⏰ 지금 MiRi 앱에서 예약하세요!`,
          );
        } else {
          console.log(`  [${d.date}] 잔여 없음 (${remaining}석)`);
        }
      }
    } catch (err) {
      console.error(`[${target.name}] 오류:`, err.message);
    }
  }

  console.log("모니터링 완료");
}

// ──────────────── Auto-Book 모드 ────────────────

async function runAutoBook() {
  // KST 기준 오늘 + 7일 = 예약 오픈 대상 날짜
  const nowUtcMs = Date.now();
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const targetKST = new Date(nowUtcMs + kstOffsetMs + 7 * 24 * 60 * 60 * 1000);
  const targetDate = targetKST.toISOString().slice(0, 10);
  const targetWeekday = WEEKDAY_MAP[targetKST.getUTCDay()];
  const targetDateLabel = `${targetDate} (${targetWeekday})`;
  const executedAt = nowKST();

  console.log(
    `[${nowKST()}] 자동 예약 시작 - 대상: ${targetDate} (${targetWeekday})`,
  );

  for (const target of config.targets) {
    // 요일 필터
    if (target.weekdays?.length && !target.weekdays.includes(targetWeekday)) {
      console.log(
        `[${target.name}] ${targetDate}(${targetWeekday})은 감시 요일이 아닙니다.`,
      );
      continue;
    }

    let booked = false;

    for (let attempt = 1; attempt <= 5 && !booked; attempt++) {
      try {
        console.log(`[${target.name}] 예약 시도 ${attempt}/5...`);

        const json = await getBookableDates(target);
        if (json.resultCode !== 0) {
          console.error(`API 오류: ${json.resultMessage}`);
          break;
        }

        const dateInfo = json.data[0].bookableDates.find(
          (d) => d.date === targetDate,
        );
        if (!dateInfo) {
          console.log(
            `  ${targetDate} 날짜 정보 없음 (아직 오픈 전일 수 있음)`,
          );
          if (attempt < 5) {
            await sleep(10000);
          }
          continue;
        }

        // 이미 예약된 경우
        const alreadyBooked =
          dateInfo.myBookRangeCount > 0 ||
          (dateInfo.myBooks && dateInfo.myBooks.length > 0);
        if (alreadyBooked) {
          booked = true;
          const msg = `✅ <b>${targetDateLabel} 이미 예약되어 있습니다.</b>\n🚌 ${target.name}\n🕐 실행 시간: ${executedAt}`;
          console.log(msg.replace(/<[^>]+>/g, ""));
          await sendTelegram(msg);
          break;
        }

        if (!dateInfo.bookableYn || !dateInfo.seatRemainYn) {
          console.log(
            `  ${targetDate} 예약 불가 (bookable=${dateInfo.bookableYn}, seatRemain=${dateInfo.seatRemainYn})`,
          );
          if (attempt < 5) {
            await sleep(10000);
          }
          continue;
        }

        // 좌석 조회
        const allocUid = dateInfo.allocs[0].allocUid;
        console.log(`  좌석 조회 중 (allocUid=${allocUid})`);
        const seatsJson = await getBookableSeats(
          target.lineTurnUid,
          targetDate,
          allocUid,
        );

        if (seatsJson.resultCode !== 0) {
          console.error(`  좌석 조회 오류: ${seatsJson.resultMessage}`);
          break;
        }

        const bestSeat = selectBestSeat(seatsJson.data, target.seatPreference);
        if (!bestSeat) {
          console.log("  선택 가능한 좌석이 없습니다.");
          break;
        }

        // 예약 실행
        console.log(`  예약 시도: ${bestSeat.seatNo}번 좌석`);
        const bookResult = await bookSeat(
          target,
          targetDate,
          allocUid,
          bestSeat.seatNo,
        );

        if (bookResult.resultCode === 0) {
          booked = true;
          const info = bookResult.data[0];
          const msg =
            `✅ <b>예약 완료!</b>\n` +
            `🚌 ${target.name}\n` +
            `📅 ${targetDateLabel}\n` +
            `💺 ${bestSeat.seatNo}번 좌석\n` +
            `⏰ ${info.departureTimeText ?? "07:00"} 출발 → ${info.arrivalTimeText ?? "07:47"} 도착\n` +
            `📍 ${info.expectedOnStationName ?? ""} → ${info.expectedOffStationName ?? ""}\n` +
            `🕐 실행 시간: ${executedAt}`;
          console.log(msg.replace(/<[^>]+>/g, ""));
          await sendTelegram(msg);
        } else {
          console.error(`  예약 실패: ${bookResult.resultMessage}`);
          if (attempt < 5) {
            await sleep(10000);
          }
        }
      } catch (err) {
        console.error(`  오류 (시도 ${attempt}):`, err.message);
        if (attempt < 5) {
          await sleep(10000);
        }
      }
    }

    if (!booked) {
      const msg =
        `❌ <b>자동 예약 실패</b>\n` +
        `🚌 ${target.name}\n` +
        `📅 ${targetDateLabel}\n` +
        `🕐 실행 시간: ${executedAt}\n` +
        `💡 5분마다 빈 자리 모니터링을 시작합니다.`;
      console.log(msg.replace(/<[^>]+>/g, ""));
      await sendTelegram(msg);
    }
  }

  console.log("자동 예약 완료");
}

// ──────────────── 진입점 ────────────────

async function main() {
  if (!process.env.BEARER_TOKEN && !process.env.MIRI_REFRESH_TOKEN) {
    console.error(
      "오류: BEARER_TOKEN 또는 MIRI_REFRESH_TOKEN 환경변수가 필요합니다.",
    );
    process.exit(1);
  }

  // 시작 시 토큰 자동 갱신
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

  if (MODE === "auto_book") {
    await runAutoBook();
  } else {
    await runMonitor();
  }
}

main().catch((err) => {
  console.error("치명적 오류:", err);
  process.exit(1);
});
