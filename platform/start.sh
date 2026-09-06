#!/usr/bin/env bash
# Starts every service in the platform (the cdep portal's own stack, plus
# every subdirectory with its own docker-compose.yml — data-exchange-service
# today, anything added later automatically). See platform/README.md.
#
# Usage:
#   platform/start.sh                       # start everything
#   platform/start.sh data-exchange-service # start just one service
#   platform/start.sh --build                # rebuild images first
#   platform/start.sh --no-wait               # don't block on health checks
#   platform/start.sh --timeout 180           # per-service health-check timeout (default 120s)
set -eo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

build=false
wait_for_health=true
timeout=120
services=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build) build=true; shift ;;
    --no-wait) wait_for_health=false; shift ;;
    --timeout) timeout="$2"; shift 2 ;;
    -h|--help) tail -n +2 "$0" | grep '^#' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) services+=("$1"); shift ;;
  esac
done

compose_files=()
while IFS= read -r f; do [[ -n "$f" ]] && compose_files+=("$f"); done < <(filter_requested_services "${services[@]}")

if [[ ${#compose_files[@]} -eq 0 ]]; then
  if [[ ${#services[@]} -gt 0 ]]; then
    error "No matching service(s): ${services[*]}"
    info "Known services: $(discover_compose_files | while read -r f; do service_name "$f"; done | tr '\n' ' ')"
  else
    error "No docker-compose.yml found under $PLATFORM_ROOT"
  fi
  exit 1
fi

heading "Starting platform (${#compose_files[@]} service(s))"

failed=()
for f in "${compose_files[@]}"; do
  name="$(service_name "$f")"
  info "$name"
  check_env_file "$f"

  compose_args=(-f "$f" up -d)
  $build && compose_args+=(--build)

  if ! docker compose "${compose_args[@]}"; then
    error "$name: docker compose up failed"
    failed+=("$name")
    continue
  fi

  if $wait_for_health; then
    if wait_for_healthy "$f" "$timeout"; then
      success "$name is up and healthy"
    else
      failed+=("$name")
    fi
  else
    success "$name started (not waiting on health checks)"
  fi
done

heading "Summary"
for f in "${compose_files[@]}"; do
  name="$(service_name "$f")"
  if [[ " ${failed[*]-} " == *" $name "* ]]; then
    error "$name"
  else
    success "$name"
  fi
done

if [[ ${#failed[@]} -gt 0 ]]; then
  echo
  error "${#failed[@]} service(s) failed to start cleanly: ${failed[*]}"
  info "Check logs with: docker compose -f <service>/docker-compose.yml logs"
  exit 1
fi

echo
success "Platform is up."
