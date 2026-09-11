import { Activity, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { services } from "@/services";
import { env } from "@/config/env";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  MetricCard,
  PageHeader,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { formatDateTime } from "@/lib/utils";

export default async function AdminObservabilityPage() {
  const [executionsResult, alertsResult, incidentsResult] = await Promise.all([
    services.observabilityAdmin.listRecentExecutions({ limit: 50 }),
    services.observabilityAdmin.listAlerts({}),
    services.observabilityAdmin.listIncidents({}),
  ]);

  if (!executionsResult.available) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Observability"
          description="Cross-service correlation, SLA, health, and alerts (Phase 9)."
        />
        <Card>
          <CardContent>
            <EmptyState
              icon={Activity}
              title="Observability service not configured"
              description="Set OBSERVABILITY_SERVICE_URL (and OBSERVABILITY_SERVICE_INTERNAL_API_KEY) to enable this page."
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  const executions = executionsResult.items;
  const alerts = alertsResult.items;
  const incidents = incidentsResult.items;

  const openAlerts = alerts.filter((a) => a.state === "OPEN" || a.state === "ACKNOWLEDGED");
  const failedExecutions = executions.filter((e) => e.overallStatus === "FAILED");
  const healthyExecutions = executions.filter((e) => e.healthStatus === "HEALTHY");
  const openIncidents = incidents.filter((i) => i.state === "OPEN");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Observability"
        description="Cross-service correlation, SLA, health, and alerts across every tenant (Phase 9). Read-only — this page never triggers a retry; see each alert's recommended owner instead."
      />

      {!env.observabilityServiceEnabled ? null : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <MetricCard label="Recent executions" value={executions.length} icon={Activity} />
          <MetricCard
            label="Healthy"
            value={healthyExecutions.length}
            icon={CheckCircle2}
            tone={healthyExecutions.length === executions.length && executions.length > 0 ? "positive" : "default"}
          />
          <MetricCard
            label="Failed"
            value={failedExecutions.length}
            icon={XCircle}
            tone={failedExecutions.length > 0 ? "negative" : "default"}
          />
          <MetricCard
            label="Open alerts"
            value={openAlerts.length}
            icon={AlertTriangle}
            tone={openAlerts.length > 0 ? "warning" : "default"}
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent executions</CardTitle>
        </CardHeader>
        <CardContent>
          {executions.length === 0 ? (
            <EmptyState icon={Activity} title="No executions observed yet" />
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Data Product</TableHeaderCell>
                  <TableHeaderCell>Tenant</TableHeaderCell>
                  <TableHeaderCell>Stage</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Technical SLA</TableHeaderCell>
                  <TableHeaderCell>Business SLA</TableHeaderCell>
                  <TableHeaderCell>Health</TableHeaderCell>
                  <TableHeaderCell>Started</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {executions.map((row) => (
                  <TableRow key={row.executionId}>
                    <TableCell>
                      <div className="font-medium text-slate-900">{row.dataProductId}</div>
                      <div className="text-xs text-slate-500">{row.productVersion}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-500">{row.tenantId}</TableCell>
                    <TableCell className="text-xs text-slate-600">{row.currentStage ?? "—"}</TableCell>
                    <TableCell>
                      <StatusBadge status={row.overallStatus} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.technicalSlaStatus} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.businessSlaStatus} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.healthStatus} />
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {row.startedAt ? formatDateTime(row.startedAt) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Alerts</CardTitle>
        </CardHeader>
        <CardContent>
          {alerts.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="No alerts" description="Nothing has fired an alert rule yet." />
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Type</TableHeaderCell>
                  <TableHeaderCell>Severity</TableHeaderCell>
                  <TableHeaderCell>State</TableHeaderCell>
                  <TableHeaderCell>Data Product</TableHeaderCell>
                  <TableHeaderCell>Description</TableHeaderCell>
                  <TableHeaderCell>Opened</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {alerts.map((alert) => (
                  <TableRow key={alert.alertId}>
                    <TableCell className="text-xs font-medium text-slate-900">{alert.alertType}</TableCell>
                    <TableCell>
                      <StatusBadge status={alert.severity === "CRITICAL" ? "FAIL" : alert.severity === "WARNING" ? "AT_RISK" : "PASS"} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={alert.state} />
                    </TableCell>
                    <TableCell>
                      <div className="text-slate-900">{alert.dataProductId}</div>
                      <div className="text-xs text-slate-500">{alert.productVersion}</div>
                    </TableCell>
                    <TableCell className="max-w-sm truncate text-xs text-slate-600">{alert.description ?? "—"}</TableCell>
                    <TableCell className="text-xs text-slate-500">{formatDateTime(alert.openedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Incidents</CardTitle>
        </CardHeader>
        <CardContent>
          {incidents.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="No incidents" description={`${openIncidents.length} open.`} />
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Title</TableHeaderCell>
                  <TableHeaderCell>Severity</TableHeaderCell>
                  <TableHeaderCell>State</TableHeaderCell>
                  <TableHeaderCell>Data Product</TableHeaderCell>
                  <TableHeaderCell>Opened</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {incidents.map((incident) => (
                  <TableRow key={incident.incidentId}>
                    <TableCell className="text-slate-900">{incident.title}</TableCell>
                    <TableCell>
                      <StatusBadge status={incident.severity === "CRITICAL" ? "FAIL" : "AT_RISK"} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={incident.state === "OPEN" ? "OPEN" : "RESOLVED"} />
                    </TableCell>
                    <TableCell>
                      <div className="text-slate-900">{incident.dataProductId}</div>
                      <div className="text-xs text-slate-500">{incident.productVersion}</div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">{formatDateTime(incident.openedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
