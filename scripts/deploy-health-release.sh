#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-/opt/ai-life}"
SOURCE_ROOT="${SOURCE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKUP_ROOT="${BACKUP_ROOT:-/home/ubuntu/ai-life-backups}"
RELEASE_ID="${RELEASE_ID:-health-$(date +%Y%m%d-%H%M%S)}"
BACKUP_DIR="$BACKUP_ROOT/$RELEASE_ID"

FILES=(
  server.js
  health.html
  health-client.js
  legal.css
  privacy.html
  terms.html
  public/health-sw.js
  db/migrations/014_huawei_health.sql
  src/health/summary.js
  src/repositories/healthRepository.js
  src/repositories/huaweiHealthRepository.js
  src/routes/healthRoutes.js
  src/routes/huaweiHealthRoutes.js
  src/integrations/huawei-health/client.js
  src/integrations/huawei-health/config.js
  src/integrations/huawei-health/crypto.js
  src/integrations/huawei-health/errors.js
  src/integrations/huawei-health/normalizer.js
  src/integrations/huawei-health/oauth.js
  src/integrations/huawei-health/scheduler.js
  src/integrations/huawei-health/service.js
  src/integrations/huawei-health/sync-service.js
)

mkdir -p "$BACKUP_DIR/previous" "$BACKUP_DIR/meta" "$BACKUP_DIR/failed"

node --check "$SOURCE_ROOT/server.js"
node --check "$SOURCE_ROOT/health-client.js"

for file in "${FILES[@]}"; do
  test -f "$SOURCE_ROOT/$file"
  mkdir -p \
    "$BACKUP_DIR/previous/$(dirname "$file")" \
    "$BACKUP_DIR/meta/$(dirname "$file")"

  if test -e "$APP_ROOT/$file"; then
    cp -a "$APP_ROOT/$file" "$BACKUP_DIR/previous/$file"
    stat -c '%u %g %a' "$APP_ROOT/$file" > "$BACKUP_DIR/meta/$file.stat"
    printf '%s\n' existing > "$BACKUP_DIR/meta/$file.kind"
  else
    stat -c '%u %g %a' "$APP_ROOT/server.js" > "$BACKUP_DIR/meta/$file.stat"
    printf '%s\n' new > "$BACKUP_DIR/meta/$file.kind"
  fi
done

rollback() {
  local file
  for file in "${FILES[@]}"; do
    if test "$(<"$BACKUP_DIR/meta/$file.kind")" = existing; then
      mkdir -p "$APP_ROOT/$(dirname "$file")"
      cp -af "$BACKUP_DIR/previous/$file" "$APP_ROOT/$file"
    elif test -e "$APP_ROOT/$file"; then
      mkdir -p "$BACKUP_DIR/failed/$(dirname "$file")"
      mv -f "$APP_ROOT/$file" "$BACKUP_DIR/failed/$file"
    fi
  done
  sudo -iu ubuntu pm2 restart ai-life --update-env >/dev/null 2>&1 || true
}

on_exit() {
  local exit_code=$?
  if (( exit_code != 0 )); then
    rollback
    printf 'DEPLOY_FAILED backup=%s\n' "$BACKUP_DIR" >&2
  fi
  exit "$exit_code"
}
trap on_exit EXIT

for file in "${FILES[@]}"; do
  read -r uid gid mode < "$BACKUP_DIR/meta/$file.stat"
  install -D -o "$uid" -g "$gid" -m "$mode" \
    "$SOURCE_ROOT/$file" "$APP_ROOT/$file.new"
done

for file in "${FILES[@]}"; do
  mv -f "$APP_ROOT/$file.new" "$APP_ROOT/$file"
done

cd "$APP_ROOT"
npm run db:migrate
sudo -iu ubuntu pm2 restart ai-life --update-env >/dev/null

expected_size=$(wc -c < "$SOURCE_ROOT/health-client.js")
expected_sha=$(sha256sum "$SOURCE_ROOT/health-client.js" | awk '{print $1}')

for attempt in {1..10}; do
  if curl -fsS http://127.0.0.1:5173/health-client.js -o "$BACKUP_DIR/client.local"; then
    break
  fi
  sleep 1
done

test "$(wc -c < "$BACKUP_DIR/client.local")" -eq "$expected_size"
printf '%s  %s\n' "$expected_sha" "$BACKUP_DIR/client.local" | sha256sum -c -

cache_bust=$(date +%s)
curl -fsS "https://ai-life.top/health-client.js?v=$cache_bust" -o "$BACKUP_DIR/client.public"
test "$(wc -c < "$BACKUP_DIR/client.public")" -eq "$expected_size"
printf '%s  %s\n' "$expected_sha" "$BACKUP_DIR/client.public" | sha256sum -c -

privacy_sha=$(sha256sum "$SOURCE_ROOT/privacy.html" | awk '{print $1}')
curl -fsS "https://ai-life.top/privacy.html?v=$cache_bust" -o "$BACKUP_DIR/privacy.public"
printf '%s  %s\n' "$privacy_sha" "$BACKUP_DIR/privacy.public" | sha256sum -c -

pid=$(sudo -iu ubuntu pm2 pid ai-life | tail -1)
test "$pid" -gt 0

node --input-type=module - <<'NODE'
import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const result = await pool.query(
  "SELECT 1 FROM schema_migrations WHERE filename = '014_huawei_health.sql'",
);
await pool.end();
if (result.rowCount !== 1) process.exit(1);
console.log("MIGRATION_OK");
NODE

trap - EXIT
printf 'DEPLOY_OK pid=%s backup=%s sha=%s size=%s\n' \
  "$pid" "$BACKUP_DIR" "$expected_sha" "$expected_size"
