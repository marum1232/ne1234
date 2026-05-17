import AsyncStorage from "@react-native-async-storage/async-storage";
import { createLogger , registerErrorHandler } from "@/utils/logger";
import { AuthGuard } from "@/app/_handlers/AuthGuard";
import { SuspendedScreen } from "@/app/_handlers/SuspendedScreen";
import { MaintenanceScreen } from "@/app/_handlers/MaintenanceScreen";
import { ImpersonationHandler } from "@/app/_handlers/ImpersonationHandler";
import { MagicLinkHandler } from "@/app/_handlers/MagicLinkHandler";
import { DeepLinkHandler } from "@/app/_handlers/DeepLinkHandler";
import { ForceUpdateDialog } from "@/app/_handlers/ForceUpdateDialog";
import { TermsModal } from "@/app/_handlers/TermsModal";
import { WhatsNewSheet } from "@/app/_handlers/WhatsNewSheet";
import { MisconfigScreen } from "@/app/_handlers/MisconfigScreen";
import { ApiUnreachableScreen } from "@/app/_handlers/ApiUnreachableScreen";
import { PushNotificationHandler } from "@/app/_handlers/PushNotificationHandler";
import { _domain, log, WHATS_NEW_KEY } from "@/app/_handlers/_shared";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import {
  setAuthTokenGetter,
  setOnApiError,
  setMaxRetryAttempts,
  setRetryBackoffBaseMs,
} from "@workspace/api-client-react";
import { loadCoreFonts, loadUrduFonts } from "@/utils/fonts";
import { Stack, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Constants from "expo-constants";
import { PopupEngine } from "@/components/PopupEngine";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  reportError as reportErrorToBackend,
  initErrorReporter,
} from "@/utils/error-reporter";
import { PwaInstallBanner } from "@/components/PwaInstallBanner";
import { registerServiceWorker } from "@/utils/register-service-worker";
import { initSentry, setSentryUser } from "@/utils/sentry";
import { initAnalytics, trackScreen, identifyUser } from "@/utils/analytics";
import { registerPush } from "@/utils/push";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { CartProvider } from "@/context/CartContext";
import { FontSizeProvider } from "@/context/FontSizeContext";
import { LanguageProvider } from "@/context/LanguageContext";
import {
  PlatformConfigProvider,
  usePlatformConfig,
} from "@/context/PlatformConfigContext";
import { AuthConfigProvider } from "@/context/AuthConfigContext";
import { PerformanceProvider } from "@/context/PerformanceContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { ThemeProvider as AuthThemeProvider } from "@/lib/auth/ThemeContext";
import { ajkmartTheme } from "@/lib/auth/theme";
import { ToastProvider } from "@/context/ToastContext";
import { OfflineBar, SlowConnectionBar } from "@/components/OfflineBar";

SplashScreen.preventAutoHideAsync();

if (Platform.OS === "web" && typeof window !== "undefined") {
  window.addEventListener(
    "unhandledrejection",
    (event: PromiseRejectionEvent) => {
      const msg: string = event?.reason?.message ?? String(event?.reason ?? "");
      const isRouterTimeout =
        /\b6000ms\b/.test(msg) ||
        /\b\d+ms timeout exceeded\b/.test(msg) ||
        (msg.includes("timeout") && msg.toLowerCase().includes("route"));
      if (isRouterTimeout) {
        event.preventDefault();
        log.warn("Suppressed Expo Router startup timeout:", msg);
      }
    },
  );
}

function DeferredProviders({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  if (!ready) return <>{children}</>;
  return (
    <CartProvider>
      <ToastProvider>{children}</ToastProvider>
    </CartProvider>
  );
}

function WebShell({ children }: { children: React.ReactNode }) {
  if (Platform.OS !== "web") return <>{children}</>;
  return (
    <View style={webStyles.bg}>
      <View style={webStyles.frame}>{children}</View>
    </View>
  );
}

const webStyles = StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
  },
  frame: {
    width: "100%",
    maxWidth: 480,
    flex: 1,
    overflow: "hidden",
  },
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 60_000,
    },
  },
});

const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "AJKMART_QUERY_CACHE",
});

function semverGte(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return true;
}

function RootLayoutNav() {
  const { isSuspended, user, token } = useAuth();
  const { config } = usePlatformConfig();
  const qc = useQueryClient();
  const segments = useSegments();
  const prevUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (token) {
      setAuthTokenGetter(() => token);
    } else {
      setAuthTokenGetter(null);
    }
  }, [token]);

  const installedVersion = Constants.expoConfig?.version ?? "";
  const minAppVersion = config.compliance?.minAppVersion ?? "";
  const STRICT_SEMVER_RE = /^\d+\.\d+\.\d+$/;
  const _cur =
    typeof installedVersion === "string" ? installedVersion.trim() : "";
  const _min = typeof minAppVersion === "string" ? minAppVersion.trim() : "";
  let forceUpdate = false;
  if (
    !_cur ||
    !_min ||
    !STRICT_SEMVER_RE.test(_cur) ||
    !STRICT_SEMVER_RE.test(_min)
  ) {
    log.warn(
      "ForceUpdate: Skipping force-update check — invalid or missing version data",
      { installedVersion: _cur || "(empty)", minAppVersion: _min || "(empty)" },
    );
  } else {
    forceUpdate = !semverGte(_cur, _min);
  }
  const storeUrl =
    Platform.OS === "ios"
      ? (config.compliance?.appStoreUrl ?? "")
      : (config.compliance?.playStoreUrl ?? "");

  const [showTerms, setShowTerms] = useState(false);
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const termsCheckedRef = useRef(false);
  const whatsNewCheckedRef = useRef(false);

  const prevComplianceUserRef = useRef<string | null>(null);
  useEffect(() => {
    const uid = user?.id ?? null;
    if (uid !== prevComplianceUserRef.current) {
      termsCheckedRef.current = false;
      whatsNewCheckedRef.current = false;
      if (!uid) {
        setShowTerms(false);
        setShowWhatsNew(false);
      }
      prevComplianceUserRef.current = uid;
    }
  }, [user?.id]);

  useEffect(() => {
    const uid = user?.id ?? null;
    if (prevUserRef.current && !uid) {
      qc.clear();
    }
    prevUserRef.current = uid;
  }, [user?.id]);

  useEffect(() => {
    initErrorReporter();
    registerErrorHandler(reportErrorToBackend);
    setOnApiError((url: string, status: number, message: string) => {
      reportErrorToBackend({
        errorType: "api_error",
        errorMessage: message,
        functionName: url,
        moduleName: "API Call",
        statusCode: status,
        metadata: { path: url, status },
      });
    });
  }, []);

  useEffect(() => {
    const net = config?.network;
    if (!net) return;
    setMaxRetryAttempts(net.maxRetryAttempts);
    setRetryBackoffBaseMs(net.retryBackoffBaseMs);
  }, [config]);

  const deferredInitDone = useRef(false);
  useEffect(() => {
    if (deferredInitDone.current) return;
    const integ = config?.integrations;
    if (!integ) return;
    const doInit = () => {
      deferredInitDone.current = true;
      if (integ.sentry && integ.sentryDsn) {
        initSentry(
          integ.sentryDsn,
          integ.sentryEnvironment,
          integ.sentrySampleRate,
        ).catch((err) => {
          log.warn("[layout] Sentry init failed:", err);
        });
      }
      if (integ.analytics && integ.analyticsTrackingId) {
        initAnalytics(
          integ.analyticsPlatform,
          integ.analyticsTrackingId,
          integ.analyticsDebug ?? false,
        );
        trackScreen("app_start");
      }
    };
    const timer = setTimeout(doInit, 1500);
    return () => clearTimeout(timer);
  }, [
    config?.integrations?.sentryDsn,
    config?.integrations?.analyticsTrackingId,
  ]);

  useEffect(() => {
    if (!user?.id || !token) return;
    const timer = setTimeout(() => {
      setSentryUser(String(user.id));
      identifyUser(String(user.id));
      registerPush(token).catch((err) => {
        log.warn("[layout] Push registration failed:", err);
      });
    }, 2000);
    return () => clearTimeout(timer);
  }, [user?.id, token]);

  const lastCheckedTermsVersionRef = useRef<string | null>(null);
  useEffect(() => {
    const currentTermsVersion = config.compliance?.termsVersion ?? null;
    if (
      currentTermsVersion &&
      currentTermsVersion !== lastCheckedTermsVersionRef.current
    ) {
      termsCheckedRef.current = false;
    }
  }, [config.compliance?.termsVersion]);

  useEffect(() => {
    if (!user?.id || termsCheckedRef.current || forceUpdate) return;
    termsCheckedRef.current = true;
    const termsVersion = config.compliance?.termsVersion;
    if (!termsVersion) return;
    lastCheckedTermsVersionRef.current = termsVersion;
    fetch(`https://${_domain}/api/platform-config/compliance-status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        const accepted =
          data?.data?.acceptedTermsVersion ?? data?.acceptedTermsVersion;
        if (!accepted || accepted !== termsVersion) {
          setShowTerms(true);
        }
      })
      .catch((err) => {
        log.debug("[layout] Compliance status fetch failed:", err);
      });
  }, [user?.id, config.compliance?.termsVersion, forceUpdate]);

  useEffect(() => {
    if (!user?.id || whatsNewCheckedRef.current || forceUpdate) return;
    whatsNewCheckedRef.current = true;
    AsyncStorage.getItem(WHATS_NEW_KEY)
      .then((lastSeen) => {
        if (lastSeen !== installedVersion && config.releaseNotes?.length > 0) {
          setTimeout(() => setShowWhatsNew(true), 1500);
        }
      })
      .catch((err) => {
        log.debug("[layout] WhatsNew check failed:", err);
      });
  }, [user?.id, installedVersion, config.releaseNotes?.length, forceUpdate]);

  if (isSuspended) return <SuspendedScreen />;
  if (config.appStatus === "maintenance" && user) return <MaintenanceScreen />;

  return (
    <>
      {config.appStatus === "limited" && (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 1000,
            backgroundColor: "#F59E0B",
            paddingTop: 44,
            paddingBottom: 8,
            paddingHorizontal: 16,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>
            ⚠️ Limited service — some features may be temporarily unavailable
          </Text>
        </View>
      )}
      <AuthGuard />
      <ImpersonationHandler />
      <MagicLinkHandler />
      <DeepLinkHandler />
      <PushNotificationHandler />
      {_domain && (
        <PopupEngine
          apiBase={`https://${_domain}/api`}
          triggerKey={segments.join("/")}
        />
      )}
      <ForceUpdateDialog visible={forceUpdate} storeUrl={storeUrl} />
      <TermsModal
        visible={!forceUpdate && showTerms}
        termsVersion={config.compliance?.termsVersion ?? "1.0"}
        onAccept={() => setShowTerms(false)}
      />
      <WhatsNewSheet
        visible={!forceUpdate && !showTerms && showWhatsNew}
        releaseNotes={config.releaseNotes ?? []}
        appVersion={installedVersion}
        onDismiss={() => {
          AsyncStorage.setItem(WHATS_NEW_KEY, installedVersion).catch((err) => {
            log.debug("[layout] Failed to save WhatsNew version:", err);
          });
          setShowWhatsNew(false);
        }}
      />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen
          name="onboarding"
          options={{ headerShown: false, gestureEnabled: false }}
        />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="auth" options={{ headerShown: false }} />
        <Stack.Screen name="mart/index" options={{ headerShown: false }} />
        <Stack.Screen name="food/index" options={{ headerShown: false }} />
        <Stack.Screen name="ride/index" options={{ headerShown: false }} />
        <Stack.Screen name="cart/index" options={{ headerShown: false }} />
        <Stack.Screen name="pharmacy/index" options={{ headerShown: false }} />
        <Stack.Screen name="parcel/index" options={{ headerShown: false }} />
        <Stack.Screen
          name="categories/index"
          options={{ headerShown: false }}
        />
        <Stack.Screen name="order/index" options={{ headerShown: false }} />
        <Stack.Screen name="orders/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="school/index" options={{ headerShown: false }} />
        <Stack.Screen name="school/book" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

async function probeApiHealth(
  domain: string,
  attempt = 0,
): Promise<{ reachable: boolean; url: string }> {
  const url = `https://${domain}/api/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) return { reachable: true, url };
    /* Server reachable but unhealthy — retry with backoff up to 3 times */
    if (attempt < 3) {
      const delay = Math.min(1000 * 2 ** attempt, 8000);
      await new Promise<void>(r => setTimeout(r, delay));
      return probeApiHealth(domain, attempt + 1);
    }
    return { reachable: false, url };
  } catch {
    clearTimeout(timer);
    if (attempt < 3) {
      const delay = Math.min(1000 * 2 ** attempt, 8000);
      await new Promise<void>(r => setTimeout(r, delay));
      return probeApiHealth(domain, attempt + 1);
    }
    return { reachable: false, url };
  }
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [apiReachable, setApiReachable] = useState<boolean | null>(
    _domain ? null : true,
  );
  const [apiUrl, setApiUrl] = useState(`https://${_domain}/api/health`);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    registerServiceWorker();
  }, []);

  useEffect(() => {
    if (!_domain) return;
    probeApiHealth(_domain).then(({ reachable, url }) => {
      setApiUrl(url);
      setApiReachable(reachable);
      if (!reachable) {
        Alert.alert(
          "Cannot Reach Server",
          "AJKMart could not connect to the API server. Please check your connection and tap Retry.",
          [{ text: "OK", style: "cancel" }],
        );
      }
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const SPLASH_DEADLINE_MS = Platform.OS === "web" ? 3000 : 8000;

    const hideSplash = () => {
      if (!cancelled) {
        cancelled = true;
        setReady(true);
        // eslint-disable-next-line ajk-local/no-silent-catch -- splash hide failure is cosmetic; app still loads normally
        SplashScreen.hideAsync().catch(() => {});
      }
    };

    const deadlineTimer = setTimeout(hideSplash, SPLASH_DEADLINE_MS);

    const loadAllFonts = async () => {
      try {
        const timeout = (ms: number) =>
          new Promise<void>((r) => setTimeout(r, ms));
        // eslint-disable-next-line ajk-local/no-silent-catch -- font loading failure is cosmetic; app renders with system fonts
        await Promise.race([
          loadCoreFonts(),
          timeout(Platform.OS === "web" ? 2000 : 6000),
        ]).catch(() => {});
        const savedLang = await AsyncStorage.getItem("@ajkmart_language").catch(
          () => null,
        );
        if (savedLang === "ur" || savedLang === "en_ur") {
          // eslint-disable-next-line ajk-local/no-silent-catch -- Urdu font loading is cosmetic; app renders with system fonts
          loadUrduFonts().catch(() => {});
        }
        // eslint-disable-next-line ajk-local/no-silent-catch -- font loading failure is intentionally swallowed; app renders with system fonts
      } catch {
        // Silently continue — the app renders with system fonts as fallback.
      }
      clearTimeout(deadlineTimer);
      hideSplash();
    };

    loadAllFonts();

    return () => {
      cancelled = true;
      clearTimeout(deadlineTimer);
    };
  }, []);

  const handleRetry = async () => {
    setRetrying(true);
    const result = await probeApiHealth(_domain);
    setApiUrl(result.url);
    if (result.reachable) {
      setApiReachable(true);
    } else {
      setRetrying(false);
    }
  };

  if (!ready || (_domain && apiReachable === null)) {
    return (
      <WebShell>
        <View
          style={{
            flex: 1,
            backgroundColor: "#0047B3",
            alignItems: "center",
            justifyContent: "center",
            gap: 20,
          }}
        >
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 20,
              backgroundColor: "rgba(255,255,255,0.15)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ fontSize: 36 }}>🛒</Text>
          </View>
          <ActivityIndicator size="large" color="#ffffff" />
        </View>
      </WebShell>
    );
  }

  if (!_domain) {
    return (
      <WebShell>
        <MisconfigScreen />
      </WebShell>
    );
  }

  if (apiReachable === false) {
    return (
      <WebShell>
        <ApiUnreachableScreen
          url={apiUrl}
          onRetry={handleRetry}
          retrying={retrying}
        />
      </WebShell>
    );
  }

  return (
    <WebShell>
      <SafeAreaProvider>
        <ErrorBoundary
          onError={(error, stackTrace) => {
            reportErrorToBackend({
              errorType: "frontend_crash",
              errorMessage: error.message || "Component crash",
              stackTrace: error.stack || stackTrace,
              componentName: "ErrorBoundary",
            });
          }}
        >
          <PersistQueryClientProvider
            client={queryClient}
            persistOptions={{
              persister: asyncStoragePersister,
              maxAge: 1000 * 60 * 60 * 24,
            }}
          >
            <GestureHandlerRootView style={{ flex: 1 }}>
              <KeyboardProvider>
                <FontSizeProvider>
                  <ThemeProvider>
                    <AuthThemeProvider theme={ajkmartTheme}>
                    <PlatformConfigProvider>
                      <AuthConfigProvider>
                      <PerformanceProvider>
                        <LanguageProvider>
                          <AuthProvider>
                            <DeferredProviders>
                              <OfflineBar />
                              <SlowConnectionBar />
                              <RootLayoutNav />
                              <PwaInstallBanner />
                            </DeferredProviders>
                          </AuthProvider>
                        </LanguageProvider>
                      </PerformanceProvider>
                      </AuthConfigProvider>
                    </PlatformConfigProvider>
                    </AuthThemeProvider>
                  </ThemeProvider>
                </FontSizeProvider>
              </KeyboardProvider>
            </GestureHandlerRootView>
          </PersistQueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </WebShell>
  );
}
