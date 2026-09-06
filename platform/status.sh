#!/usr/bin/env bash
# Shows the current state of every service in the platform, without
# starting or stopping anything.
#
# Usage:
#   platform/status.sh                       # show everything
#   platform/status.sh data-exchange-service # show just one service
set -eo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

compose_files=()
while IFS= read -r f; do [[ -n "$f" ]] && compose_files+=("$f"); done < <(filter_requested_services "$@")

if [[ ${#compose_files[@]} -eq 0 ]]; then
  error "No matching service(s): ${*:-all}"
  exit 1
fi

for f in "${compose_files[@]}"; do
  name="$(service_name "$f")"
  heading "$name"
  check_env_file "$f"

  ids=()
  while IFS= read -r id; do [[ -n "$id" ]] && ids+=("$id"); done < <(docker compose -f "$f" ps -a -q 2>/dev/null)
  if [[ ${#ids[@]} -eq 0 ]]; then
    warn "not running"
    continue
  fi

  for id in "${ids[@]}"; do
    cname="$(docker inspect -f '{{.Name}}' "$id" | sed 's#^/##')"
    status="$(docker inspect -f '{{.State.Status}}' "$id")"
    health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id")"
    label="$status"
    [[ "$health" != "none" ]] && label="$status, $health"

    if [[ "$status" == "running" && ( "$health" == "healthy" || "$health" == "none" ) ]]; then
      success "$cname  [$label]"
    elif [[ "$status" == "exited" && "$(docker inspect -f '{{.State.ExitCode}}' "$id")" == "0" ]]; then
      success "$cname  [exited 0 — one-shot job, done]"
    else
      error "$cname  [$label]"
    fi
  done
done
