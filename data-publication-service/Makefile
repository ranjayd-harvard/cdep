.PHONY: up down migrate publish reconcile test unit-test lint

up:
	docker compose up -d postgres
	docker compose run --rm runner python -m publication.metadata.migrations

down:
	docker compose down

migrate:
	docker compose run --rm runner python -m publication.metadata.migrations

publish:
	docker compose run --rm runner python scripts/publish_gold_product.py $(ARGS)

reconcile:
	docker compose run --rm runner python scripts/reconcile_publications.py

test:
	docker compose run --rm runner python -m pytest

unit-test:
	docker compose run --rm runner python -m pytest tests/unit

lint:
	docker compose run --rm runner python -m ruff check src tests scripts
