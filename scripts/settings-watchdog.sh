#!/usr/bin/env bash
# 설정 서버 감시. cron이 5분마다 실행한다.
# 서버는 node --watch로 띄워 server.js나 lib/를 고치면 스스로 재시작한다. 다만 --watch는
# 서버가 죽으면 다음 파일 변경까지 기다리기만 하므로, 실제로 응답하는지 확인해 안 되면 새로 띄운다.
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${SETTINGS_HOST:-127.0.0.1}"
PORT="${SETTINGS_PORT:-8790}"
. "${ROOT_DIR}/scripts/use-node.sh"

if curl -s -m 5 -o /dev/null -D - "http://${HOST}:${PORT}/" | grep -qi '^x-miri-settings: 1'; then
  exit 0
fi

# 응답 없이 남아 있는 --watch 부모와 자식 프로세스를 정리한다.
pkill -f "${ROOT_DIR}/server.js" 2>/dev/null
sleep 1

echo "[감시] $(date '+%Y-%m-%d %H:%M:%S') 설정 서버 응답 없음 → 새로 시작"
mkdir -p "${ROOT_DIR}/runtime"
SETTINGS_HOST="$HOST" SETTINGS_PORT="$PORT" \
  nohup node --watch "${ROOT_DIR}/server.js" >> "${ROOT_DIR}/runtime/settings.log" 2>&1 &
