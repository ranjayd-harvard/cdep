// Performance test (spec §8.16). Not executed as part of this build — no
// load-testing infra is assumed to exist in this environment; this script
// is the documented, runnable artifact.
//
// Prerequisites: the service running (locally or via docker compose) with
// Tenant A entitled + subscribed to event-performance (see scripts/demo.ts
// or the README's curl walkthrough) and serving-store rows populated.
//
// Run:
//   k6 run -e BASE_URL=http://localhost:8095 -e TOKEN=<base64url dev token> perf/k6-event-performance.js
//
// Measures p50/p95/p99 latency, throughput, and error rate against the
// happy-path query and a filtered/paginated query mix.
import http from "k6/http";
import { check } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8095";
const TOKEN = __ENV.TOKEN;

export const options = {
  scenarios: {
    steady_load: {
      executor: "constant-vus",
      vus: 20,
      duration: "60s",
    },
  },
  thresholds: {
    http_req_duration: ["p(50)<100", "p(95)<300", "p(99)<600"],
    http_req_failed: ["rate<0.01"],
  },
};

const errorRate = new Rate("app_errors");
const latency = new Trend("app_latency_ms", true);

const QUERIES = [
  "/v1/data-products/event-performance/events",
  "/v1/data-products/event-performance/events?page_size=50",
  "/v1/data-products/event-performance/events?event_date_from=2026-01-01&event_date_to=2026-12-31",
  "/v1/data-products/event-performance/events?fields=event_id,event_date",
];

export default function () {
  const path = QUERIES[Math.floor(Math.random() * QUERIES.length)];
  const res = http.get(`${BASE_URL}${path}`, {
    headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
  });
  latency.add(res.timings.duration);
  const ok = check(res, { "status is 200": (r) => r.status === 200 });
  errorRate.add(!ok);
}
