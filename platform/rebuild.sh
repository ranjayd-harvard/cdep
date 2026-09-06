#!/usr/bin/env bash
# Rebuilds the Docker image for every service in the platform (or just the
# ones named) and brings the container back up on the new image — for when
# a Dockerfile, dependency lockfile, or other build-context change needs a
# fresh image, not just a container restart (use restart.sh for that; it
# reuses whatever image is already built). Data volumes are always
# preserved.
#
# Usage:
#   platform/rebuild.sh                       # rebuild + redeploy everything
#   platform/rebuild.sh data-exchange-service # rebuild + redeploy just one service
#   platform/rebuild.sh --no-cache             # ignore the Docker build cache (slower, from scratch)
#   platform/rebuild.sh --no-wait / --timeout N   # forwarded to start.sh's health-check wait
set -eo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

no_cache=false
wait_for_health=true
timeout=120
services=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-cache) no_cache=true; shift ;;
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

$no_cache && warn "--no-cache was passed: images will be rebuilt from scratch (slower)."

heading "Rebuilding platform (${#compose_files[@]} service(s))"

failed=()
for f in "${compose_files[@]}"; do
  name="$(service_name "$f")"
  info "$name"
  check_env_file "$f"

  build_args=(-f "$f" build)
  $no_cache && build_args+=(--no-cache)

  if ! docker compose "${build_args[@]}"; then
    error "$name: docker compose build failed"
    failed+=("$name")
    continue
  fi

  # Recreates only the containers whose image actually changed — a
  # service with no Dockerfile changes (or nothing to rebuild) is left
  # running untouched.
  if ! docker compose -f "$f" up -d; then
    error "$name: docker compose up failed"
    failed+=("$name")
    continue
  fi

  if $wait_for_health; then
    if wait_for_healthy "$f" "$timeout"; then
      success "$name rebuilt and healthy"
    else
      failed+=("$name")
    fi
  else
    success "$name rebuilt and started (not waiting on health checks)"
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
  error "${#failed[@]} service(s) failed to rebuild cleanly: ${failed[*]}"
  info "Check logs with: docker compose -f <service>/docker-compose.yml logs"
  exit 1
fi

echo
success "Platform rebuilt."
