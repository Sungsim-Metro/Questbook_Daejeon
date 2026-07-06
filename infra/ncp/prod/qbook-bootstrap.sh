#!/bin/bash
# Fetch deploy config and app secrets from NCP Secret Manager, then docker login.
# Runs on every boot via qbook-bootstrap.service. English only (NCP tooling constraint).
set -euo pipefail

BOOTSTRAP_ENV=/etc/questbook/bootstrap.env
SYNC_SCRIPT=/opt/questbook/sync_ncp_secret_env.py

# shellcheck disable=SC1090
. "$BOOTSTRAP_ENV"

: "${NCP_API_ACCESS_KEY:?NCP_API_ACCESS_KEY is required}"
: "${NCP_API_SECRET_KEY:?NCP_API_SECRET_KEY is required}"
: "${QBOOK_DEPLOY_SECRET_ID:?QBOOK_DEPLOY_SECRET_ID is required}"
QBOOK_APP_SECRET_ID="${QBOOK_APP_SECRET_ID:-}"

export NCP_API_ACCESS_KEY NCP_API_SECRET_KEY

# 1) Deploy config (REGISTRY, IMAGE_TAG) -> /etc/questbook/deploy.env
python3 "$SYNC_SCRIPT" --secret-id "$QBOOK_DEPLOY_SECRET_ID" \
  --env-file /etc/questbook/deploy.env --write
chmod 600 /etc/questbook/deploy.env

# 2) App secrets -> /etc/questbook/app.env (app VMs only)
if [ -n "$QBOOK_APP_SECRET_ID" ]; then
  python3 "$SYNC_SCRIPT" --secret-id "$QBOOK_APP_SECRET_ID" \
    --env-file /etc/questbook/app.env --write
  chmod 600 /etc/questbook/app.env
fi

# 3) Registry login for the docker pull in app/web units.
# shellcheck disable=SC1091
. /etc/questbook/deploy.env
: "${REGISTRY:?REGISTRY is required in /etc/questbook/deploy.env}"
printf '%s' "$NCP_API_SECRET_KEY" | docker login --username "$NCP_API_ACCESS_KEY" \
  --password-stdin "$REGISTRY"
