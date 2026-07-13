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

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"
mkdir -p runtime

TEMP_CONFIG="$(mktemp "${TMPDIR:-/tmp}/miri-config.XXXXXX")"
trap 'rm -f "$TEMP_CONFIG"' EXIT

git fetch origin main
git show origin/main:config.json > "$TEMP_CONFIG"

node -e '
  const fs = require("fs");
  const { normalizeConfig, validateConfig } = require("./lib/config");
  const file = process.argv[1];
  const config = normalizeConfig(JSON.parse(fs.readFileSync(file, "utf8")));
  const validation = validateConfig(config);
  if (!validation.valid) {
    const details = validation.targets
      .filter((item) => !item.valid)
      .map((item) => `대상 ${item.index + 1}: ${item.errors.join(" ")}`)
      .join("\n");
    throw new Error(`원격 config.json 검증 실패\n${details}`);
  }
' "$TEMP_CONFIG"

mv "$TEMP_CONFIG" config.json
git rev-parse origin/main > runtime/applied-config-commit

npm run "$TASK"
