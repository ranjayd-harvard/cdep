import { env } from "@/config/env";

/**
 * Minimal fetch wrapper for the future HTTP service implementations.
 * Not used while NEXT_PUBLIC_USE_MOCK_SERVICES=true. Kept intentionally
 * thin — it exists to make the migration path from mocks to a real
 * middle-tier API obvious, not to anticipate its final shape.
 */
export async function httpGet<T>(path: string): Promise<T> {
  const response = await fetch(`${env.apiBaseUrl}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Request to ${path} failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function httpPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${env.apiBaseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Request to ${path} failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}
