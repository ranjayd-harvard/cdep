#!/usr/bin/env bash
# Stops then starts every service in the platform (or just the ones
# named). Data volumes are always preserved — use `stop.sh --volumes`
# yourself first if you actually want a clean-slate restart.
#
# Usage:
#   platform/restart.sh                       # restart everything
#   platform/restart.sh data-exchange-service # restart just one service
#   platform/restart.sh --build               # rebuild images before starting back up
#   platform/restart.sh --no-wait / --timeout N   # forwarded to start.sh
set -eo pipefail
platform_dir="$(dirname "${BASH_SOURCE[0]}")"

# stop.sh only understands service-name filters (and --volumes, which
# restart never passes) — strip start.sh-only flags before calling it.
service_args=()
skip_next=false
for arg in "$@"; do
  if $skip_next; then skip_next=false; continue; fi
  case "$arg" in
    --build|--no-wait) ;;
    --timeout) skip_next=true ;;
    *) service_args+=("$arg") ;;
  esac
done

"$platform_dir/stop.sh" "${service_args[@]}"
"$platform_dir/start.sh" "$@"
