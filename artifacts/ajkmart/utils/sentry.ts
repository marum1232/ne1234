/**
 * Sentry error monitoring — Web-only for Expo.
 * For native mobile, use @sentry/react-native with the expo plugin.
 *
 * SDK version is read from EXPO_PUBLIC_SENTRY_SDK_VERSION (default "8.55.0").
 * To pin a specific version set the env var in your build environment.
 */
import { Platform } from "react-native";
import { createLogger } from "@/utils/logger";
const log = createLogger("[Sentry]");

let _initialized = false;

declare global {
  interface Window {
    Sentry?: {
      init: (opts: Record<string, unknown>) => void;
      captureException: (err: unknown) => void;
      setUser: (user: { id?: string; email?: string } | null) => void;
    };
  }
}

export async function initSentry(
  dsn: string,
  environment: string,
  sampleRate: number,
): Promise<void> {
  if (!dsn || _initialized || Platform.OS !== "web") return;
  _initialized = true;

  const sdkVersion =
    (process.env.EXPO_PUBLIC_SENTRY_SDK_VERSION ?? "").trim() || "8.55.0";

  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = `https://browser.sentry-cdn.com/${sdkVersion}/bundle.min.js`;
    script.crossOrigin = "anonymous";
    script.onload = () => {
      try {
        window.Sentry?.init({
          dsn,
          environment: environment || "production",
          sampleRate: sampleRate ?? 1.0,
          tracesSampleRate: 0.1,
        });
      } catch (e) {
        log.warn("init error:", e);
      }
      resolve();
    };
    script.onerror = () => {
      _initialized = false;
      resolve();
    };
    document.head.appendChild(script);
  });
}

export function captureError(err: unknown): void {
  if (!_initialized || Platform.OS !== "web") return;
  window.Sentry?.captureException(err);
}

export function setSentryUser(id: string, email?: string): void {
  if (!_initialized || Platform.OS !== "web") return;
  window.Sentry?.setUser({ id, email });
}

export function clearSentryUser(): void {
  if (!_initialized || Platform.OS !== "web") return;
  window.Sentry?.setUser(null);
}
