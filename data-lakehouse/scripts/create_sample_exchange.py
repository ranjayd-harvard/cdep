#!/usr/bin/env python
"""Stage a fixture exchange for MockExchangeServiceClient.

Simulates what data-exchange-service would have already done during the
customer upload flow: place the source file and a manifest describing it
under exchange-inbound/exchanges/{exchange_id}/.

Example:
    python scripts/create_sample_exchange.py \\
        --exchange-id exc-example-001 \\
        --organization-id org-vobis-org-722aea \\
        --tenant-id tenant-default-47d849 \\
        --data-product-id event-data \\
        --schema-version 1.0 \\
        --file samples/event-data/events.csv \\
        --format CSV
"""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import structlog

from lakehouse.common.time import utcnow
from lakehouse.config.settings import get_settings
from lakehouse.observability.logging import configure_logging
from lakehouse.storage import build_storage_client

log = structlog.get_logger(__name__)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exchange-id", required=True)
    parser.add_argument("--organization-id", required=True)
    parser.add_argument("--tenant-id", required=True)
    parser.add_argument("--data-product-id", required=True)
    parser.add_argument("--schema-version", default="1.0")
    parser.add_argument("--file", required=True, help="Path to the local sample data file")
    parser.add_argument("--format", required=True, choices=["CSV", "JSON", "PARQUET"])
    parser.add_argument("--status", default="VALIDATED")
    parser.add_argument("--channel", default="CUSTOMER_PORTAL")
    parser.add_argument("--user-id", default="usr-sample-0000001")
    args = parser.parse_args()

    configure_logging()
    settings = get_settings()
    storage = build_storage_client(settings)

    file_path = Path(args.file)
    data = file_path.read_bytes()
    checksum = hashlib.sha256(data).hexdigest()
    content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"

    prefix = f"exchanges/{args.exchange_id}"
    storage.put_bytes(
        settings.bucket_exchange_inbound, f"{prefix}/{file_path.name}", data, content_type
    )

    manifest = {
        "manifestVersion": "1.0",
        "exchange": {
            "exchangeId": args.exchange_id,
            "direction": "INBOUND",
            "status": args.status,
        },
        "ownership": {
            "organizationId": args.organization_id,
            "tenantId": args.tenant_id,
        },
        "submittedBy": {"userId": args.user_id},
        "dataProduct": {
            "dataProductId": args.data_product_id,
            "schemaVersion": args.schema_version,
        },
        "file": {
            "originalFilename": file_path.name,
            "contentType": content_type,
            "format": args.format,
            "sizeBytes": len(data),
            "checksumAlgorithm": "SHA-256",
            "checksum": checksum,
        },
        "source": {"channel": args.channel},
        "timestamps": {"receivedAt": utcnow().isoformat()},
    }
    manifest_bytes = json.dumps(manifest, indent=2).encode("utf-8")
    storage.put_bytes(
        settings.bucket_exchange_inbound, f"{prefix}/manifest.json", manifest_bytes, "application/json"
    )

    log.info(
        "sample_exchange.staged",
        exchange_id=args.exchange_id,
        organization_id=args.organization_id,
        tenant_id=args.tenant_id,
        data_product_id=args.data_product_id,
        file=file_path.name,
        size_bytes=len(data),
        checksum=checksum,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
