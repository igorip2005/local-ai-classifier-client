#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="${LOCAL_AI_CLIENT_PROJECT_DIR:-/www/projects/local-ai-classifier-client}"
SERVICE_NAME="${LOCAL_AI_CLIENT_SERVICE_NAME:-local-ai-classifier.service}"
BRANCH="${LOCAL_AI_CLIENT_DEPLOY_BRANCH:-main}"
LOG_DIR="${LOCAL_AI_CLIENT_DEPLOY_LOG_DIR:-$PROJECT_DIR/var/deploy}"
LOCK_FILE="${LOCAL_AI_CLIENT_DEPLOY_LOCK_FILE:-$PROJECT_DIR/var/autodeploy.lock}"
RUN_TESTS="${LOCAL_AI_CLIENT_DEPLOY_RUN_TESTS:-true}"

mkdir -p "$LOG_DIR" "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "autodeploy already running"
  exit 75
fi

run_id="${LOCAL_AI_DEPLOY_ID:-manual-$(date -u +%Y%m%dT%H%M%SZ)}"
log_file="$LOG_DIR/$run_id.log"
exec > >(tee -a "$log_file") 2>&1

echo "== local-ai-classifier-client autodeploy =="
echo "run_id=$run_id"
echo "project_dir=$PROJECT_DIR"
echo "branch=$BRANCH"
echo "started_at=$(date -Is)"

cd "$PROJECT_DIR"

before_version="$(node -p "require('./package.json').version")"
before_commit="$(git rev-parse --short HEAD)"
echo "before_version=$before_version"
echo "before_commit=$before_commit"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "tracked working tree has local changes; refusing autodeploy"
  git status --short
  exit 2
fi

git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

after_commit="$(git rev-parse --short HEAD)"
after_version="$(node -p "require('./package.json').version")"
echo "after_version=$after_version"
echo "after_commit=$after_commit"

npm ci --include=dev
npm run build
if [[ "$RUN_TESTS" != "false" ]]; then
  npm test
fi

echo "autodeploy checks passed"
echo "finished_at=$(date -Is)"
echo "log_file=$log_file"

if command -v systemctl >/dev/null 2>&1 && systemctl --user list-unit-files "$SERVICE_NAME" >/dev/null 2>&1; then
  echo "scheduling user service restart: $SERVICE_NAME"
  nohup bash -lc "sleep 2; systemctl --user restart '$SERVICE_NAME'" >/dev/null 2>&1 &
else
  echo "systemd user service $SERVICE_NAME not found; restart skipped"
fi
