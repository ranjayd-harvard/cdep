#!/usr/bin/env python
"""Developer inspection tool for Bronze tables (AGENTS.md section 45).

Requires --organization/--tenant unless --admin is explicitly passed, per
the tenant-isolation rule in AGENTS.md section 26 ("every query helper must
require tenant context unless explicitly operating as an internal platform
process").

Examples:
    python scripts/inspect_bronze.py --table bronze.event_data \\
        --organization org-vobis-org-722aea --tenant tenant-default-47d849

    python scripts/inspect_bronze.py --table bronze.event_data --admin
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from lakehouse.catalog.catalog import get_catalog
from lakehouse.catalog.iceberg import scan_tenant_scoped, scan_unscoped


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--table", required=True, help="e.g. bronze.event_data")
    parser.add_argument("--organization", help="organization_id (required unless --admin)")
    parser.add_argument("--tenant", help="tenant_id (required unless --admin)")
    parser.add_argument(
        "--admin", action="store_true", help="Bypass tenant scoping (privileged, cross-tenant)"
    )
    parser.add_argument("--limit", type=int, default=50)
    args = parser.parse_args()

    if not args.admin and not (args.organization and args.tenant):
        parser.error("--organization and --tenant are required unless --admin is set")

    catalog = get_catalog()
    table = catalog.load_table(args.table)

    if args.admin:
        scan = scan_unscoped(table)
        print(f"[ADMIN MODE] Cross-tenant scan of {args.table} -- use only for internal ops.\n")
    else:
        scan = scan_tenant_scoped(table, organization_id=args.organization, tenant_id=args.tenant)

    df = scan.to_arrow().to_pandas()
    if args.limit:
        df = df.head(args.limit)

    if df.empty:
        print("No rows found.")
        return 0

    business_cols = [c for c in df.columns if not c.startswith("_")]
    lineage_cols = [c for c in df.columns if c.startswith("_")]

    print(f"Table: {args.table}  ({len(df)} row(s) shown)")
    print("\n--- business columns ---")
    print(df[business_cols].to_string(index=False))
    print("\n--- lineage columns ---")
    print(df[lineage_cols].to_string(index=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
