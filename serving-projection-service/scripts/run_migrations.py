#!/usr/bin/env python
"""Applies sql/*.sql against api_serving. Mirrors data-publication-service's
scripts/run_migrations.py-equivalent entrypoint (metadata/migrations.py's
own `_cli()`)."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from serving_projection.metadata.migrations import _cli

if __name__ == "__main__":
    _cli()
