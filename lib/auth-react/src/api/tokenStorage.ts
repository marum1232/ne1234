export interface TokenStorage {
  getAccessToken(): string | null;
  setAccessToken(token: string): void;
  removeAccessToken(): void;
  getRefreshToken(): string | null;
  setRefreshToken(token: string): void;
  removeRefreshToken(): void;
  clear(): void;
}

const ACCESS_TOKEN_KEY = 'ajk_access_token';
const REFRESH_TOKEN_KEY = 'ajk_refresh_token';

class MemoryStorage implements TokenStorage {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  getAccessToken(): string | null {
    return this.accessToken;
  }

  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  removeAccessToken(): void {
    this.accessToken = null;
  }

  getRefreshToken(): string | null {
    return this.refreshToken;
  }

  setRefreshToken(token: string): void {
    this.refreshToken = token;
  }

  removeRefreshToken(): void {
    this.refreshToken = null;
  }

  clear(): void {
    this.accessToken = null;
    this.refreshToken = null;
  }
}

class WebStorage implements TokenStorage {
  private store: Storage;

  constructor(type: 'session' | 'local' = 'session') {
    if (typeof window === 'undefined') {
      throw new Error('WebStorage is only available in browser environments');
    }
    this.store = type === 'local' ? window.localStorage : window.sessionStorage;
  }

  getAccessToken(): string | null {
    return this.store.getItem(ACCESS_TOKEN_KEY);
  }

  setAccessToken(token: string): void {
    this.store.setItem(ACCESS_TOKEN_KEY, token);
  }

  removeAccessToken(): void {
    this.store.removeItem(ACCESS_TOKEN_KEY);
  }

  getRefreshToken(): string | null {
    return this.store.getItem(REFRESH_TOKEN_KEY);
  }

  setRefreshToken(token: string): void {
    this.store.setItem(REFRESH_TOKEN_KEY, token);
  }

  removeRefreshToken(): void {
    this.store.removeItem(REFRESH_TOKEN_KEY);
  }

  clear(): void {
    this.store.removeItem(ACCESS_TOKEN_KEY);
    this.store.removeItem(REFRESH_TOKEN_KEY);
  }
}

type ExpoSecureStoreApi = {
  getItemAsync: (k: string) => Promise<string | null>;
  setItemAsync: (k: string, v: string) => Promise<void>;
  deleteItemAsync: (k: string) => Promise<void>;
};

function getSecureStore(): ExpoSecureStoreApi | undefined {
  if (typeof globalThis === 'undefined') return undefined;
  return (globalThis as Record<string, unknown>)[
    '__ExpoSecureStore'
  ] as ExpoSecureStoreApi | undefined;
}

class NativeStorage implements TokenStorage {
  private mem = new MemoryStorage();

  /**
   * Restore tokens from expo-secure-store into the in-memory cache.
   * Call this once at app startup (e.g. inside the AuthProvider's useEffect)
   * before any getAccessToken / getRefreshToken calls, so the synchronous
   * getters return the persisted values rather than null.
   *
   * Safe to call multiple times — subsequent calls are no-ops if tokens
   * are already cached in memory.
   */
  async restoreFromSecureStore(): Promise<void> {
    const ss = getSecureStore();
    if (!ss) return;
    try {
      const [access, refresh] = await Promise.all([
        ss.getItemAsync(ACCESS_TOKEN_KEY).catch(() => null),
        ss.getItemAsync(REFRESH_TOKEN_KEY).catch(() => null),
      ]);
      if (access && !this.mem.getAccessToken()) this.mem.setAccessToken(access);
      if (refresh && !this.mem.getRefreshToken()) this.mem.setRefreshToken(refresh);
    } catch {
      // SecureStore unavailable on this device — memory-only fallback is fine
    }
  }

  getAccessToken(): string | null {
    return this.mem.getAccessToken();
  }

  setAccessToken(token: string): void {
    this.mem.setAccessToken(token);
    getSecureStore()?.setItemAsync(ACCESS_TOKEN_KEY, token).catch(() => {});
  }

  removeAccessToken(): void {
    this.mem.removeAccessToken();
    getSecureStore()?.deleteItemAsync(ACCESS_TOKEN_KEY).catch(() => {});
  }

  getRefreshToken(): string | null {
    return this.mem.getRefreshToken();
  }

  setRefreshToken(token: string): void {
    this.mem.setRefreshToken(token);
    getSecureStore()?.setItemAsync(REFRESH_TOKEN_KEY, token).catch(() => {});
  }

  removeRefreshToken(): void {
    this.mem.removeRefreshToken();
    getSecureStore()?.deleteItemAsync(REFRESH_TOKEN_KEY).catch(() => {});
  }

  clear(): void {
    this.mem.clear();
    getSecureStore()?.deleteItemAsync(ACCESS_TOKEN_KEY).catch(() => {});
    getSecureStore()?.deleteItemAsync(REFRESH_TOKEN_KEY).catch(() => {});
  }
}

export type StorageType = 'web' | 'web-local' | 'native' | 'memory';

export function createTokenStorage(type: StorageType = 'web'): TokenStorage {
  switch (type) {
    case 'web':
      return new WebStorage('session');
    case 'web-local':
      return new WebStorage('local');
    case 'native':
      return new NativeStorage();
    case 'memory':
    default:
      return new MemoryStorage();
  }
}

/**
 * Create a NativeStorage instance and immediately restore persisted tokens
 * from expo-secure-store into the in-memory cache.
 *
 * Use this in the Expo app instead of `createTokenStorage('native')` so that
 * synchronous `getAccessToken()` / `getRefreshToken()` calls return the
 * correct values from the very first render.
 *
 * @example
 *   const storage = await createNativeTokenStorage();
 *   // storage.getAccessToken() now returns the persisted token (if any)
 */
export async function createNativeTokenStorage(): Promise<TokenStorage> {
  const storage = new NativeStorage();
  await storage.restoreFromSecureStore();
  return storage;
}
