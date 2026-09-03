/** Simulates network latency for mock service implementations. */
export function simulateLatency(ms = 200): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
