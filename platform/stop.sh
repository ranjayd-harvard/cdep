#!/usr/bin/env bash
# Stops every service in the platform (or just the ones named). Containers
# and networks are removed; named volumes (Postgres/Mongo/MinIO data) are
# kept by default — pass --volumes to also wipe them.
#
# Usage:
#   platform/stop.sh                       # stop everything
#   platform/stop.sh data-exchange-service # stop just one service
#   platform/stop.sh --volumes             # also delete data volumes (destructive)
set -eo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

remove_volumes=false
services=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --volumes|-v) remove_volumes=true; shift ;;
    -h|--help) tail -n +2 "$0" | grep '^#' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) services+=("$1"); shift ;;
  esac
done

compose_files=()
while IFS= read -r f; do [[ -n "$f" ]] && compose_files+=("$f"); done < <(filter_requested_services "${services[@]}")

if [[ ${#compose_files[@]} -eq 0 ]]; then
  error "No matching service(s): ${services[*]-all}"
  exit 1
fi

if $remove_volumes; then
  warn "--volumes was passed: named volumes (database/object-storage data) for the selected service(s) will be permanently deleted."
fi

heading "Stopping platform (${#compose_files[@]} service(s))"

failed=()
for f in "${compose_files[@]}"; do
  name="$(service_name "$f")"
  info "$name"

  compose_args=(-f "$f" down)
  $remove_volumes && compose_args+=(--volumes)

  if docker compose "${compose_args[@]}"; then
    success "$name stopped"
  else
    error "$name: docker compose down failed"
    failed+=("$name")
  fi
done

if [[ ${#failed[@]} -gt 0 ]]; then
  echo
  error "${#failed[@]} service(s) failed to stop cleanly: ${failed[*]}"
  exit 1
fi

echo
success "Platform is down."
