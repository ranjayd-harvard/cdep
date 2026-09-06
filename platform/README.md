# Platform scripts

One-command start/stop/restart/status for the whole Customer Data Exchange
Platform — today `cdep` (the portal, at the repo root) and
`data-exchange-service`; every service added later, automatically.

```bash
platform/start.sh              # bring everything up, wait for health checks
platform/status.sh             # what's running right now
platform/restart.sh            # stop then start everything
platform/rebuild.sh            # rebuild images, then redeploy everything
platform/stop.sh               # bring everything down (volumes kept)
```

Target just one service by name (its directory name):

```bash
platform/start.sh data-exchange-service
platform/stop.sh cdep
```

Useful flags:

```bash
platform/start.sh --build           # rebuild images first
platform/start.sh --no-wait         # don't block on health checks
platform/start.sh --timeout 180     # per-service health-check timeout (default 120s)
platform/rebuild.sh --no-cache      # rebuild images from scratch, ignoring the Docker build cache
platform/stop.sh --volumes          # ALSO deletes Postgres/Mongo/MinIO data — destructive, opt-in only
```

`restart.sh --build` and `rebuild.sh` overlap in effect (both end with a
freshly-built image running) but answer different questions: `restart.sh`
is "cycle the container" and `--build` is incidental; `rebuild.sh` is "I
changed a Dockerfile/lockfile/build context and need a new image" — it
runs `docker compose build` explicitly (so `--no-cache` is available,
which `up --build` doesn't expose) and only recreates the containers whose
image actually changed.

## How discovery works

There is no manifest to maintain. `platform/start.sh` (via
`platform/lib.sh`'s `discover_compose_files`) looks for:

1. `docker-compose.yml` at the repo root (the `cdep` stack itself).
2. `docker-compose.yml` in every immediate subdirectory (currently just
   `data-exchange-service/`).

Health-check gating is generic too — it just polls each container's own
Docker health status (from that service's own `healthcheck:` block) until
everything is `healthy` or plainly `running` (no healthcheck defined), and
treats a container that `exited 0` as done rather than failed (that's how
`data-exchange-service`'s one-shot `bucket-init` job is expected to end
up). None of this needs to know anything service-specific.

## Adding a new service to the platform

1. Create a new directory at the repo root (a sibling of
   `data-exchange-service/`) with its own `docker-compose.yml` — same
   pattern as `data-exchange-service`: independently runnable, its own
   `.env`/`.env.example`, real `healthcheck:` blocks on every long-running
   container it defines (that's what `start.sh`/`status.sh` actually wait
   on — a service with no healthcheck is assumed healthy the instant it's
   `running`, which is usually not what you want for e.g. a database).
2. That's it — `platform/start.sh` picks it up on the next run, no script
   changes needed.
3. If the new service needs to reach another one at runtime (the way
   `cdep`'s portal reaches `data-exchange-service` over HTTP), wire that
   the same way: a server-only `<SERVICE>_URL` env var, `http://localhost:<port>`
   for host-process dev, `http://host.docker.internal:<port>` when the
   *caller* also runs in Docker. See
   `../docs/exchange-service-integration.md` for the full writeup of that
   pattern, including the Docker-in-Docker storage-relay-host wrinkle that
   pattern can hit if the callee hands out its own signed URLs (as
   `data-exchange-service` does).

## Why not one merged docker-compose.yml

Each service keeps its own independent `docker-compose.yml` on purpose —
see `../docs/exchange-service-integration.md` § "Why two separate
projects" for the reasoning (independent datastores, independent deploy
lifecycles, narrower blast radius). These scripts are a thin orchestration
layer on top, not a merge: every service is still fully usable on its own
(`cd data-exchange-service && docker compose up`) exactly as before.
