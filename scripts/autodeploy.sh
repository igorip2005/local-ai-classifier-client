#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="${LOCAL_AI_CLIENT_PROJECT_DIR:-/www/projects/local-ai-classifier-client}"
SERVICE_NAME="${LOCAL_AI_CLIENT_SERVICE_NAME:-local-ai-classifier.service}"
BRANCH="${LOCAL_AI_CLIENT_DEPLOY_BRANCH:-main}"
LOG_DIR="${LOCAL_AI_CLIENT_DEPLOY_LOG_DIR:-$PROJECT_DIR/var/deploy}"
LOCK_FILE="${LOCAL_AI_CLIENT_DEPLOY_LOCK_FILE:-$PROJECT_DIR/var/autodeploy.lock}"
RUN_TESTS="${LOCAL_AI_CLIENT_DEPLOY_RUN_TESTS:-false}"
ENV_FILE="${LOCAL_AI_CLIENT_ENV_FILE:-$PROJECT_DIR/.env}"

runtime_version() {
  local base_version
  local commit_count
  base_version="$(node -p "require('./package.json').version")"
  if [[ "$base_version" == *.*.*.* ]]; then
    printf '%s\n' "$base_version"
    return
  fi
  commit_count="$(git rev-list --count HEAD)"
  printf '%s.%s\n' "$base_version" "$commit_count"
}

set_env_value() {
  local key="$1"
  local value="$2"
  local file="$3"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$file"
  fi
}

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
before_runtime_version="$(runtime_version)"
before_commit="$(git rev-parse --short HEAD)"
echo "before_version=$before_version"
echo "before_runtime_version=$before_runtime_version"
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
after_runtime_version="$(runtime_version)"
echo "after_version=$after_version"
echo "after_runtime_version=$after_runtime_version"
echo "after_commit=$after_commit"

if [[ -f "$ENV_FILE" ]]; then
  set_env_value "CLIENT_ALLOW_MODEL_PULL" "true" "$ENV_FILE"
  set_env_value "CLIENT_BUILD_ID" "$after_commit" "$ENV_FILE"
  echo "updated CLIENT_ALLOW_MODEL_PULL=true in $ENV_FILE"
  echo "updated CLIENT_BUILD_ID=$after_commit in $ENV_FILE"
else
  echo "env file $ENV_FILE not found; client env settings not changed"
fi

if [[ -n "${LOCAL_AI_DEPLOY_TARGET_VERSION:-}" && "${LOCAL_AI_DEPLOY_TARGET_VERSION:-}" != "git-latest" && "$after_runtime_version" != "$LOCAL_AI_DEPLOY_TARGET_VERSION" ]]; then
  echo "target version mismatch: expected $LOCAL_AI_DEPLOY_TARGET_VERSION, got $after_runtime_version"
  exit 3
fi

if [[ ! -d node_modules ]] || git diff --name-only "$before_commit" "$after_commit" -- package.json package-lock.json | grep -q .; then
  npm ci --include=dev
else
  echo "package files unchanged and node_modules exists; skipping npm ci"
fi
npm run build
if [[ "$RUN_TESTS" != "false" ]]; then
  NODE_ENV=test npm test
else
  echo "remote autodeploy tests skipped; CI/local pre-deploy tests must cover this revision"
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
