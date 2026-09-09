import { describe, expect, it } from "vitest";
import { validateDeliveryPreference } from "../../domain/delivery-preference.js";
import { AppError } from "../../common/errors/app-error.js";

describe("validateDeliveryPreference", () => {
  it("accepts FILE + PARQUET with a daily schedule", () => {
    expect(() =>
      validateDeliveryPreference({
        method: "FILE",
        format: "PARQUET",
        frequency: "DAILY",
        deliveryTime: "06:00:00",
        timezone: "UTC",
        retentionDays: 7,
      }),
    ).not.toThrow();
  });

  it("rejects FILE without a format", () => {
    expect(() => validateDeliveryPreference({ method: "FILE", frequency: "DAILY" })).toThrow(AppError);
  });

  it("rejects API with a format set", () => {
    expect(() => validateDeliveryPreference({ method: "API", format: "PARQUET", frequency: "ON_DEMAND" })).toThrow(
      AppError,
    );
  });

  it("accepts a declarative API preference", () => {
    expect(() =>
      validateDeliveryPreference({ method: "API", frequency: "ON_DEMAND", apiProfile: "STANDARD" }),
    ).not.toThrow();
  });

  it("rejects ON_DEMAND with a delivery_time", () => {
    expect(() =>
      validateDeliveryPreference({ method: "API", frequency: "ON_DEMAND", deliveryTime: "06:00:00", timezone: "UTC" }),
    ).toThrow(AppError);
  });

  it("rejects retention_days <= 0", () => {
    expect(() =>
      validateDeliveryPreference({ method: "FILE", format: "CSV", frequency: "DAILY", retentionDays: 0 }),
    ).toThrow(AppError);
  });

  it("rejects an invalid IANA timezone", () => {
    expect(() =>
      validateDeliveryPreference({
        method: "FILE",
        format: "CSV",
        frequency: "DAILY",
        deliveryTime: "06:00:00",
        timezone: "Not/AZone",
      }),
    ).toThrow(AppError);
  });

  it("rejects delivery_time without a timezone", () => {
    expect(() =>
      validateDeliveryPreference({ method: "FILE", format: "CSV", frequency: "DAILY", deliveryTime: "06:00:00" }),
    ).toThrow(AppError);
  });
});
