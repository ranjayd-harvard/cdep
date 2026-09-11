import { AppError } from "../../common/errors/app-error.js";
import { withTransaction } from "../../database/transaction.js";
import type { RequestContext } from "../../auth/request-context.js";
import { findVersion } from "../versions/version.repository.js";
import { grantOptIn } from "./beta-opt-in.repository.js";
import { recordEvent } from "../../registration/registration-event.repository.js";

export async function grantBetaOptIn(
  dataProductId: string,
  version: string,
  input: { organizationId: string; tenantId: string },
  actor: RequestContext,
) {
  const versionRow = await findVersion(dataProductId, version);
  if (!versionRow) {
    throw new AppError("VERSION_NOT_FOUND", `Version '${version}' of '${dataProductId}' was not found.`);
  }

  return withTransaction(async (client) => {
    const row = await grantOptIn(client, {
      dataProductVersionId: versionRow.data_product_version_id,
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      optedInBy: actor.actorId,
    });
    await recordEvent(client, {
      dataProductId,
      version,
      eventType: "VERSION_BETA_OPT_IN_GRANTED",
      actor,
      eventData: { organizationId: input.organizationId, tenantId: input.tenantId },
    });
    return row;
  });
}
