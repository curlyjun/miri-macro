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

## 4단계: 운영 환경변수 확인

매크로는 로컬 Mac의 crontab에서 실행됩니다. 프로젝트 `.env`에 아래 값이 모두 들어 있어야 합니다.

```dotenv
BEARER_TOKEN=Proxyman에서_복사한_MiRi_JWT_토큰
MIRI_MEMBER_UID=MiRi_memberUid
MIRI_REFRESH_TOKEN=MiRi_refreshToken
TELEGRAM_BOT_TOKEN=BotFather에서_받은_토큰
TELEGRAM_CHAT_ID=내_채팅_ID
API_TIMEOUT_MS=15000
ERROR_NOTIFY_COOLDOWN_HOURS=6
HEALTH_REPORT_HOUR=9
TELEGRAM_RETRIES=3
```

---

## MiRi 토큰 갱신 방법

액세스 토큰은 약 하루짜리지만 매 실행마다 refresh로 새로 받습니다. MiRi는 refresh할 때
새 refresh 토큰도 함께 내려주는데, 매크로가 이를 `runtime/auth.json`에 저장해 다음 실행에서
이어 쓰므로 monitor가 주기적으로 돌고 있으면 수동 갱신이 필요 없습니다. 오래 멈춰 있다가
refresh 토큰까지 만료되면 스크립트가 텔레그램으로 알립니다.

**갱신 절차 (브라우저):**
1. PC 크롬에서 https://commute.e-bus.co.kr/MIRI/login 로그인 (자동 로그인 체크)
2. `F12` → Console에 아래를 붙여넣기 (막히면 먼저 `allow pasting` 입력)
   ```js
   const g = k => localStorage.getItem(k) || sessionStorage.getItem(k);
   copy(`BEARER_TOKEN="${g("MIRI_ACCESS_TOKEN")}"\nMIRI_REFRESH_TOKEN=${g("MIRI_REFRESH_TOKEN")}`);
   ```
3. 클립보드의 두 줄로 `.env`의 `BEARER_TOKEN`, `MIRI_REFRESH_TOKEN`을 교체
   (`BEARER_TOKEN`에는 `|`가 들어 있으므로 따옴표로 감쌉니다)

`.env`의 `MIRI_REFRESH_TOKEN`이 바뀌면 `runtime/auth.json`의 저장 토큰은 버리고 새 값을 씁니다.
`MIRI_MEMBER_UID`는 바뀌지 않습니다(액세스 토큰 JWT의 `sub` 값).

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

## 로컬 Mac crontab

`scripts/run.sh`는 허용된 작업(`monitor`, `autobook`, `observe`, `update-lines`)만 받아 실행합니다. 예약 설정은 아래 [설정 페이지](#설정-페이지)에서 바꿉니다.

```bash
chmod +x scripts/run.sh
crontab -e
```

cron은 로그인 셸의 PATH를 쓰지 않으므로 nvm의 node 경로를 직접 적습니다. 프로젝트가 `~/Documents` 아래에 있으면 macOS가 막으므로 시스템 설정 → 개인정보 보호 및 보안 → 전체 디스크 접근 권한에 `/usr/sbin/cron`을 추가합니다. 맥이 잠든 동안의 작업은 건너뛰므로 잠자기를 막아 둡니다(Amphetamine 등). 시간은 Mac의 시간대인 KST 기준입니다.

```cron
PATH=/Users/seongjunpark/.nvm/versions/node/v22.21.1/bin:/usr/bin:/bin
M=/Users/seongjunpark/Documents/projects/miri-macro

# 매일 10:00 KST, 7일 후 자동예약
0 10 * * * $M/scripts/run.sh autobook >> $M/runtime/auto_book.log 2>&1

# 5분마다 지정 날짜 빈자리 확인 및 예약
*/5 * * * * $M/scripts/run.sh monitor >> $M/runtime/monitor.log 2>&1

# 매주 월요일 11:00 KST 노선 업데이트
0 11 * * 1 $M/scripts/run.sh update-lines >> $M/runtime/update_lines.log 2>&1

# 설정 페이지 서버. 꺼져 있으면 5분 안에 다시 켜지고, 떠 있으면 새 프로세스는 바로 끝난다.
*/5 * * * * node $M/server.js >> $M/runtime/settings.log 2>&1
```

관찰 전용으로 운영하려면 두 번째 줄의 `monitor`를 `observe`로 바꿉니다. `observe`는 예약 가능한 좌석을 선택해 알려주지만 예약 API를 호출하지 않습니다.

## 설정 페이지

`server.js`가 `docs/index.html` 설정 페이지를 띄우고 `runtime/config.json`을 직접 읽고 씁니다. PAT가 필요 없고, 저장하면 다음 cron 실행부터 반영됩니다. 매크로는 `runtime/config.json`이 있으면 그것을, 없으면 저장소의 `config.json`을 읽습니다. 저장소 파일에 쓰지 않는 이유는 작업 트리가 dirty해져 `git pull`이 막히기 때문입니다.

서버는 `127.0.0.1:8787`에만 열리므로 같은 Wi-Fi의 다른 기기는 접근할 수 없습니다. 모바일에서는 Tailscale로 접근합니다. 아래 명령은 처음 한 번만 실행하면 재부팅 뒤에도 유지됩니다.

```bash
tailscale serve --bg 8787
```

`tailscale serve status`에 나오는 `https://<기기이름>.<tailnet>.ts.net` 주소로 접속합니다. 폰과 PC에서 동시에 고치다가 한쪽이 먼저 저장하면, 나중에 저장하는 쪽은 덮어쓰지 않고 다시 불러오라는 안내를 받습니다.

## 알림 정책

- 새로운 실행 장애는 즉시 알립니다.
- 같은 장애는 기본 6시간 동안 반복 알림을 보내지 않습니다.
- 장애가 6시간 이상 계속되면 누적 횟수와 함께 다시 알립니다.
- 정상화되면 복구 알림을 한 번 보냅니다.
- 매일 오전 9시 이후 첫 정상 모니터 실행에서 적용 설정의 마지막 저장 시각과 확인 대상을 요약합니다.
- 런타임 상태와 잠금, 설정 페이지 저장본은 `runtime/`에 저장되며 Git에는 커밋되지 않습니다.

## 전송 실패 대비

자동예약은 하루 한 번만 실행되므로, 그 순간 텔레그램 전송이 실패하면 예약은 성공해도
알림만 유실됩니다. 이를 막기 위해 세 가지가 걸려 있습니다.

- **IPv4 우선**: `api.telegram.org`는 AAAA 레코드를 가집니다. IPv6 주소만 있고 실제
  경로가 없는 서버에서는 MiRi API와 GitHub은 멀쩡한데 텔레그램만 `fetch failed`로
  타임아웃됩니다. `dns.setDefaultResultOrder("ipv4first")`로 고정합니다. Node 20+는
  IPv4 연결이 250ms를 넘기면 IPv6로 넘어가므로 `net.setDefaultAutoSelectFamily(false)`도 둡니다.
- **재시도**: 일시적 네트워크 오류와 5xx는 `TELEGRAM_RETRIES`(기본 3회)만큼 백오프
  재시도합니다. 4xx는 다시 보내도 같으므로 재시도하지 않습니다.
- **미전송 큐**: 그래도 실패하면 메시지를 `runtime/outbox.jsonl`에 보관하고, 5분마다
  도는 monitor가 실행 끝에 재전송합니다. 24시간이 지난 메시지와 텔레그램이 거부한
  메시지(잘못된 HTML 등)는 큐를 막지 않도록 버립니다.

큐가 쌓여 있는지는 아래로 확인합니다.

```bash
wc -l runtime/outbox.jsonl
```
