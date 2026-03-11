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

## 4단계: GitHub Secrets에 등록

GitHub Actions에서 사용할 수 있도록 Secrets에 등록:

1. GitHub 저장소 → **Settings** → **Secrets and variables** → **Actions**
2. **New repository secret** 클릭 후 아래 3개 등록:

| Name | Value |
|------|-------|
| `BEARER_TOKEN` | Proxyman에서 복사한 MiRi JWT 토큰 |
| `TELEGRAM_BOT_TOKEN` | BotFather에서 받은 봇 토큰 |
| `TELEGRAM_CHAT_ID` | 내 텔레그램 채팅 ID |

---

## MiRi 토큰 갱신 방법

Bearer 토큰은 약 **12~13일마다 만료**됩니다.
만료 시 스크립트가 자동으로 텔레그램 알림을 보냅니다.

**갱신 절차:**
1. 아이폰에서 Proxyman 프록시가 설정된 상태로 MiRi 앱 실행
2. 좌석 조회 화면으로 이동 (트래픽 발생시키기)
3. Mac의 Proxyman에서 `commute-miri-api.e-bus.co.kr` 요청 클릭
4. Request 탭 → `Authorization` 헤더 값에서 `Bearer ` 뒤의 문자열 전체 복사
5. GitHub Secrets → `BEARER_TOKEN` 값 업데이트

---

## 테스트

로컬에서 먼저 테스트해보기:

```bash
# 의존성 설치
npm install

# .env 파일 만들기
cp .env.example .env
# .env 파일을 열어 토큰 값 입력

# 모니터링 테스트 (잔여 좌석 확인)
node index.js

# 자동 예약 테스트 (7일 후 날짜 예약 시도)
MODE=auto_book node index.js
```

텔레그램 알림이 수신되면 설정 완료!
