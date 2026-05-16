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

class NativeStorage implements TokenStorage {
  private mem = new MemoryStorage();

  getAccessToken(): string | null {
    return this.mem.getAccessToken();
  }

  setAccessToken(token: string): void {
    this.mem.setAccessToken(token);
    if (typeof globalThis !== 'undefined') {
      try {
        const SecureStore = (globalThis as Record<string, unknown>)[
          '__ExpoSecureStore'
        ] as
          | { setItemAsync: (k: string, v: string) => Promise<void> }
          | undefined;
        SecureStore?.setItemAsync(ACCESS_TOKEN_KEY, token).catch(() => {});
      } catch {
        // expo-secure-store not available — fall back to memory
      }
    }
  }

  removeAccessToken(): void {
    this.mem.removeAccessToken();
    if (typeof globalThis !== 'undefined') {
      try {
        const SecureStore = (globalThis as Record<string, unknown>)[
          '__ExpoSecureStore'
        ] as { deleteItemAsync: (k: string) => Promise<void> } | undefined;
        SecureStore?.deleteItemAsync(ACCESS_TOKEN_KEY).catch(() => {});
      } catch {
        // expo-secure-store not available — fall back to memory
      }
    }
  }

  getRefreshToken(): string | null {
    return this.mem.getRefreshToken();
  }

  setRefreshToken(token: string): void {
    this.mem.setRefreshToken(token);
    if (typeof globalThis !== 'undefined') {
      try {
        const SecureStore = (globalThis as Record<string, unknown>)[
          '__ExpoSecureStore'
        ] as
          | { setItemAsync: (k: string, v: string) => Promise<void> }
          | undefined;
        SecureStore?.setItemAsync(REFRESH_TOKEN_KEY, token).catch(() => {});
      } catch {
        // expo-secure-store not available — fall back to memory
      }
    }
  }

  removeRefreshToken(): void {
    this.mem.removeRefreshToken();
    if (typeof globalThis !== 'undefined') {
      try {
        const SecureStore = (globalThis as Record<string, unknown>)[
          '__ExpoSecureStore'
        ] as { deleteItemAsync: (k: string) => Promise<void> } | undefined;
        SecureStore?.deleteItemAsync(REFRESH_TOKEN_KEY).catch(() => {});
      } catch {
        // expo-secure-store not available — fall back to memory
      }
    }
  }

  clear(): void {
    this.mem.clear();
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
