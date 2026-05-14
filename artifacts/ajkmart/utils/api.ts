import { createLogger } from "@/utils/logger";
const log = createLogger("[API]");

const domain = process.env.EXPO_PUBLIC_DOMAIN;
if (!domain) {
  log.error(
    "FATAL: EXPO_PUBLIC_DOMAIN is not set. All API calls will fail. " +
      "Set this environment variable to your Replit dev domain before building.",
  );
}
export const API_BASE = domain ? `https://${domain}/api` : "";

/**
 * Socket.io base URL (no /api suffix). Derives safely from API_BASE.
 */
export const SOCKET_BASE = API_BASE ? API_BASE.replace(/\/api$/, "") : "";

/**
 * Authenticated API request helper. Injects the Bearer token into headers and
 * unwraps the standard `{ success, data }` envelope. Throws on non-2xx responses.
 */
export async function apiRequest<T = Record<string, unknown>>(
  path: string,
  opts: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token, ...fetchOpts } = opts;
  const isFormData = fetchOpts.body instanceof FormData;
  const res = await fetch(`${API_BASE}${path}`, {
    ...fetchOpts,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((fetchOpts.headers as Record<string, string> | undefined) ?? {}),
    },
  });
  if (!res.ok) {
    // eslint-disable-next-line ajk-local/no-silent-catch -- error body parse failure falls back to status-code message
    const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error(String(d["error"] ?? `Request failed (${res.status})`));
  }
  return unwrapApiResponse<T>(await res.json());
}

export function unwrapApiResponse<T = Record<string, unknown>>(
  json: unknown,
): T {
  // Validate input is an object
  if (!json || typeof json !== "object") {
    log.error("API response is not an object:", json);
    throw new Error(`Invalid API response type: ${typeof json}`);
  }

  const obj = json as Record<string, unknown>;

  // Validate response structure
  if (obj.success === true) {
    if (!obj.hasOwnProperty("data")) {
      log.error("API response has success=true but no data field");
      throw new Error("API response missing data field");
    }
    return obj.data as T;
  }

  // If not successful, log and throw
  if (obj.success === false) {
    log.error("API returned success=false:", obj.error || obj.message);
    throw new Error(
      `API error: ${obj.error || obj.message || "Unknown error"}`,
    );
  }

  // If no success field, return as-is but validate it's an object
  return obj as T;
}
