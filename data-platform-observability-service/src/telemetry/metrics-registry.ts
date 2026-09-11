// Hand-rolled counters-only registry (spec section 31, kept light per the
// 9.9 scoping decision — no OpenTelemetry SDK). Low-cardinality names only;
// never an execution_id/request_id/trace_id label (spec section 16).
const counters = new Map<string, number>();

export function increment(name: string, by = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + by);
}

export function renderPrometheusText(): string {
  const names = [
    "operational_execution_total",
    "operational_execution_failure_total",
    "publication_failure_total",
    "sla_breach_total",
    "alert_open_total",
    "api_delivery_request_total",
  ];
  const lines: string[] = [];
  for (const name of names) {
    lines.push(`# TYPE ${name} counter`);
    lines.push(`${name} ${counters.get(name) ?? 0}`);
  }
  return lines.join("\n") + "\n";
}
