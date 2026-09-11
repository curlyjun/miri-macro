#!/usr/bin/env bash
# runtime/*.log가 한도를 넘으면 마지막 줄들만 남긴다. cron이 하루 한 번 실행한다.
# cron 작업이 >>로 붙여 쓰는 중이어도 끊기지 않도록 새 파일로 바꾸지 않고 같은 파일을 제자리에서 다시 쓴다.
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/runtime}"
MAX_BYTES="${MAX_LOG_BYTES:-1048576}"
KEEP_LINES="${KEEP_LOG_LINES:-5000}"

for log in "$LOG_DIR"/*.log; do
  [ -f "$log" ] || continue
  size=$(wc -c < "$log" | tr -d ' ')
  [ "$size" -gt "$MAX_BYTES" ] || continue
  tail -n "$KEEP_LINES" "$log" > "$log.tmp" && cat "$log.tmp" > "$log"
  rm -f "$log.tmp"
  echo "[로그] $(date '+%Y-%m-%d %H:%M') $(basename "$log") ${size}B → $(wc -c < "$log" | tr -d ' ')B"
done
