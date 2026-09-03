import { requireTenantContext } from "@/lib/tenant";
import { canManageSettings } from "@/lib/authorization";
import { services } from "@/services";
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Button,
  StatusBadge,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from "@/components/ui";
import { formatDateTime } from "@/lib/utils";
import { CreateApiKeyForm } from "./create-api-key-form";
import { revokeApiKeyAction } from "./actions";

export default async function ApiAccessPage() {
  const tenant = await requireTenantContext();
  const isAdmin = canManageSettings(tenant.role);
  const apiAccess = await services.apiAccess.getApiAccessInfo(tenant.tenantId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="API Access" description="Programmatic access to your entitled data products." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>API Status</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge color={apiAccess.status === "Active" ? "green" : "red"}>{apiAccess.status}</Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Base URL</CardTitle>
          </CardHeader>
          <CardContent>
            <code className="block rounded-md bg-slate-900 px-3 py-2 text-xs text-slate-100">
              {apiAccess.baseUrl}
            </code>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>API Credentials</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Label</TableHeaderCell>
                <TableHeaderCell>Key</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Created</TableHeaderCell>
                <TableHeaderCell>Last Used</TableHeaderCell>
                {isAdmin ? <TableHeaderCell>Actions</TableHeaderCell> : null}
              </TableRow>
            </TableHead>
            <TableBody>
              {apiAccess.credentials.map((credential) => (
                <TableRow key={credential.id}>
                  <TableCell>{credential.label}</TableCell>
                  <TableCell className="font-mono text-xs">{credential.maskedKey}</TableCell>
                  <TableCell>
                    <StatusBadge status={credential.status} />
                  </TableCell>
                  <TableCell>{formatDateTime(credential.createdAt)}</TableCell>
                  <TableCell>
                    {credential.lastUsedAt ? formatDateTime(credential.lastUsedAt) : "Never"}
                  </TableCell>
                  {isAdmin ? (
                    <TableCell>
                      {credential.status === "active" ? (
                        <form action={revokeApiKeyAction.bind(null, credential.id)}>
                          <Button type="submit" size="sm" variant="danger">
                            Revoke
                          </Button>
                        </form>
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
              {apiAccess.credentials.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 6 : 5} className="text-center text-sm text-slate-500">
                    No API keys yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>

          {isAdmin ? <CreateApiKeyForm /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Example Endpoints</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Method</TableHeaderCell>
                <TableHeaderCell>Path</TableHeaderCell>
                <TableHeaderCell>Description</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {apiAccess.endpoints.map((endpoint) => (
                <TableRow key={`${endpoint.method}-${endpoint.path}`}>
                  <TableCell>
                    <Badge color="blue">{endpoint.method}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{endpoint.path}</TableCell>
                  <TableCell>{endpoint.description}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Example Request</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md bg-slate-900 px-4 py-3 text-xs text-slate-100">
            {`curl -X GET "${apiAccess.baseUrl}/datasets" \\
  -H "Authorization: Bearer ${apiAccess.credentials[0]?.maskedKey ?? "<api-key>"}" \\
  -H "Accept: application/json"`}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
