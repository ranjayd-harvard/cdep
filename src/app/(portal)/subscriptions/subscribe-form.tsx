"use client";

import { useActionState, useState } from "react";
import { Button, Input, Modal, Select } from "@/components/ui";
import type { CatalogDeliveryMethodDTO } from "@/lib/catalog-service/client";
import { createSubscription, type CreateSubscriptionState } from "./subscription-actions";

const INITIAL_STATE: CreateSubscriptionState = {};

const FREQUENCY_OPTIONS = [
  { label: "On demand", value: "ON_DEMAND" },
  { label: "Daily", value: "DAILY" },
  { label: "Weekly", value: "WEEKLY" },
  { label: "Monthly", value: "MONTHLY" },
  { label: "Cron expression", value: "CRON" },
];

const DAY_OF_WEEK_OPTIONS = [
  { label: "Monday", value: "MONDAY" },
  { label: "Tuesday", value: "TUESDAY" },
  { label: "Wednesday", value: "WEDNESDAY" },
  { label: "Thursday", value: "THURSDAY" },
  { label: "Friday", value: "FRIDAY" },
  { label: "Saturday", value: "SATURDAY" },
  { label: "Sunday", value: "SUNDAY" },
];

export function SubscribeForm({
  dataProductId,
  activeVersion,
  deliveryMethods,
}: {
  dataProductId: string;
  activeVersion: string | null;
  deliveryMethods: CatalogDeliveryMethodDTO[];
}) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<string>(deliveryMethods[0]?.type ?? "");
  const [frequency, setFrequency] = useState("DAILY");
  const [state, formAction, pending] = useActionState(createSubscription.bind(null, dataProductId), INITIAL_STATE);

  // No manual close-on-success handling needed: a successful action calls
  // revalidatePath("/subscriptions"), and the parent server component then
  // renders the subscription panel instead of this form, unmounting the
  // modal along with it.
  if (deliveryMethods.length === 0) {
    return <p className="text-xs text-slate-500">No delivery methods are configured for this product yet.</p>;
  }

  const fileFormats = deliveryMethods.find((d) => d.type === "FILE")?.formats ?? [];
  const methodOptions = deliveryMethods.map((d) => ({ label: d.type, value: d.type }));
  const versionOptions = [
    { label: "Latest active version", value: "latest" },
    ...(activeVersion ? [{ label: `Exact — ${activeVersion}`, value: activeVersion }] : []),
    ...(activeVersion ? [{ label: `Compatible with major ${activeVersion.split(".")[0]} (${activeVersion.split(".")[0]}.x)`, value: `${activeVersion.split(".")[0]}.x` }] : []),
  ];

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Subscribe
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Subscribe to this Data Product">
        <form action={formAction} className="flex flex-col gap-3">
          {state.error ? <p className="text-xs text-red-600">{state.error}</p> : null}

          <Select label="Version policy" name="versionPolicy" defaultValue="latest" options={versionOptions} />

          <Select
            label="Delivery method"
            name="method"
            value={method}
            onChange={(event) => setMethod(event.target.value)}
            options={methodOptions}
          />

          {method === "FILE" ? (
            <Select label="File format" name="format" options={fileFormats.map((format) => ({ label: format, value: format }))} />
          ) : null}

          <Select
            label="Frequency"
            name="frequency"
            value={frequency}
            onChange={(event) => setFrequency(event.target.value)}
            options={FREQUENCY_OPTIONS}
          />

          {frequency === "WEEKLY" ? (
            <Select label="Day of week" name="dayOfWeek" defaultValue="MONDAY" options={DAY_OF_WEEK_OPTIONS} />
          ) : null}

          {frequency === "CRON" ? (
            <Input
              label="Cron expression"
              name="cronExpression"
              placeholder="0 6 * * *"
              hint="5 fields: minute hour day-of-month month day-of-week. No seconds field, no @daily-style shortcuts."
            />
          ) : null}

          {frequency !== "ON_DEMAND" ? (
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Delivery time"
                name="deliveryTime"
                placeholder="06:00:00"
                hint={frequency === "CRON" ? "Not used for cron expressions" : "Required for scheduled frequencies"}
                disabled={frequency === "CRON"}
              />
              <Input label="Timezone" name="timezone" placeholder="UTC" defaultValue="UTC" />
            </div>
          ) : null}

          <Input label="Retention (days)" name="retentionDays" type="number" min={1} placeholder="7" />

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Subscribing…" : "Subscribe"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
