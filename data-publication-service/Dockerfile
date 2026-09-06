FROM python:3.11-slim AS base

RUN groupadd --gid 1000 publication \
    && useradd --uid 1000 --gid publication --shell /bin/bash --create-home publication

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
COPY tests ./tests

RUN mkdir -p /app/publication-work && chown -R publication:publication /app
USER publication

ENTRYPOINT ["/bin/bash"]
