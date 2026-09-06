.PHONY: up down logs venv install lint test ingest-sample inspect-bronze init-catalog reconcile api \
	run-silver-event run-gold-event-performance run-event-pipeline inspect-silver inspect-gold reconcile-pipelines

up:
	docker compose up -d postgres minio bucket-init

down:
	docker compose down

logs:
	docker compose logs -f

venv:
	python3 -m venv .venv
	.venv/bin/pip install --upgrade pip
	.venv/bin/pip install -e ".[dev]"

install: venv

lint:
	.venv/bin/ruff check src tests scripts

test:
	.venv/bin/pytest -q

init-catalog:
	.venv/bin/python scripts/initialize_catalog.py

ingest-sample:
	.venv/bin/python -m lakehouse.ingestion.ingestion_runner --exchange-id exc-example-001

inspect-bronze:
	.venv/bin/python scripts/inspect_bronze.py --table bronze.event_data \
		--organization org-vobis-org-722aea --tenant tenant-default-47d849

reconcile:
	.venv/bin/python -m lakehouse.ingestion.reconcile

api:
	.venv/bin/uvicorn lakehouse.api.app:app --reload --port 8000

# --- Phase 3: Bronze -> Silver -> Gold -------------------------------------

run-silver-event:
	.venv/bin/python scripts/run_bronze_to_silver.py --ingestion-id $(INGESTION_ID)

run-gold-event-performance:
	.venv/bin/python scripts/run_silver_to_gold.py --silver-run-id $(SILVER_RUN_ID) --product-id event-performance

run-event-pipeline:
	.venv/bin/python scripts/run_event_pipeline.py --ingestion-id $(INGESTION_ID)

inspect-silver:
	.venv/bin/python scripts/inspect_bronze.py --table silver.event --admin

inspect-gold:
	.venv/bin/python scripts/inspect_data_product.py --product event-performance \
		--organization org-vobis-org-722aea --tenant tenant-default-47d849

reconcile-pipelines:
	.venv/bin/python -m lakehouse.pipelines.reconciliation
