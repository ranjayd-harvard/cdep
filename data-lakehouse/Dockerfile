FROM python:3.11-slim AS base

RUN groupadd --gid 1000 lakehouse \
    && useradd --uid 1000 --gid lakehouse --shell /bin/bash --create-home lakehouse

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md ./
COPY src ./src

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -e ".[dev]"

COPY config ./config
COPY contracts ./contracts
COPY sql ./sql
COPY scripts ./scripts
COPY samples ./samples
COPY tests ./tests

RUN chown -R lakehouse:lakehouse /app
USER lakehouse

ENTRYPOINT ["/bin/bash"]
