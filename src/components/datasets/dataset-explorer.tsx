"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { DatasetAccessMethod, DatasetStatus, type Dataset } from "@/models";
import { Input, Select, EmptyState } from "@/components/ui";
import { DatasetCard } from "./dataset-card";

const ALL_VALUE = "ALL";

export function DatasetExplorer({ datasets }: { datasets: Dataset[] }) {
  const [search, setSearch] = useState("");
  const [domain, setDomain] = useState(ALL_VALUE);
  const [status, setStatus] = useState(ALL_VALUE);
  const [accessMethod, setAccessMethod] = useState(ALL_VALUE);

  const domainOptions = useMemo(
    () => [ALL_VALUE, ...Array.from(new Set(datasets.map((d) => d.domain))).sort()],
    [datasets],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return datasets.filter((dataset) => {
      const matchesQuery =
        query.length === 0 ||
        dataset.displayName.toLowerCase().includes(query) ||
        dataset.description.toLowerCase().includes(query);
      const matchesDomain = domain === ALL_VALUE || dataset.domain === domain;
      const matchesStatus = status === ALL_VALUE || dataset.status === status;
      const matchesAccessMethod =
        accessMethod === ALL_VALUE ||
        dataset.accessMethods.includes(accessMethod as DatasetAccessMethod);
      return matchesQuery && matchesDomain && matchesStatus && matchesAccessMethod;
    });
  }, [datasets, search, domain, status, accessMethod]);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <Input
            aria-label="Search data products"
            placeholder="Search data products…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          aria-label="Filter by domain"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          options={domainOptions.map((value) => ({
            value,
            label: value === ALL_VALUE ? "All Domains" : value,
          }))}
        />
        <Select
          aria-label="Filter by status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          options={[
            { value: ALL_VALUE, label: "All Statuses" },
            { value: DatasetStatus.ACTIVE, label: "Active" },
            { value: DatasetStatus.DEPRECATED, label: "Deprecated" },
            { value: DatasetStatus.COMING_SOON, label: "Coming Soon" },
          ]}
        />
        <Select
          aria-label="Filter by access method"
          value={accessMethod}
          onChange={(event) => setAccessMethod(event.target.value)}
          options={[
            { value: ALL_VALUE, label: "All Access Methods" },
            { value: DatasetAccessMethod.API, label: "API" },
            { value: DatasetAccessMethod.DOWNLOAD, label: "Download" },
            { value: DatasetAccessMethod.SFTP, label: "SFTP" },
            { value: DatasetAccessMethod.DATA_SHARE, label: "Data Share" },
          ]}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No data products match your filters"
          description="Try adjusting your search or filter criteria."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((dataset) => (
            <DatasetCard key={dataset.id} dataset={dataset} />
          ))}
        </div>
      )}
    </div>
  );
}
