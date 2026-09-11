# cron 스크립트에서 source한다. cron에는 nvm이 없는데, 특정 버전 경로를 crontab에 박아 두면
# 그 버전을 지우는 순간 모든 작업이 조용히 멈춘다(node가 없으니 텔레그램 알림도 못 보낸다).
# 그래서 nvm의 기본(default) 버전을 불러온다.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # nvm.sh는 set -u에서 미정의 변수로 실패하므로 불러오는 동안만 끈다.
  set +u
  . "$NVM_DIR/nvm.sh" --no-use
  nvm use --silent default >/dev/null
  set -u
fi
