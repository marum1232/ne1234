import { getVendorApiBase } from "./envValidation";
import { createApiFetcher, RefreshError, createCircuitBreaker, CircuitOpenError } from "@workspace/api-client-react";
import { createAuthClient } from "@workspace/auth-react";
import { createLogger } from "@/lib/logger";
import { compressImage } from "./imageUtils";
const log = createLogger("[api]");

const BASE = getVendorApiBase();

const TOKEN_KEY   = "ajkmart_vendor_token";
const REFRESH_KEY = "ajkmart_vendor_refresh_token";

/* ── Token storage strategy ────────────────────────────────────────────────────
   Access and refresh tokens are stored in sessionStorage (survives page reload
   within the same tab; cleared when the tab closes) with an in-memory write-
   through cache so every read hits memory first.
   One-time migration: any token previously written to localStorage is promoted
   to sessionStorage and then erased from localStorage on first load.             */

/* ── Vendor token storage — sessionStorage-backed with in-memory cache ────────
   Tokens survive tab refreshes within a session (unlike pure in-memory) and are
   automatically cleared when the tab closes (unlike localStorage), matching the
   intended security profile for a vendor web app.
   Falls back to pure in-memory when sessionStorage is unavailable (e.g. private
   browsing in certain browsers, or SSR contexts). */
let _memAccessToken = "";
let _memRefreshToken = "";

const _tokenStorage = {
  getAccessToken(): string {
    if (_memAccessToken) return _memAccessToken;
    try { _memAccessToken = sessionStorage.getItem(TOKEN_KEY) ?? ""; } catch { }
    return _memAccessToken;
  },
  setAccessToken(v: string): void {
    _memAccessToken = v;
    try { sessionStorage.setItem(TOKEN_KEY, v); } catch { }
  },
  removeAccessToken(): void {
    _memAccessToken = "";
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { }
  },
  getRefreshToken(): string {
    if (_memRefreshToken) return _memRefreshToken;
    try { _memRefreshToken = sessionStorage.getItem(REFRESH_KEY) ?? ""; } catch { }
    return _memRefreshToken;
  },
  setRefreshToken(v: string): void {
    _memRefreshToken = v;
    try { sessionStorage.setItem(REFRESH_KEY, v); } catch { }
  },
  removeRefreshToken(): void {
    _memRefreshToken = "";
    try { sessionStorage.removeItem(REFRESH_KEY); } catch { }
  },
  clear(): void {
    _memAccessToken = "";
    _memRefreshToken = "";
    try { sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(REFRESH_KEY); } catch { }
  },
};

/* One-time migration: promote any localStorage tokens into sessionStorage, then purge localStorage. */
try {
  if (typeof localStorage !== "undefined") {
    const legacyAccess  = localStorage.getItem(TOKEN_KEY);
    const legacyRefresh = localStorage.getItem(REFRESH_KEY);
    if (legacyAccess)  { _tokenStorage.setAccessToken(legacyAccess);  localStorage.removeItem(TOKEN_KEY); }
    if (legacyRefresh) { _tokenStorage.setRefreshToken(legacyRefresh); localStorage.removeItem(REFRESH_KEY); }
    /* Sweep any other vendor auth keys left by older bundles. */
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith("vendor_") || k.startsWith("ajkmart_vendor"))) keysToRemove.push(k);
    }
    keysToRemove.forEach(k => { try { localStorage.removeItem(k); } catch (err) { console.warn('[artifacts/vendor-app/src/lib/api.ts]', err); } }); // eslint-disable-line no-console
  }
} catch (err) { console.warn('[artifacts/vendor-app/src/lib/api.ts]', err); } // eslint-disable-line no-console

export function getTokenStorage() { return _tokenStorage; }
function getToken(): string  { return _tokenStorage.getAccessToken() ?? ""; }
function getRefreshToken(): string { return _tokenStorage.getRefreshToken() ?? ""; }

/* ── Shared auth client (createAuthClient from @workspace/auth-react) ─────────
   Provides a typed HTTP client with automatic bearer-injection and token
   refresh, consumed by LoginScreen / useLoginFlow via the shared AuthContext.
   The bespoke apiFetch below is kept for vendor-specific flows (CSRF, circuit
   breaker, 5xx retry). Both clients share the same _tokenStorage instance.    */
export const authClient = createAuthClient({
  baseURL: BASE,
  tokenStorage: _tokenStorage,
  onUnauthorized: () => triggerLogout("unauthorized"),
  /* refreshEndpoint is relative to baseURL (BASE already includes /api path prefix) */
  refreshEndpoint: "/auth/refresh",
});

/** Read the CSRF token from the csrf_token cookie (set by the server). */
function readCsrfFromCookie(): string {
  try {
    const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  } catch { return ""; }
}

/* ── authPost ─────────────────────────────────────────────────────────────────
   Routes authentication API calls (login, register, OTP, social login) through
   a direct fetch() rather than authClient, because:
     1. Auth endpoints never return 401 — they ARE the auth endpoints, so they
        don't need 401→refresh handling.
     2. This makes _vendorFetcher the sole owner of token refresh, eliminating
        the race condition between authClient and _vendorFetcher both attempting
        a concurrent /auth/refresh call when a session expires.
   CSRF header is included so the server's csrf middleware accepts the request. */
async function authPost(path: string, body?: unknown): Promise<unknown> {
  /* Circuit breaker guard */
  try { _circuitBreaker.check(path); } catch (err) {
    if (err instanceof CircuitOpenError) {
      const coe = err as CircuitOpenError;
      const retryS = Math.ceil(coe.retryAfterMs / 1000);
      throw Object.assign(
        new Error(`Service temporarily unavailable. Please try again in ${retryS}s.`),
        { status: 503, transient: true, circuitOpen: true }
      );
    }
    throw err;
  }
  const csrfToken = readCsrfFromCookie();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    _circuitBreaker.onSuccess(path);
  } catch (err: unknown) {
    _circuitBreaker.onFailure(path);
    throw Object.assign(new Error("Network error — please check your connection"), { status: 0, transient: true });
  }

  /* Parse the JSON response body regardless of status */
  let parsed: { data?: unknown; error?: string; message?: string; pendingApproval?: boolean; rejected?: boolean; approvalNote?: string } = {};
  try { parsed = await res.json() as typeof parsed; } catch { /* non-JSON body */ }

  if (!res.ok) {
    const status = res.status;
    if (parsed.pendingApproval) throw Object.assign(new Error(parsed.error || "Pending approval"), { status, pendingApproval: true });
    if (parsed.rejected)        throw Object.assign(new Error(parsed.error || "Application rejected"), { status, rejected: true, approvalNote: parsed.approvalNote });
    throw Object.assign(new Error(parsed.error || parsed.message || `Request failed (${status})`), { status });
  }

  /* Unwrap server envelope { data: T } → T, or return the raw parsed body */
  return parsed != null && typeof parsed === "object" && "data" in parsed ? parsed.data : parsed;
}

function clearTokens() {
  _tokenStorage.clear();
  try { localStorage.removeItem(REFRESH_KEY); } catch (err) { console.warn('[artifacts/vendor-app/src/lib/api.ts]', err); } // eslint-disable-line no-console
}

/* ── Module-level logout callback ─────────────────────────────────────────────
   The auth context registers this callback at mount time so apiFetch can
   trigger a logout directly without relying on CustomEvent alone. */
let _logoutCallback: (() => void) | null = null;

export function registerLogoutCallback(fn: () => void): () => void {
  _logoutCallback = fn;
  return () => { if (_logoutCallback === fn) _logoutCallback = null; };
}

function triggerLogout(reason: string) {
  clearTokens();
  if (_logoutCallback) _logoutCallback();
  try { window.dispatchEvent(new CustomEvent("ajkmart:logout", { detail: { reason } })); } catch (err) { console.warn('[artifacts/vendor-app/src/lib/api.ts]', err); } // eslint-disable-line no-console
}

/* ── Configurable network settings ────────────────────────────────────────────
   Updated at startup from the platform config. Defaults match the previously
   hardcoded value (30 s) so existing behaviour is preserved. */
let _apiTimeoutMs = 30_000;

export function setApiTimeoutMs(ms: number): void {
  if (Number.isFinite(ms) && ms > 0) _apiTimeoutMs = Math.min(ms, 300_000);
}

/* ── Per-endpoint circuit breaker ─────────────────────────────────────────────
   Opens after 3 consecutive 5xx failures on the same endpoint (once all
   built-in retries are exhausted). Rejects new requests for 30 s to stop
   hammering a degraded server. After cooldown it allows one probe request; on
   success the circuit closes again, on failure the cooldown resets.           */
const CB_DEFAULT_RETRIES = 3;
const _circuitBreaker = createCircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 });

/* ── Shared API fetcher (createApiFetcher factory) ────────────────────────────
   Centralises: Bearer injection, timeout, 401→refresh (mutex)→retry.
   Callbacks close over module-level vars so they always reflect current state.
   _vendorRefresh exposes the mutex-guarded refresh for api.refreshToken. */
const [_vendorFetcher, _vendorRefresh] = createApiFetcher({
  baseUrl: BASE,
  getToken: () => _tokenStorage.getAccessToken(),
  setToken: (token: string) => { _tokenStorage.setAccessToken(token); },
  getRefreshToken: () => _tokenStorage.getRefreshToken() ?? "",
  setRefreshToken: (token: string) => { _tokenStorage.setRefreshToken(token); },
  onRefreshFailed: (isTransient: boolean) => {
    if (!isTransient) triggerLogout("session_expired");
  },
  refreshEndpoint: `${BASE}/auth/refresh`,
  extraRefreshHeaders: () => ({ "X-App": "vendor" }),
  timeoutMs: () => _apiTimeoutMs,
  credentialsMode: "include",
});

export async function apiFetch(path: string, opts: RequestInit & { _timeoutMs?: number } = {}, _5xxRetries = CB_DEFAULT_RETRIES): Promise<any> {
  /* Guard: reject immediately if this endpoint's circuit is open.
     Only checked on the initial call — recursive retries bypass this so they
     can attempt the back-off sequence before the circuit actually records a
     failure.  CircuitOpenError is converted to the standard error shape so
     existing catch blocks that inspect { status, transient } still work. */
  if (_5xxRetries === CB_DEFAULT_RETRIES) {
    try {
      _circuitBreaker.check(path);
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        const coe = err as CircuitOpenError;
        const retryS = Math.ceil(coe.retryAfterMs / 1000);
        throw Object.assign(
          new Error(`Service temporarily unavailable. Please try again in ${retryS}s.`),
          { status: 503, transient: true, circuitOpen: true }
        );
      }
      throw err;
    }
  }

  const isFormData = opts.body instanceof FormData;
  const method = (opts.method ?? "GET").toUpperCase();
  const isStateMutating = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  const csrfToken = isStateMutating ? readCsrfFromCookie() : "";
  const mergedOpts: RequestInit & { _timeoutMs?: number } = {
    ...opts,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      ...(opts.headers as Record<string, string> || {}),
    },
  };

  let res: Response;
  try {
    res = await _vendorFetcher(path, mergedOpts);
  } catch (err: unknown) {
    if (err instanceof RefreshError) {
      const re = err as RefreshError;
      if (re.isTransient) {
        /* Transient refresh failure (network/5xx) — keep tokens, surface recoverable error */
        throw Object.assign(
          new Error("Connection issue. Please check your network and try again."),
          { status: 0, transient: true }
        );
      }
      /* auth_failed — triggerLogout already called via onRefreshFailed */
      throw Object.assign(
        new Error("Session expired. Please log in again."),
        { status: 401 }
      );
    }
    /* Re-throw AbortError unchanged so callers can detect request cancellation */
    if (err instanceof Error && err.name === "AbortError") throw err;
    /* Network-level failure (offline, timeout) — never log out for this */
    throw Object.assign(new Error("Network error. Please check your connection and try again."), { status: 0, transient: true });
  }

  /* ── 5xx exponential-backoff retry (3 attempts: 1 s / 2 s / 4 s) ────────
     Server errors are transient by nature; retrying after a short back-off
     recovers from momentary overloads without surfacing noise to the user.
     Only 5xx is retried — 4xx errors reflect client-side problems and should
     not be retried.  401 / 403 have their own dedicated handling below.    */
  if (res.status >= 500 && _5xxRetries > 0) {
    const attempt  = 4 - _5xxRetries;                  // 1, 2, 3
    const delayMs  = 1000 * Math.pow(2, attempt - 1);  // 1 s, 2 s, 4 s
    log.debug(`5xx retry ${attempt}/3 for ${path} (status ${res.status}) — waiting ${delayMs}ms`);
    await new Promise(r => setTimeout(r, delayMs));
    return apiFetch(path, opts, _5xxRetries - 1);
  }

  if (!res.ok) {
    /* Record a circuit-breaker failure once all 5xx retries are exhausted.
       4xx errors reflect client problems, not server overload, so they are
       deliberately excluded — only sustained 5xx responses open the circuit. */
    if (res.status >= 500) _circuitBreaker.onFailure(path);
    if (res.status === 403) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      if (err.pendingApproval) {
        throw Object.assign(new Error(err.error || "Pending approval"), { status: 403, pendingApproval: true });
      }
      if (err.rejected) {
        throw Object.assign(new Error(err.error || "Application rejected"), { status: 403, rejected: true, approvalNote: err.approvalNote });
      }
      const msg = err.error || "";
      /* code may live at top level OR inside err.data (sendErrorWithData envelope) */
      const code = err.code || (err.data as Record<string, unknown> | undefined)?.code as string || "";
      /* APPROVAL_PENDING and APPROVAL_REJECTED are NOT auth failures — do not force logout */
      const AUTH_DENY_CODES = ["AUTH_REQUIRED", "ROLE_DENIED", "TOKEN_INVALID", "TOKEN_EXPIRED", "ACCOUNT_BANNED"];
      const AUTH_DENY_PHRASES = ["access denied", "forbidden", "unauthorized", "authentication required", "token invalid", "token expired"];
      const isAuthDenial =
        AUTH_DENY_CODES.includes(code) ||
        AUTH_DENY_PHRASES.some(p => msg.toLowerCase().startsWith(p));
      if (isAuthDenial) {
        triggerLogout("access_denied");
      }
      throw Object.assign(new Error(msg || "Access denied"), { status: 403, code });
    }
    const err = await res.json().catch(() => ({ error: res.statusText }));
    try {
      const { reportApiError } = await import("./error-reporter");
      reportApiError(path, res.status, err.error || "Request failed");
    } catch (err) { console.warn('[artifacts/vendor-app/src/lib/api.ts]', err); } // eslint-disable-line no-console
    throw new Error(err.error || "Request failed");
  }
  const json = await res.json();
  /* Successful response — reset the failure counter for this endpoint so a
     future transient 5xx burst starts counting from zero again. */
  _circuitBreaker.onSuccess(path);
  return json.data !== undefined ? json.data : json;
}

export const api = {
  /* Auth — core auth calls route through authClient (bearer + auto-refresh)
     with circuit-breaker and envelope-unwrapping via authPost().
     logout and refreshToken keep their original apiFetch / _vendorRefresh paths
     because they need the special HttpOnly-cookie / X-App header handling. */
  sendOtp:      (phone: string, preferredChannel?: string, captchaToken?: string) =>
    authPost("/auth/send-otp", { phone, ...(preferredChannel ? { preferredChannel } : {}), ...(captchaToken ? { captchaToken } : {}) }),
  verifyOtp:    (phone: string, otp: string, deviceFingerprint?: string, role?: string) =>
    authPost("/auth/verify-otp", { phone, otp, ...(role ? { role } : {}), ...(deviceFingerprint ? { deviceFingerprint } : {}) }),
  sendEmailOtp: (email: string, captchaToken?: string) =>
    authPost("/auth/send-email-otp", { email, ...(captchaToken ? { captchaToken } : {}) }),
  verifyEmailOtp:(email: string, otp: string, deviceFingerprint?: string) =>
    authPost("/auth/verify-email-otp", { email, otp, role: "vendor", ...(deviceFingerprint ? { deviceFingerprint } : {}) }),
  loginUsername:(identifier: string, password: string, deviceFingerprint?: string, captchaToken?: string) =>
    authPost("/auth/login", { identifier, password, role: "vendor", ...(deviceFingerprint ? { deviceFingerprint } : {}), ...(captchaToken ? { captchaToken } : {}) }),
  forgotPassword:(data: { phone?: string; email?: string; identifier?: string }) =>
    authPost("/auth/forgot-password", data),
  resetPassword:(data: { phone?: string; email?: string; identifier?: string; otp: string; newPassword: string; totpCode?: string }) =>
    authPost("/auth/reset-password", data),
  logout:       (refreshToken?: string) => apiFetch("/auth/logout", { method: "POST", headers: { "X-App": "vendor" }, body: JSON.stringify({ refreshToken }) }).finally(clearTokens),
  refreshToken: () => _vendorRefresh(),
  checkAvailable: (data: { phone?: string; email?: string; username?: string }, signal?: AbortSignal) =>
    apiFetch("/auth/check-available", { method: "POST", body: JSON.stringify(data), signal }),
  vendorRegister: (data: { phone?: string; email?: string; storeName: string; storeCategory?: string; name?: string; cnic?: string; address?: string; city?: string; bankName?: string; bankAccount?: string; bankAccountTitle?: string; username?: string; acceptedTermsVersion?: string; documents?: string; otp?: string; password?: string }) =>
    authPost("/auth/vendor-register", data),
  socialGoogle: (data: { idToken: string }) =>
    authPost("/auth/social/google", { ...data, role: "vendor" }),
  socialFacebook: (data: { accessToken: string }) =>
    authPost("/auth/social/facebook", { ...data, role: "vendor" }),
  magicLinkSend: (email: string) =>
    authPost("/auth/magic-link/send", { email }),
  magicLinkVerify: (data: { token: string }) =>
    authPost("/auth/magic-link/verify", data),

  /* Token helpers */
  storeTokens: (token: string, refreshToken?: string) => {
    /* Update the shared _tokenStorage — both authClient and _vendorFetcher
       read from the same object, so a single write syncs both clients.
       No separate authClient.setAccessToken() call needed: authClient was
       constructed with `tokenStorage: _tokenStorage` and reads the live value
       on every request rather than caching it internally. */
    _tokenStorage.setAccessToken(token);
    if (refreshToken) _tokenStorage.setRefreshToken(refreshToken);
  },
  clearTokens,
  getToken,
  getRefreshToken,
  registerLogoutCallback,

  /* Profile */
  getMe:         (signal?: AbortSignal) => apiFetch("/vendors/me", signal ? { signal } : {}),
  updateProfile: (data: Record<string, string | undefined>) => apiFetch("/vendors/profile", { method: "PATCH", body: JSON.stringify(data) }),
  getQuickReplies:    () => apiFetch("/vendors/profile/quick-replies"),
  updateQuickReplies: (quickReplies: string[]) => apiFetch("/vendors/profile/quick-replies", { method: "PATCH", body: JSON.stringify({ quickReplies }) }),

  /* Store management */
  getStore:      () => apiFetch("/vendors/store"),
  updateStore:   (data: any) => apiFetch("/vendors/store", { method: "PATCH", body: JSON.stringify(data) }),

  /* Stats & Analytics */
  getStats:      () => apiFetch("/vendors/stats"),
  getAnalytics:  (days?: number) => apiFetch(`/vendors/analytics${days ? `?days=${days}` : ""}`),
  getAnalyticsRange: (from: string, to: string) => apiFetch(`/vendors/analytics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),

  /* Orders */
  getOrders:     (status?: string) => apiFetch(`/vendors/orders${status ? `?status=${status}` : ""}`),
  getVendorOrder: (id: string) => apiFetch(`/vendors/orders/${id}`),
  updateOrder:   (id: string, status: string, reason?: string) => apiFetch(`/vendors/orders/${id}/status`, { method: "PATCH", body: JSON.stringify({ status, ...(reason ? { reason } : {}) }) }),

  /* Products */
  getProducts:   (q?: string, category?: string) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (category && category !== "all") params.set("category", category);
    const qs = params.toString();
    return apiFetch(`/vendors/products${qs ? `?${qs}` : ""}`);
  },
  createProduct:  (data: any) => apiFetch("/vendors/products", { method: "POST", body: JSON.stringify(data) }),
  bulkAddProducts:(products: any[]) => apiFetch("/vendors/products/bulk", { method: "POST", body: JSON.stringify({ products }) }),
  bulkEditProducts:(products: Array<{ id: string; price?: number; stock?: number | null }>) => apiFetch("/vendors/products/bulk", { method: "PATCH", body: JSON.stringify({ products }) }),
  updateProduct:  (id: string, data: any) => apiFetch(`/vendors/products/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteProduct:  (id: string) => apiFetch(`/vendors/products/${id}`, { method: "DELETE" }),
  getProductStockHistory: (id: string) => apiFetch(`/vendors/products/${id}/stock-history`),

  /* Promos */
  getPromos:     () => apiFetch("/vendors/promos"),
  createPromo:   (data: any) => apiFetch("/vendors/promos", { method: "POST", body: JSON.stringify(data) }),
  updatePromo:   (id: string, data: any) => apiFetch(`/vendors/promos/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  togglePromo:   (id: string) => apiFetch(`/vendors/promos/${id}/toggle`, { method: "PATCH", body: "{}" }),
  deletePromo:   (id: string) => apiFetch(`/vendors/promos/${id}`, { method: "DELETE" }),

  /* Reviews */
  getReviews:    (vendorId: string) => apiFetch(`/reviews/vendor/${vendorId}`),
  getVendorReviews: (params?: { page?: number; limit?: number; stars?: string; sort?: string }) => {
    const q = new URLSearchParams();
    if (params?.page)  q.set("page",  String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.stars) q.set("stars", params.stars);
    if (params?.sort)  q.set("sort",  params.sort);
    return apiFetch(`/vendors/reviews?${q.toString()}`);
  },
  getPublicReviews:    (vendorId: string) => apiFetch(`/reviews/vendor/${vendorId}`),
  postVendorReply:     (reviewId: string, reply: string) => apiFetch(`/reviews/${reviewId}/vendor-reply`, { method: "POST", body: JSON.stringify({ reply }) }),
  updateVendorReply:   (reviewId: string, reply: string) => apiFetch(`/reviews/${reviewId}/vendor-reply`, { method: "PUT", body: JSON.stringify({ reply }) }),
  deleteVendorReply:   (reviewId: string) => apiFetch(`/reviews/${reviewId}/vendor-reply`, { method: "DELETE" }),

  /* Wallet */
  getWallet:      () => apiFetch("/vendors/wallet/transactions"),
  withdrawWallet: (data: { amount: number; bankName: string; accountNumber: string; accountTitle: string; note?: string }) =>
    apiFetch("/vendors/wallet/withdraw", { method: "POST", body: JSON.stringify(data) }),
  depositWallet: (data: { amount: number; paymentMethod: string; paymentReference: string; note?: string }) =>
    apiFetch("/vendors/wallet/deposit", { method: "POST", body: JSON.stringify(data) }),

  /* Image Upload */
  uploadImage: async (file: File): Promise<{ url: string }> => {
    const compressed = await compressImage(file);
    const formData = new FormData();
    formData.append("file", compressed);
    const result = await apiFetch("/uploads", { method: "POST", body: formData });
    return { url: result.url };
  },

  uploadRegistrationDoc: async (file: File): Promise<{ url: string }> => {
    /* Step 1: obtain a short-lived upload session nonce bound to this onboarding flow. */
    const tokenRes = await apiFetch("/uploads/register-token", { method: "POST" });
    const uploadToken: string = tokenRes?.token ?? "";
    if (!uploadToken) throw new Error("Failed to obtain upload session token");
    /* Step 2: compress, then upload with the token header. */
    const compressed = await compressImage(file);
    const formData = new FormData();
    formData.append("file", compressed, file.name || "document.jpg");
    const result = await apiFetch("/uploads/register", {
      method: "POST",
      body: formData,
      headers: { "x-upload-token": uploadToken },
    });
    return { url: result.url ?? result.fileUrl ?? result.path ?? "" };
  },

  uploadAudio: async (file: File): Promise<{ url: string }> => {
    const formData = new FormData();
    formData.append("file", file);
    const result = await apiFetch("/uploads/audio", { method: "POST", body: formData });
    return { url: result.url };
  },

  uploadVideo: async (file: File): Promise<{ url: string }> => {
    const formData = new FormData();
    formData.append("file", file);
    /* Disable the default timeout for large video uploads; the factory still
       handles token refresh and retry automatically. */
    const result = await apiFetch("/uploads/video", {
      method: "POST",
      body: formData,
      _timeoutMs: 0,
    });
    return { url: result.url };
  },

  /* Location */
  getLocation:       (userId: string) => apiFetch(`/locations/${userId}`),
  updateLocation:    (data: { latitude: number; longitude: number; role: string }) => apiFetch("/locations/update", { method: "POST", body: JSON.stringify(data) }),

  /* Rider assignment */
  getAvailableRiders: (lat: number | null, lng: number | null, maxKm = 10) => {
    const params = new URLSearchParams({ maxKm: String(maxKm) });
    if (lat !== null && lng !== null) { params.set("lat", String(lat)); params.set("lng", String(lng)); }
    return apiFetch(`/vendors/orders/available-riders?${params}`);
  },
  getOrderAvailableRiders: (orderId: string) =>
    apiFetch(`/vendors/orders/${orderId}/available-riders`),
  assignRider:        (orderId: string, riderId: string) => apiFetch(`/vendors/orders/${orderId}/assign-rider`, { method: "POST", body: JSON.stringify({ riderId }) }),
  autoAssignRider:    (orderId: string) => apiFetch(`/vendors/orders/${orderId}/auto-assign`, { method: "POST", body: JSON.stringify({}) }),

  /* Delivery Access */
  getDeliveryAccessStatus: () => apiFetch("/vendors/delivery-access/status"),
  requestDeliveryAccess:   (data: { serviceType?: string; reason?: string }) => apiFetch("/vendors/delivery-access/request", { method: "POST", body: JSON.stringify(data) }),

  /* Weekly Schedule */
  getSchedule:     () => apiFetch("/vendors/schedule"),
  updateSchedule:  (schedule: Array<{ dayOfWeek: number; openTime: string; closeTime: string; isEnabled: boolean }>) =>
    apiFetch("/vendors/schedule", { method: "PUT", body: JSON.stringify({ schedule }) }),

  /* Notifications */
  getNotifications:  () => apiFetch("/vendors/notifications"),
  markAllRead:       () => apiFetch("/vendors/notifications/read-all", { method: "PATCH", body: "{}" }),
  markNotificationRead: (id: string) => apiFetch(`/vendors/notifications/${id}/read`, { method: "PATCH", body: "{}" }),

  /* Settings */
  getSettings:    () => apiFetch("/settings"),
  updateSettings: (data: Record<string, unknown>) => apiFetch("/settings", { method: "PUT", body: JSON.stringify(data) }),

  /* Test notification */
  testNotification: () => apiFetch("/vendors/test-notification", { method: "POST", body: "{}" }),
};
