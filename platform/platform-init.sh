#!/usr/bin/env bash
# Resets a dev instance back to a "fresh install" state: wipes Mongo,
# Postgres, and MinIO data for the core platform, brings everything back
# up clean, then (optionally) bootstraps the first superuser so the portal
# is usable again immediately. Meant for "I've seeded a ton of mock data
# and the databases/datalake are a mess, let me start over" -- NOT for
# anything you want to keep. This is destructive and cannot be undone.
#
# Wipes by default: cdep (Mongo), data-exchange-service (Postgres+MinIO),
# data-lakehouse (Postgres+MinIO). data-publication-service's own
# control-plane Postgres is left alone unless you ask for it -- pass
# --include-publication to wipe that too.
#
# Usage:
#   platform/platform-init.sh                        # confirm, then wipe + restart + bootstrap superuser
#   platform/platform-init.sh --yes                   # skip the confirmation prompt
#   platform/platform-init.sh --include-publication    # also wipe data-publication-service's Postgres
#   platform/platform-init.sh --no-superuser            # skip superuser bootstrap
#   platform/platform-init.sh --superuser-email=you@example.com --superuser-name="You" --superuser-password=...
#   platform/platform-init.sh --build                  # rebuild images before bringing services back up
#   platform/platform-init.sh --no-wait                 # don't block on health checks (skips superuser bootstrap too)
#   platform/platform-init.sh --timeout 180             # per-service health-check timeout (default 120s)
set -eo pipefail
platform_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$platform_dir/lib.sh"

default_services=(cdep data-exchange-service data-lakehouse)

assume_yes=false
build=false
wait_for_health=true
timeout=120
include_publication=false
run_superuser=true
superuser_args=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) assume_yes=true; shift ;;
    --build) build=true; shift ;;
    --no-wait) wait_for_health=false; shift ;;
    --timeout) timeout="$2"; shift 2 ;;
    --include-publication) include_publication=true; shift ;;
    --no-superuser) run_superuser=false; shift ;;
    --superuser-email=*|--superuser-name=*|--superuser-password=*)
      superuser_args+=("--${1#--superuser-}"); shift ;;
    -h|--help) tail -n +2 "$0" | grep '^#' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) error "Unknown argument: $1"; exit 1 ;;
  esac
done

services=("${default_services[@]}")
$include_publication && services+=(data-publication-service)

heading "Platform re-init"
warn "This PERMANENTLY DELETES all Mongo/Postgres/MinIO data for: ${services[*]}"
if ! $assume_yes; then
  read -r -p "Type 'yes' to continue: " confirm
  if [[ "$confirm" != "yes" ]]; then
    error "Aborted -- no data was touched."
    exit 1
  fi
fi

heading "Wiping data (${services[*]})"
"$platform_dir/stop.sh" --volumes "${services[@]}"

heading "Starting platform fresh"
start_args=()
$build && start_args+=(--build)
$wait_for_health || start_args+=(--no-wait)
start_args+=(--timeout "$timeout")
start_args+=("${services[@]}")
"$platform_dir/start.sh" "${start_args[@]}"

if [[ " ${services[*]} " != *" cdep "* ]]; then
  exit 0
fi

if ! $run_superuser; then
  info "Skipping superuser bootstrap (--no-superuser)."
  exit 0
fi

if ! $wait_for_health; then
  warn "Skipping superuser bootstrap: --no-wait means Mongo isn't confirmed healthy yet."
  info "Once it's up, run: npm run create-superuser"
  exit 0
fi

heading "Bootstrapping superuser"
if [[ ${#superuser_args[@]} -eq 0 ]]; then
  info "No --superuser-* flags given -- you'll be prompted for email/name/password."
fi
( cd "$PLATFORM_ROOT" && npm run create-superuser -- "${superuser_args[@]}" )

echo
success "Platform is fresh and ready."
