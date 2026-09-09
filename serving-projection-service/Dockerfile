FROM python:3.11-slim AS base

RUN groupadd --gid 1000 serving \
    && useradd --uid 1000 --gid serving --shell /bin/bash --create-home serving

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md ./
COPY src ./src

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -e ".[dev]"

COPY sql ./sql
COPY scripts ./scripts
COPY tests ./tests

RUN chown -R serving:serving /app
USER serving

ENTRYPOINT ["/bin/bash"]
