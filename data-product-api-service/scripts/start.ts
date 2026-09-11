// Container entrypoint. No migrations to run here — this service never
// owns the serving-store schema (serving-projection-service does).
export {};

await import("../src/server.js");
