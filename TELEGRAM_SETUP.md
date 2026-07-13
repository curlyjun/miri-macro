# 텔레그램 알림 설정 가이드

## 1단계: 텔레그램 봇 만들기

1. 텔레그램 앱에서 **@BotFather** 검색 후 대화 시작
2. `/newbot` 명령 전송
3. 봇 이름 입력 (예: `MiRi 매크로 알림`)
4. 봇 사용자명 입력 (예: `miri_macro_bot`) — 영문 + 숫자, 끝에 `bot` 필수
5. 완료 메시지에서 **HTTP API 토큰**을 복사
   ```
   예: 7123456789:AAFxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
   → 이게 `TELEGRAM_BOT_TOKEN`

---

## 2단계: 채팅 ID 확인

1. 방금 만든 봇과 대화를 시작 (검색 후 `/start` 전송)
2. 아래 URL을 브라우저에서 열기 (토큰 교체 필요):
   ```
   https://api.telegram.org/bot여기에_봇_토큰/getUpdates
   ```
3. 응답 JSON에서 `"id"` 값을 찾기:
   ```json
   "chat": { "id": 123456789, ... }
   ```
   → 이게 `TELEGRAM_CHAT_ID`

---

## 3단계: 로컬 `.env` 파일에 추가

`.env.example`을 복사해서 `.env`를 만들고 값을 입력:

```bash
cp .env.example .env
```

```
BEARER_TOKEN=Proxyman에서_복사한_MiRi_JWT_토큰
TELEGRAM_BOT_TOKEN=7123456789:AAFxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TELEGRAM_CHAT_ID=123456789
```

---

## 4단계: Oracle Cloud 환경변수 등록

현재 매크로는 GitHub Actions가 아니라 Oracle Cloud의 crontab에서 실행됩니다. Oracle 서버의 프로젝트 `.env`에 아래 값을 등록합니다.

```dotenv
BEARER_TOKEN=Proxyman에서_복사한_MiRi_JWT_토큰
MIRI_MEMBER_UID=MiRi_memberUid
MIRI_REFRESH_TOKEN=MiRi_refreshToken
TELEGRAM_BOT_TOKEN=BotFather에서_받은_토큰
TELEGRAM_CHAT_ID=내_채팅_ID
API_TIMEOUT_MS=15000
ERROR_NOTIFY_COOLDOWN_HOURS=6
HEALTH_REPORT_HOUR=9
```

---

## MiRi 토큰 갱신 방법

Bearer 토큰은 약 **12~13일마다 만료**됩니다.
만료 시 스크립트가 자동으로 텔레그램 알림을 보냅니다.

**갱신 절차:**
1. 아이폰에서 Proxyman 프록시가 설정된 상태로 MiRi 앱 실행
2. 좌석 조회 화면으로 이동 (트래픽 발생시키기)
3. Mac의 Proxyman에서 `commute-miri-api.e-bus.co.kr` 요청 클릭
4. Request 탭 → `Authorization` 헤더 값에서 `Bearer ` 뒤의 문자열 전체 복사
5. Oracle 서버의 `.env`에서 `BEARER_TOKEN`과 `MIRI_REFRESH_TOKEN` 업데이트

---

## 테스트

로컬에서 먼저 테스트해보기:

```bash
# 의존성 설치
npm install

# .env 파일 만들기
cp .env.example .env
# .env 파일을 열어 토큰 값 입력

# 실제 예약 없이 날짜와 좌석만 확인
npm run observe

# 자동 예약 테스트 (7일 후 날짜 예약 시도)
npm run autobook

# 지정 날짜 빈자리 확인 및 실제 예약
npm run monitor
```

텔레그램 알림이 수신되면 설정 완료!

---

## Oracle Cloud crontab

`scripts/run-oracle.sh`는 실행 전에 GitHub 원격 `main` 브랜치의 `config.json`만 가져와 검증하고 원자적으로 적용합니다. 동기화나 검증에 실패하면 이전 설정으로 예약하지 않고 실행을 중단합니다.

```bash
chmod +x scripts/run-oracle.sh
crontab -e
```

프로젝트 경로를 실제 Oracle 경로로 바꿔 등록합니다.

```cron
# 매일 10:00 KST, 7일 후 자동예약
0 10 * * * cd /home/opc/miri-macro && ./scripts/run-oracle.sh autobook >> runtime/cron.log 2>&1

# 5분마다 지정 날짜 빈자리 확인 및 예약
*/5 * * * * cd /home/opc/miri-macro && ./scripts/run-oracle.sh monitor >> runtime/cron.log 2>&1
```

관찰 전용으로 운영하려면 두 번째 줄의 `monitor`를 `observe`로 바꿉니다. `observe`는 예약 가능한 좌석을 선택해 알려주지만 예약 API를 호출하지 않습니다.

## 알림 정책

- 새로운 실행 장애는 즉시 알립니다.
- 같은 장애는 기본 6시간 동안 반복 알림을 보내지 않습니다.
- 장애가 6시간 이상 계속되면 누적 횟수와 함께 다시 알립니다.
- 정상화되면 복구 알림을 한 번 보냅니다.
- 매일 오전 9시 이후 첫 정상 모니터 실행에서 적용 설정 커밋과 확인 대상을 요약합니다.
- 런타임 상태와 잠금은 `runtime/`에 저장되며 Git에는 커밋되지 않습니다.
