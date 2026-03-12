"use strict";

const config = require("./config.json");
const {
  nowKST,
  matchesWeekday,
  sendTelegram,
  getBookableDates,
  initCommon,
} = require("./lib/common");

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

async function main() {
  await initCommon();
  await runMonitor();
}

main().catch((err) => {
  console.error("치명적 오류:", err);
  process.exit(1);
});
