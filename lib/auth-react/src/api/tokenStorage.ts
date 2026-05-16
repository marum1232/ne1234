export interface TokenStorage {
  getAccessToken(): string | null;
  setAccessToken(token: string): void;
  removeAccessToken(): void;
}

const ACCESS_TOKEN_KEY = 'ajk_access_token';

class MemoryStorage implements TokenStorage {
  private token: string | null = null;

  getAccessToken(): string | null {
    return this.token;
  }

  setAccessToken(token: string): void {
    this.token = token;
  }

  removeAccessToken(): void {
    this.token = null;
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
}

class NativeStorage implements TokenStorage {
  private mem = new MemoryStorage();

  getAccessToken(): string | null {
    if (typeof globalThis !== 'undefined' && 'ExpoModulesCore' in globalThis) {
      return this.mem.getAccessToken();
    }
    return this.mem.getAccessToken();
  }

  setAccessToken(token: string): void {
    this.mem.setAccessToken(token);
    if (typeof globalThis !== 'undefined') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
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
