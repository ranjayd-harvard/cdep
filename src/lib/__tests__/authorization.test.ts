import { describe, expect, it } from "vitest";
import { isSuperuser } from "@/lib/authorization";
import { UserRole } from "@/models";

describe("isSuperuser", () => {
  it("is true only for SUPERUSER", () => {
    expect(isSuperuser(UserRole.SUPERUSER)).toBe(true);
    expect(isSuperuser(UserRole.CUSTOMER_ADMIN)).toBe(false);
    expect(isSuperuser(UserRole.CUSTOMER_USER)).toBe(false);
    expect(isSuperuser(UserRole.CUSTOMER_READONLY)).toBe(false);
  });
});
