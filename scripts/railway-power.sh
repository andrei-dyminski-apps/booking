#!/usr/bin/env bash
# Stops and starts the services of the linked Railway project, to stop paying for compute
# while nobody uses the deployment. Volumes (Postgres, Redis data) survive a stop.
#
#   scripts/railway-power.sh                 # interactive menu
#   scripts/railway-power.sh stop|start|status [service...]
#
# Without service names the default list below is used. Start goes through it in order,
# stop in reverse, so the API never runs without its database and queue.
set -euo pipefail

# The API is named after its package in .railway/railway.ts.
DEFAULT_SERVICES=(Postgres Redis @repo/api)

# The global CLI on purpose: the `railway` devDependency is the IaC SDK for .railway/railway.ts,
# and `pnpm run` puts its node_modules/.bin first on PATH.
railway="$(type -ap railway | grep -v node_modules/.bin | head -n 1 || true)"
if [[ -z "$railway" ]]; then
  echo "Railway CLI not found: npm i -g @railway/cli" >&2
  exit 1
fi

run() {
  echo "+ railway $*"
  "$railway" "$@"
}

stop_services() {
  local i service
  for ((i = ${#services[@]} - 1; i >= 0; i--)); do
    service="${services[i]}"
    echo "Stopping $service"
    run down --service "$service" --yes || echo "Could not stop $service, skipping." >&2
  done
}

# `down` removes the latest deployment, and Railway refuses to redeploy a removed one, so a
# service stopped here comes back from its source: the image for Postgres and Redis, the
# latest commit of the tracked branch for the API. Plain `redeploy` goes first for a service
# that was never stopped.
start_services() {
  local service
  for service in "${services[@]}"; do
    echo "Starting $service"
    if ! run redeploy --service "$service" --yes &&
      ! run redeploy --service "$service" --from-source --yes; then
      echo "Could not start $service: open it in the dashboard and deploy it." >&2
    fi
  done
}

show_status() {
  run status
}

confirm() {
  local answer
  read -r -p "$1 [y/N] " answer
  [[ "$answer" == [yY] ]]
}

action="${1:-}"
if [[ $# -gt 1 ]]; then
  services=("${@:2}")
else
  services=("${DEFAULT_SERVICES[@]}")
fi

if [[ -z "$action" ]]; then
  echo "Services: ${services[*]}"
  PS3="What to do? "
  select choice in stop start status quit; do
    case "$choice" in
      stop | start | status) action="$choice" ;;
      quit) exit 0 ;;
      *) continue ;;
    esac
    break
  done
fi

"$railway" whoami >/dev/null 2>&1 || {
  echo "Not logged in: run railway login first." >&2
  exit 1
}

case "$action" in
  stop)
    confirm "Stop ${services[*]}?" && stop_services
    ;;
  start)
    start_services
    ;;
  status)
    show_status
    ;;
  *)
    echo "Usage: $0 [stop|start|status] [service...]" >&2
    exit 1
    ;;
esac
