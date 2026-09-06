-- Extensions required by the Exchange Control Database.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Dedicated schema for all exchange control-plane data.
CREATE SCHEMA IF NOT EXISTS exchange;
