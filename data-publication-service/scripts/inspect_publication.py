#!/usr/bin/env python
"""Print a publication run's full lifecycle: run row, artifacts, quality
results, and event trail (AGENTS.md section 67 lineage demonstration)."""

from __future__ import annotations

import json
import sys
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import argparse

import sqlalchemy as sa

from publication.metadata.engine import get_engine


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Inspect a publication run.")
    parser.add_argument("publication_id")
    args = parser.parse_args(argv)

    engine = get_engine()
    with engine.connect() as conn:
        run = conn.execute(
            sa.text("SELECT * FROM publication.publication_runs WHERE publication_id = :id"),
            {"id": args.publication_id},
        ).mappings().first()
        artifacts = conn.execute(
            sa.text("SELECT * FROM publication.publication_artifacts WHERE publication_id = :id ORDER BY created_at"),
            {"id": args.publication_id},
        ).mappings().all()
        quality = conn.execute(
            sa.text("SELECT * FROM publication.publication_quality_results WHERE publication_id = :id ORDER BY evaluated_at"),
            {"id": args.publication_id},
        ).mappings().all()
        events = conn.execute(
            sa.text("SELECT * FROM publication.publication_events WHERE publication_id = :id ORDER BY occurred_at"),
            {"id": args.publication_id},
        ).mappings().all()

    if run is None:
        print(f"No publication found for publication_id={args.publication_id}", file=sys.stderr)
        return 1

    print(json.dumps({
        "run": dict(run),
        "artifacts": [dict(a) for a in artifacts],
        "quality_results": [dict(q) for q in quality],
        "events": [dict(e) for e in events],
    }, default=str, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
