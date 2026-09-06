#!/usr/bin/env python
"""Thin CLI wrapper around lakehouse.ingestion.ingestion_runner, kept as a
top-level script for `make ingest-sample` / direct invocation convenience.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from lakehouse.ingestion.ingestion_runner import main

if __name__ == "__main__":
    sys.exit(main())
