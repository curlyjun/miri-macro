"use strict";

const config = require("./config.json");
const {
  WEEKDAY_MAP,
  getBaseUrl,
  getHeaders,
  sleep,
  nowKST,
  sendTelegram,
  getBookableDates,
  getBookableSeats,
  bookSeat,
  selectBestSeat,
  initCommon,
} = require("./lib/common");

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

        const allDates = json.data.flatMap((d) => d.bookableDates);
        const dateInfo = allDates.find((d) => d.date === targetDate);
        if (!dateInfo) {
          console.log(
            `  ${targetDate} 날짜 정보 없음 (아직 오픈 전일 수 있음)`,
          );
          if (attempt < 5) await sleep(10000);
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
          if (attempt < 5) await sleep(10000);
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
          if (attempt < 5) await sleep(10000);
        }
      } catch (err) {
        console.error(`  오류 (시도 ${attempt}):`, err.message);
        if (attempt < 5) await sleep(10000);
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

async function main() {
  await initCommon();
  await runAutoBook();
}

main().catch((err) => {
  console.error("치명적 오류:", err);
  process.exit(1);
});
