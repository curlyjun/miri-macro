#!/usr/bin/env bash
set -euo pipefail

TASK="${1:-}"
case "$TASK" in
  monitor|autobook|observe|update-lines) ;;
  *)
    echo "사용법: $0 <monitor|autobook|observe|update-lines>" >&2
    exit 2
    ;;
esac

# 예약 설정은 설정 페이지(server.js)가 runtime/config.json에 직접 저장하므로
# 여기서는 따로 받아오지 않고 바로 실행한다.
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"
mkdir -p runtime
. "$ROOT_DIR/scripts/use-node.sh"

npm run "$TASK"
