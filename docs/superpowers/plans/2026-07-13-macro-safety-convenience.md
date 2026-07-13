# MiRi 매크로 안전성 및 편의성 개선 구현 계획

> **에이전트 작업자 필수 하위 스킬:** 이 계획을 작업별로 실행할 때 `superpowers:subagent-driven-development` 또는 `superpowers:executing-plans`를 사용한다. 모든 단계는 체크박스로 추적한다.

**목표:** 자동예약과 빈자리 예약을 하나의 안전한 실행 흐름으로 통합하고, 반복되지 않는 장애 알림과 설정·운영 편의 기능을 제공한다.

**아키텍처:** 설정 검증, 예약 엔진, 런타임 상태, API 요청을 독립 모듈로 분리한다. 실행 파일은 이 모듈을 조합하는 얇은 진입점으로 만들고 GitHub Pages UI와 Oracle 래퍼가 동일한 설정 의미를 사용하게 한다.

**기술 스택:** Node.js 18 이상, CommonJS, 내장 `node:test`, 단일 HTML/CSS/JavaScript 설정 UI, Bash Oracle 실행 래퍼.

## 전체 제약

- 실제 MiRi API를 테스트에서 호출하지 않는다.
- 기존 설정 파일은 호환 변환하되 `weekdays: []`인 대상은 안전하게 자동예약 비활성화로 해석한다.
- 기존 좌석 폴백 기본값은 `any`로 유지한다.
- 같은 장애 알림은 6시간 동안 억제하고 복구 알림은 1회만 보낸다.
- 구현 계획과 운영 문서는 한글로 작성한다.

---

### 작업 1: 설정 모델과 좌석 정책

**파일:**
- 생성: `lib/config.js`
- 수정: `lib/common.js`
- 테스트: `test/config.test.js`, `test/seat_selection.test.js`

**인터페이스:**
- `normalizeConfig(config)`은 호환 변환된 새 설정 객체를 반환한다.
- `validateTarget(target)`은 `{ valid, errors }`를 반환한다.
- `selectBestSeat(seatsData, preference)`는 `fallbackMode`를 반영한다.

- [ ] 빈 요일 호환 변환, 필수 UID 검증, `preferredOnly` 좌석 정책을 검증하는 실패 테스트를 작성한다.
- [ ] `node --test test/config.test.js test/seat_selection.test.js`를 실행해 새 모듈 부재와 정책 불일치로 실패하는지 확인한다.
- [ ] 설정 정규화·검증 모듈을 구현하고 `selectBestSeat`에 폴백 정책을 적용한다.
- [ ] 대상 테스트와 전체 `node --test`를 실행해 통과시킨다.

### 작업 2: 공통 API 계층과 예약 엔진

**파일:**
- 생성: `lib/api-client.js`, `lib/booking.js`
- 수정: `lib/common.js`, `lib/monitor_booking.js`
- 테스트: `test/api_client.test.js`, `test/booking.test.js`

**인터페이스:**
- `requestJson(url, options)`은 15초 제한 시간, 네트워크·5xx 최대 2회 재시도, 401 갱신 후 1회 재요청을 제공한다.
- `attemptBooking({ target, dateInfo, dryRun, deps })`는 `BOOKED`, `DRY_RUN`, `NO_ALLOC`, `NO_SEAT`, `API_ERROR` 결과를 반환한다.

- [ ] 타임아웃, 5xx 재시도, 401 재인증, dry-run 예약 차단을 검증하는 실패 테스트를 작성한다.
- [ ] 새 테스트를 실행해 API 클라이언트와 예약 엔진 부재로 실패하는지 확인한다.
- [ ] API 클라이언트와 공통 예약 엔진을 구현하고 기존 모니터 예약 모듈을 호환 래퍼로 전환한다.
- [ ] 새 테스트와 전체 테스트를 실행해 통과시킨다.

### 작업 3: 장애 상태, 중복 실행 방지와 실행 모드

**파일:**
- 생성: `lib/runtime-state.js`, `lib/telegram.js`, `observe.js`
- 수정: `auto_book.js`, `monitor.js`, `update_lines.js`, `.gitignore`, `package.json`
- 테스트: `test/runtime_state.test.js`, `test/monitor.test.js`

**인터페이스:**
- `RuntimeState`는 장애 최초·6시간 지속·복구·일일 상태 이벤트를 계산해 상태 파일에 저장한다.
- `withProcessLock(name, task)`는 살아 있는 중복 작업을 건너뛴다.
- `runMonitor({ dryRun })`은 월별 날짜 배열을 모두 처리하고 구조화된 실행 결과를 반환한다.

- [ ] 장애 억제, 복구, 일일 상태 1회, 잠금, 월 경계 모니터링을 검증하는 실패 테스트를 작성한다.
- [ ] 새 테스트를 실행해 필요한 인터페이스 부재로 실패하는지 확인한다.
- [ ] 런타임 상태와 텔레그램 메시지 이스케이프를 구현하고 실행 파일을 공통 엔진으로 전환한다.
- [ ] `observe.js`와 실제 파일을 가리키는 npm 명령을 추가한다.
- [ ] 새 테스트, 전체 테스트와 `npm start` 구문 실행을 검증한다.

### 작업 4: 설정 UI 안전성과 편의 기능

**파일:**
- 수정: `docs/index.html`
- 테스트: `test/settings_page_design.test.js`, `test/settings_page_behavior.test.js`

**인터페이스:**
- 대상별 `autoBookEnabled`, `monitorEnabled`, `fallbackMode`를 수집한다.
- `validateConfigForSave()`는 잘못된 대상을 반환하고 저장을 차단한다.
- `buildPreview(target, today)`는 다음 자동예약 날짜 3개, 모니터 날짜와 좌석 정책을 반환한다.

- [ ] 토글, 저장 검증, 날짜 미리보기, 과거 날짜 정리, 이탈 경고, 409 재불러오기 UI 계약의 실패 테스트를 작성한다.
- [ ] UI 테스트를 실행해 새 동작 부재로 실패하는지 확인한다.
- [ ] 기존 디자인 체계를 유지하며 컨트롤과 검증·미리보기·정리 동작을 구현한다.
- [ ] GitHub 409 응답에서 재불러오기 버튼을 제공하고 성공 저장 후 dirty 상태를 초기화한다.
- [ ] UI 테스트와 전체 테스트를 실행해 통과시킨다.

### 작업 5: Oracle 설정 동기화와 운영 문서

**파일:**
- 생성: `scripts/run-oracle.sh`
- 수정: `TELEGRAM_SETUP.md`, `.env.example`
- 테스트: `test/oracle_runner.test.js`

**인터페이스:**
- `scripts/run-oracle.sh <monitor|autobook|observe|update-lines>`는 원격 `main`의 `config.json`을 검증 후 원자적으로 적용하고 선택한 npm 명령을 실행한다.
- `HEALTH_REPORT_HOUR`, `ERROR_NOTIFY_COOLDOWN_HOURS`, `API_TIMEOUT_MS` 환경변수를 문서화한다.

- [ ] 허용 작업 검증, 동기화 실패 시 실행 중단, 원자적 설정 교체를 확인하는 실패 테스트를 작성한다.
- [ ] Oracle 래퍼를 구현하고 실행 권한을 부여한다.
- [ ] 현재 분리된 실행 파일과 crontab 예시, 상태 파일, 알림 정책을 한글 운영 문서에 반영한다.
- [ ] 전체 `node --test`, `git diff --check`, 셸 구문 검사를 실행한다.
- [ ] 변경 내용을 책임별 커밋으로 나누어 기록한다.
