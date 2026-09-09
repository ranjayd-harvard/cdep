import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DatasetExplorer } from "@/components/datasets/dataset-explorer";
import { DatasetAccessMethod, DatasetStatus, type Dataset } from "@/models";

function buildDataset(overrides: Partial<Dataset>): Dataset {
  return {
    id: "ds-1",
    name: "dataset_one",
    displayName: "Dataset One",
    description: "First test dataset",
    domain: "Events",
    owner: "Team A",
    version: "1.0.0",
    format: "CSV",
    freshness: "Daily",
    lastUpdated: "2026-08-01T00:00:00Z",
    status: DatasetStatus.ACTIVE,
    accessMethods: [DatasetAccessMethod.API],
    schema: [],
    quality: { completeness: 99, freshness: 99, validity: 99, duplicates: 0 },
    documentation: { businessDefinition: "", dataContract: "", sla: "", changeHistory: [] },
    rowLevelPolicy: { tenantColumn: "tenant_id", description: "" },
    ...overrides,
  };
}

const DATASETS: Dataset[] = [
  buildDataset({ id: "ds-1", displayName: "Event Performance", domain: "Events" }),
  buildDataset({ id: "ds-2", displayName: "Customer 360", domain: "Customer" }),
];

describe("DatasetExplorer", () => {
  it("shows every entitled data product by default", () => {
    render(<DatasetExplorer datasets={DATASETS} />);
    expect(screen.getByText("Event Performance")).toBeInTheDocument();
    expect(screen.getByText("Customer 360")).toBeInTheDocument();
  });

  it("filters data products by search query", async () => {
    const user = userEvent.setup();
    render(<DatasetExplorer datasets={DATASETS} />);

    await user.type(screen.getByPlaceholderText("Search data products…"), "customer");

    expect(screen.getByText("Customer 360")).toBeInTheDocument();
    expect(screen.queryByText("Event Performance")).not.toBeInTheDocument();
  });

  it("shows an empty state when no data product matches the filters", async () => {
    const user = userEvent.setup();
    render(<DatasetExplorer datasets={DATASETS} />);

    await user.type(screen.getByPlaceholderText("Search data products…"), "no-such-dataset");

    expect(screen.getByText("No data products match your filters")).toBeInTheDocument();
  });
});
