#!/usr/bin/env bash
# Shared helpers for platform/{start,stop,restart,status}.sh.
# Not meant to be run directly — sourced by the other scripts.

# Resolves to the cdep repo root regardless of cwd (this file lives in
# <root>/platform/lib.sh).
PLATFORM_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Directory names to never treat as a service, even if a docker-compose.yml
# somehow ends up directly inside one (defensive — shouldn't happen for the
# depth-1 glob discover_compose_files() uses, but cheap to guard anyway).
PLATFORM_EXCLUDE_DIRS=(node_modules .git .next dist build out coverage public docs scripts src platform)

_c_reset='\033[0m'; _c_bold='\033[1m'; _c_green='\033[32m'; _c_yellow='\033[33m'; _c_red='\033[31m'; _c_blue='\033[34m'

info()    { printf "${_c_blue}==>${_c_reset} %s\n" "$*"; }
success() { printf "${_c_green}✓${_c_reset} %s\n" "$*"; }
warn()    { printf "${_c_yellow}!${_c_reset} %s\n" "$*"; }
error()   { printf "${_c_red}✗${_c_reset} %s\n" "$*" >&2; }
heading() { printf "\n${_c_bold}%s${_c_reset}\n" "$*"; }

# Prints one docker-compose.yml path per line: the platform root's own
# stack, plus one level of subdirectories (where data-exchange-service
# lives today, and where future services are expected to land). Adding a
# new service is just "drop a directory with its own docker-compose.yml
# in it" — nothing here needs editing.
discover_compose_files() {
  local root="$PLATFORM_ROOT"
  [[ -f "$root/docker-compose.yml" ]] && echo "$root/docker-compose.yml"

  local dir base skip
  for dir in "$root"/*/; do
    dir="${dir%/}"
    base="$(basename "$dir")"
    skip=false
    for excluded in "${PLATFORM_EXCLUDE_DIRS[@]}"; do
      [[ "$base" == "$excluded" ]] && skip=true && break
    done
    $skip && continue
    [[ -f "$dir/docker-compose.yml" ]] && echo "$dir/docker-compose.yml"
  done
}

# The name shown in script output / used to filter via a CLI arg — just
# the containing directory's name (e.g. "cdep", "data-exchange-service").
service_name() {
  basename "$(dirname "$1")"
}

# Filters the discovered compose files down to just the ones named on the
# command line (if any were given); prints all of them if none were.
filter_requested_services() {
  local -a requested=("$@")
  local -a all_files=()
  while IFS= read -r f; do all_files+=("$f"); done < <(discover_compose_files)

  if [[ ${#requested[@]} -eq 0 ]]; then
    printf '%s\n' "${all_files[@]}"
    return
  fi

  local f name matched
  for f in "${all_files[@]}"; do
    name="$(service_name "$f")"
    matched=false
    for r in "${requested[@]}"; do
      [[ "$name" == "$r" ]] && matched=true && break
    done
    $matched && echo "$f"
  done
}

# Polls every container in a compose project until each one is either
# "healthy" (has a healthcheck and it passes), plainly "running" (no
# healthcheck defined — nothing more to wait for), or has *exited with
# code 0* (a one-shot init job like data-exchange-service's bucket-init —
# success, not still starting). Any other state (starting, unhealthy,
# restarting, or exited non-zero) keeps the wait going until $timeout.
wait_for_healthy() {
  local compose_file="$1"
  local timeout="${2:-120}"
  local elapsed=0
  local interval=2

  while true; do
    local -a ids=()
    while IFS= read -r id; do [[ -n "$id" ]] && ids+=("$id"); done < <(docker compose -f "$compose_file" ps -a -q 2>/dev/null)

    if [[ ${#ids[@]} -eq 0 ]]; then
      sleep "$interval"; elapsed=$((elapsed + interval))
      if (( elapsed >= timeout )); then error "$(service_name "$compose_file"): no containers found after ${timeout}s"; return 1; fi
      continue
    fi

    local all_ok=true
    local -a pending=()
    for id in "${ids[@]}"; do
      local status health
      status="$(docker inspect -f '{{.State.Status}}' "$id" 2>/dev/null || echo unknown)"
      case "$status" in
        running)
          health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id" 2>/dev/null)"
          if [[ "$health" == "starting" || "$health" == "unhealthy" ]]; then
            all_ok=false
            pending+=("$(docker inspect -f '{{.Name}}' "$id" | sed 's#^/##')=$health")
          fi
          ;;
        exited)
          local exit_code
          exit_code="$(docker inspect -f '{{.State.ExitCode}}' "$id" 2>/dev/null)"
          if [[ "$exit_code" != "0" ]]; then
            error "$(docker inspect -f '{{.Name}}' "$id" | sed 's#^/##') exited with code $exit_code"
            return 1
          fi
          ;;
        *)
          all_ok=false
          pending+=("$(docker inspect -f '{{.Name}}' "$id" | sed 's#^/##')=$status")
          ;;
      esac
    done

    $all_ok && return 0

    sleep "$interval"; elapsed=$((elapsed + interval))
    if (( elapsed >= timeout )); then
      error "$(service_name "$compose_file"): timed out after ${timeout}s waiting on: ${pending[*]}"
      return 1
    fi
  done
}

# Warns (does not fail) if a service directory has an .env.example but no
# .env — the most common reason a freshly-cloned service fails to start.
check_env_file() {
  local dir
  dir="$(dirname "$1")"
  if [[ -f "$dir/.env.example" && ! -f "$dir/.env" ]]; then
    warn "$(service_name "$1"): no .env file found (see $dir/.env.example)"
  fi
}
