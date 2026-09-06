#!/usr/bin/env python
"""Developer inspection tool for Gold Data Products (AGENTS.md section 60).

Requires --organization/--tenant unless --admin is explicitly passed, same
tenant-isolation rule as scripts/inspect_bronze.py (AGENTS.md section 26).

Examples:
    python scripts/inspect_data_product.py --product event-performance \\
        --organization org-vobis-org-722aea --tenant tenant-default-47d849

    python scripts/inspect_data_product.py --product event-performance --admin
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from lakehouse.catalog.catalog import get_catalog
from lakehouse.contracts.loader import load_gold_contract
from lakehouse.gold.gold_reader import read_gold_admin, read_gold_tenant_scoped
from lakehouse.pipelines.registry import SILVER_TO_GOLD_PIPELINES


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--product", required=True, help="Gold data_product_id, e.g. event-performance")
    parser.add_argument("--organization", help="organization_id (required unless --admin)")
    parser.add_argument("--tenant", help="tenant_id (required unless --admin)")
    parser.add_argument(
        "--admin", action="store_true", help="Bypass tenant scoping (privileged, cross-tenant)"
    )
    parser.add_argument("--limit", type=int, default=50)
    args = parser.parse_args()

    if not args.admin and not (args.organization and args.tenant):
        parser.error("--organization and --tenant are required unless --admin is set")

    registration = SILVER_TO_GOLD_PIPELINES.get(args.product)
    if registration is None:
        parser.error(f"Unknown Gold product '{args.product}'")

    contract = load_gold_contract(args.product)
    catalog = get_catalog()

    if args.admin:
        rows = read_gold_admin(catalog, table_name=registration.gold_table_name)
        print(f"[ADMIN MODE] Cross-tenant scan of gold.{registration.gold_table_name} -- use only for internal ops.\n")
    else:
        rows = read_gold_tenant_scoped(
            catalog,
            table_name=registration.gold_table_name,
            organization_id=args.organization,
            tenant_id=args.tenant,
        )

    print(
        f"Data Product: {contract.data_product.name} ({contract.data_product_id} v{contract.version})"
    )
    print(f"Owner: {contract.data_product.owner}")
    print(f"Table: gold.{registration.gold_table_name}  ({len(rows)} row(s) found)\n")

    if not rows:
        print("No rows found.")
        return 0

    import pandas as pd

    df = pd.DataFrame(rows[: args.limit] if args.limit else rows)
    business_cols = [c for c in df.columns if not c.startswith("_")]
    lineage_cols = [c for c in df.columns if c.startswith("_")]

    print("--- business columns ---")
    print(df[business_cols].to_string(index=False))
    print("\n--- lineage columns ---")
    print(df[lineage_cols].to_string(index=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
