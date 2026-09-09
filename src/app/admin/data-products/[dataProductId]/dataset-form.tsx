"use client";

import { useActionState, useState } from "react";
import { Button, Input, Select } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { Dataset } from "@/models";
import type { DatasetFormState } from "./actions";
import { ACCESS_METHOD_OPTIONS, DATASET_STATUS_OPTIONS } from "./options";

const EMPTY_SCHEMA_ROW = { field: "", type: "", required: false, description: "" };
const EMPTY_CHANGE_ROW = { version: "", date: "", summary: "" };

const INITIAL_STATE: DatasetFormState = {};

export interface DatasetFormProps {
  dataset?: Dataset;
  action: (prevState: DatasetFormState, formData: FormData) => Promise<DatasetFormState>;
  submitLabel: string;
  pendingLabel: string;
}

export function DatasetForm({ dataset, action, submitLabel, pendingLabel }: DatasetFormProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);
  const [schemaRows, setSchemaRows] = useState(dataset?.schema.length ? dataset.schema : [EMPTY_SCHEMA_ROW]);
  const [changeRows, setChangeRows] = useState(
    dataset?.documentation.changeHistory.length ? dataset.documentation.changeHistory : [EMPTY_CHANGE_ROW],
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.error ? <p className="text-xs text-red-600">{state.error}</p> : null}
      {state.success ? <p className="text-xs text-emerald-600">{state.success}</p> : null}

      <input type="hidden" name="schemaJson" value={JSON.stringify(schemaRows.filter((row) => row.field.trim()))} />
      <input
        type="hidden"
        name="changeHistoryJson"
        value={JSON.stringify(changeRows.filter((row) => row.version.trim()))}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input label="Internal name" name="name" defaultValue={dataset?.name} placeholder="customer_360" required />
        <Input
          label="Display name"
          name="displayName"
          defaultValue={dataset?.displayName}
          placeholder="Customer 360"
          required
        />
        <Input label="Domain" name="domain" defaultValue={dataset?.domain} placeholder="Customer" />
        <Input label="Owner" name="owner" defaultValue={dataset?.owner} placeholder="Customer Data Platform Team" />
        <Input label="Version" name="version" defaultValue={dataset?.version} placeholder="1.0" />
        <Input label="Format" name="format" defaultValue={dataset?.format} placeholder="Parquet" />
        <Input label="Freshness" name="freshness" defaultValue={dataset?.freshness} placeholder="Daily" />
        <Input
          label="Last updated"
          name="lastUpdated"
          type="date"
          defaultValue={dataset?.lastUpdated}
        />
        <Select
          label="Status"
          name="status"
          defaultValue={dataset?.status ?? "ACTIVE"}
          options={DATASET_STATUS_OPTIONS}
        />
      </div>

      <Input label="Description" name="description" defaultValue={dataset?.description} />

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-slate-700">Access methods</legend>
        <div className="flex flex-wrap gap-4">
          {ACCESS_METHOD_OPTIONS.map((method) => (
            <label key={method} className="flex items-center gap-1.5 text-sm text-slate-700">
              <input
                type="checkbox"
                name="accessMethods"
                value={method}
                defaultChecked={dataset?.accessMethods.includes(method)}
                className="rounded border-slate-300"
              />
              {method}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-slate-700">Quality metrics (0-100)</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Input
            label="Completeness"
            name="qualityCompleteness"
            type="number"
            min={0}
            max={100}
            defaultValue={dataset?.quality.completeness}
          />
          <Input
            label="Freshness"
            name="qualityFreshness"
            type="number"
            min={0}
            max={100}
            defaultValue={dataset?.quality.freshness}
          />
          <Input
            label="Validity"
            name="qualityValidity"
            type="number"
            min={0}
            max={100}
            defaultValue={dataset?.quality.validity}
          />
          <Input
            label="Duplicates"
            name="qualityDuplicates"
            type="number"
            min={0}
            max={100}
            defaultValue={dataset?.quality.duplicates}
          />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-slate-700">Row-level policy</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="Tenant column" name="tenantColumn" defaultValue={dataset?.rowLevelPolicy.tenantColumn} />
          <Input
            label="Description"
            name="rowLevelPolicyDescription"
            defaultValue={dataset?.rowLevelPolicy.description}
          />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-slate-700">Documentation</legend>
        <Input
          label="Business definition"
          name="businessDefinition"
          defaultValue={dataset?.documentation.businessDefinition}
        />
        <Input label="Data contract" name="dataContract" defaultValue={dataset?.documentation.dataContract} />
        <Input label="SLA" name="sla" defaultValue={dataset?.documentation.sla} />
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-slate-700">Schema fields</legend>
        <div className="flex flex-col gap-2">
          {schemaRows.map((row, index) => (
            <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto_2fr_auto] sm:items-end">
              <Input
                label={index === 0 ? "Field" : undefined}
                value={row.field}
                onChange={(e) =>
                  setSchemaRows((rows) => rows.map((r, i) => (i === index ? { ...r, field: e.target.value } : r)))
                }
                placeholder="field_name"
              />
              <Input
                label={index === 0 ? "Type" : undefined}
                value={row.type}
                onChange={(e) =>
                  setSchemaRows((rows) => rows.map((r, i) => (i === index ? { ...r, type: e.target.value } : r)))
                }
                placeholder="string"
              />
              <label className={cn("flex items-center gap-1.5 text-xs text-slate-600", index === 0 && "mt-6")}>
                <input
                  type="checkbox"
                  checked={row.required}
                  onChange={(e) =>
                    setSchemaRows((rows) =>
                      rows.map((r, i) => (i === index ? { ...r, required: e.target.checked } : r)),
                    )
                  }
                  className="rounded border-slate-300"
                />
                Required
              </label>
              <Input
                label={index === 0 ? "Description" : undefined}
                value={row.description}
                onChange={(e) =>
                  setSchemaRows((rows) =>
                    rows.map((r, i) => (i === index ? { ...r, description: e.target.value } : r)),
                  )
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(index === 0 && "sm:mt-6")}
                onClick={() => setSchemaRows((rows) => rows.filter((_, i) => i !== index))}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
        <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => setSchemaRows((rows) => [...rows, EMPTY_SCHEMA_ROW])}>
          + Add field
        </Button>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-slate-700">Change history</legend>
        <div className="flex flex-col gap-2">
          {changeRows.map((row, index) => (
            <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
              <Input
                label={index === 0 ? "Version" : undefined}
                value={row.version}
                onChange={(e) =>
                  setChangeRows((rows) => rows.map((r, i) => (i === index ? { ...r, version: e.target.value } : r)))
                }
                placeholder="1.1"
              />
              <Input
                label={index === 0 ? "Date" : undefined}
                type="date"
                value={row.date}
                onChange={(e) =>
                  setChangeRows((rows) => rows.map((r, i) => (i === index ? { ...r, date: e.target.value } : r)))
                }
              />
              <Input
                label={index === 0 ? "Summary" : undefined}
                value={row.summary}
                onChange={(e) =>
                  setChangeRows((rows) => rows.map((r, i) => (i === index ? { ...r, summary: e.target.value } : r)))
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(index === 0 && "sm:mt-6")}
                onClick={() => setChangeRows((rows) => rows.filter((_, i) => i !== index))}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() => setChangeRows((rows) => [...rows, EMPTY_CHANGE_ROW])}
        >
          + Add entry
        </Button>
      </fieldset>

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? pendingLabel : submitLabel}
      </Button>
    </form>
  );
}
