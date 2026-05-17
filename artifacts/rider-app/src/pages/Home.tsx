import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNetworkQuality, getPollingIntervalForTier } from "../hooks/useNetworkQuality";

import { Link } from "wouter";
import { useAuth } from "../lib/rider-auth";
import { api, type Order, type Ride } from "../lib/api";
import { usePlatformConfig } from "../lib/useConfig";
import { useLanguage } from "../lib/useLanguage";
import { useSocket } from "../lib/socket";
import { tDual } from "@workspace/i18n";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  playRequestSound,
  unlockAudio,
  isAudioLocked,
  isSilenced,
  getSilenceRemaining,
  getSilenceMode,
  setSilenceMode,
} from "../lib/notificationSound";
import { logRideEvent } from "../lib/rideUtils";
import {
  enqueue,
  addDismissed,
  removeDismissed,
  sweepAndLoadDismissed,
  clearAllDismissed,
} from "../lib/gpsQueue";
import { enqueueAction } from "../lib/offline/queueManager";
import { haversineMeters } from "../components/dashboard/helpers";
import {
  Wifi,
  Zap,
  Clock,
  ChevronRight,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";

import {
  LiveClock,
  SkeletonHome,
  StatsGrid,
  OnlineToggleCard,
  SilenceControls,
  FixedBanners,
  InlineWarnings,
  OfflineConfirmDialog,
  ActiveTaskBanner,
  RequestListHeader,
  formatCurrency,
} from "../components/dashboard";
import { GoalSection } from "../components/home/GoalSection";
import { HomeRequestList } from "../components/home/HomeRequestList";

export default function Home() {
  const { user, refreshUser, loading: authLoading } = useAuth();
  const { tier: networkTier } = useNetworkQuality();

  const { config } = usePlatformConfig();
  const { language } = useLanguage();
  const T = useCallback((key: Parameters<typeof tDual>[0]) => tDual(key, language), [language]);
  const currency = config.platform.currencySymbol ?? "Rs.";
  const qc = useQueryClient();
  const [toggling, setToggling] = useState(false);
  const [tabVisible, setTabVisible] = useState(!document.hidden);
  const [toastMsg, setToastMsg] = useState("");
  const [toastType, setToastType] = useState<"success" | "error">("success");
  const [newFlash, setNewFlash] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set<string>());


  const [audioLocked, setAudioLocked] = useState(false);

  useEffect(() => {
    sweepAndLoadDismissed().then((ids) => {
      if (ids.size > 0) setDismissed(ids);
    });
    /* Check audio lock state on mount */
    setAudioLocked(isAudioLocked());
  }, []);

  const [silenceOn, setSilenceOn] = useState(getSilenceMode());
  const prevIdsRef = useRef<Set<string>>(new Set());
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soundIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasUnseenRequestsRef = useRef(false);
  const [silenced, setSilenced] = useState(isSilenced());
  const [silenceRemaining, setSilenceRemaining] = useState(getSilenceRemaining());
  const [showSilenceMenu, setShowSilenceMenu] = useState(false);

  useEffect(() => {

    const handler = () => {
      unlockAudio();
      setAudioLocked(false);
    };
    document.addEventListener("click", handler, { once: true });
    document.addEventListener("touchstart", handler, { once: true });
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (soundIntervalRef.current) clearInterval(soundIntervalRef.current);
      document.removeEventListener("click", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, []);

  const { socket: sharedSocket, connected: socketConnected, setRiderPosition } = useSocket();

  useEffect(() => {
    if (!silenced) return;
    const t = setInterval(() => {
      const rem = getSilenceRemaining();
      setSilenceRemaining(rem);
      if (rem <= 0) {
        setSilenced(false);
        setShowSilenceMenu(false);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [silenced]);

  const showToast = useCallback(
    (msg: string, type: "success" | "error" = "success") => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setToastMsg(msg);
      setToastType(type);
      toastTimerRef.current = setTimeout(() => setToastMsg(""), 3000);
    },
    [],
  );

  const [wakeLockWarning, setWakeLockWarning] = useState(false);
  const [optimisticOnline, setOptimisticOnline] = useState<boolean | null>(null);
  const effectiveOnline = optimisticOnline !== null ? optimisticOnline : !!user?.isOnline;

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const TOGGLE_DEBOUNCE_MS = 1000;
  const lastToggleRef = useRef<number>(0);
  /* Ref kept in sync with the derived totalRequests value (defined after the
     query hooks below). Using a ref avoids both a forward-reference TypeScript
     error and a stale closure inside toggleOnline's useCallback. */
  const totalRequestsRef = useRef(0);

  const [showOfflineConfirm, setShowOfflineConfirm] = useState(false);
  const [zoneWarning, setZoneWarning] = useState<string | null>(null);

  const doActualToggle = useCallback(async () => {
    const now = Date.now();
    lastToggleRef.current = now;
    setToggling(true);
    const newStatus = !effectiveOnline;
    setOptimisticOnline(newStatus);
    let succeeded = false;
    try {
      const result = await api.setOnline(newStatus);
      if (!isMountedRef.current) return;
      if (result?.serviceZoneWarning) {
        setZoneWarning(result.serviceZoneWarning);
      } else {
        setZoneWarning(null);
      }
      await refreshUser().catch((err) => { console.warn('[artifacts/rider-app/src/pages/Home.tsx]', err); }); // eslint-disable-line no-console
      if (!isMountedRef.current) return;
      succeeded = true;
      showToast(newStatus ? T("youAreNowOnline") : T("youAreNowOffline"), "success");
    } catch (e: unknown) {
      if (!isMountedRef.current) return;
      setOptimisticOnline(!newStatus);
      showToast(e instanceof Error ? e.message : T("somethingWentWrong"), "error");
    } finally {
      if (isMountedRef.current) {
        if (succeeded) setOptimisticOnline(null);
        setToggling(false);
      }
    }
  }, [effectiveOnline, refreshUser, showToast, T]);

  const toggleOnline = useCallback(async () => {
    const now = Date.now();
    if (toggling || now - lastToggleRef.current < TOGGLE_DEBOUNCE_MS) return;
    lastToggleRef.current = now;

    if (effectiveOnline && totalRequestsRef.current > 0) {
      setShowOfflineConfirm(true);
      return;
    }

    await doActualToggle();
  }, [toggling, effectiveOnline, doActualToggle]);

  const { data: earningsData } = useQuery({
    queryKey: ["rider-earnings"],
    queryFn: () => api.getEarnings(),
    refetchInterval: tabVisible ? 60000 : false,
    enabled: tabVisible,
  });

  const { data: activeData } = useQuery({
    queryKey: ["rider-active"],
    queryFn: () => api.getActive(),
    refetchInterval: tabVisible ? 8000 : false,
    enabled: effectiveOnline && tabVisible,
  });
  const hasActiveTask = !!(activeData?.order || activeData?.ride);

  const { data: requestsData, isLoading: requestsLoading, isError: requestsError } = useQuery({
    queryKey: ["rider-requests"],
    queryFn: () => api.getRequests(),
    refetchInterval: tabVisible && user?.isOnline ? getPollingIntervalForTier(networkTier) : 60_000,
    enabled: effectiveOnline,

  });

  const { data: cancelStatsData } = useQuery({
    queryKey: ["rider-cancel-stats"],
    queryFn: () => api.getCancelStats(),
    refetchInterval: tabVisible ? 120000 : false,
    staleTime: 60000,
  });

  const { data: ignoreStatsData } = useQuery({
    queryKey: ["rider-ignore-stats"],
    queryFn: () => api.getIgnoreStats(),
    refetchInterval: tabVisible ? 120000 : false,
    staleTime: 60000,
  });

  const allOrders: Order[] = requestsData?.orders || []; // eslint-disable-line react-hooks/exhaustive-deps
  const allRides: Ride[] = requestsData?.rides || []; // eslint-disable-line react-hooks/exhaustive-deps
  /* Server time from the API envelope — used to offset AcceptCountdown for clock drift */
  const requestsServerTime: string | null = requestsData?._serverTime ?? null;

  /* Sync dismissed set with server: drop dismissed IDs no longer on server */
  useEffect(() => {
    if (!requestsData) return;
    const serverIds = new Set<string>([
      ...allOrders.map((o) => o.id),
      ...allRides.map((r) => r.id),
    ]);
    setDismissed((prev) => {
      /* Keep only IDs that still exist on the server */
      const next = new Set([...prev].filter((id) => serverIds.has(id)));
      if (next.size === prev.size) return prev;
      [...prev].filter((id) => !serverIds.has(id)).forEach((id) => removeDismissed(id));
      return next;
    });
  }, [requestsData]); // eslint-disable-line react-hooks/exhaustive-deps

  /* New-request flash — pulse the header text; ring around the card container */
  const currentIdsSig = [...allOrders.map((o) => o.id), ...allRides.map((r) => r.id)]
    .sort()
    .join(",");
  useEffect(() => {
    const currentIds = new Set<string>(currentIdsSig.split(",").filter(Boolean));
    const prevIds = prevIdsRef.current;
    let hasNew = false;
    currentIds.forEach((id) => {
      if (!prevIds.has(id)) hasNew = true;
    });

    if (hasNew && currentIds.size > 0) {
      setNewFlash(true);
      setTimeout(() => setNewFlash(false), 2500);
      /* Recheck audio lock before playing — policy may have changed since mount */
      const locked = isAudioLocked();
      setAudioLocked(locked);
      if (!locked) playRequestSound();
      hasUnseenRequestsRef.current = true;
    }

    if (currentIds.size === 0) {
      hasUnseenRequestsRef.current = false;
      if (soundIntervalRef.current) {
        clearInterval(soundIntervalRef.current);
        soundIntervalRef.current = null;
      }
    } else if (hasUnseenRequestsRef.current) {
      if (soundIntervalRef.current) {
        clearInterval(soundIntervalRef.current);
        soundIntervalRef.current = null;
      }
      soundIntervalRef.current = setInterval(() => {
        if (
          hasUnseenRequestsRef.current &&
          !getSilenceMode() &&
          !isSilenced() &&
          !document.hidden &&
          !isAudioLocked()
        )
          playRequestSound();
      }, 8000);
    }

    prevIdsRef.current = currentIds;
  }, [currentIdsSig]);

  /* On tab re-focus: purge expired dismissed entries, then refetch */
  useEffect(() => {
    const handler = () => {
      const visible = !document.hidden;
      setTabVisible(visible);
      if (visible) {
        /* Recheck audio lock — browser may re-suspend AudioContext while hidden */
        setAudioLocked(isAudioLocked());
        /* Sweep expired dismissed entries before triggering the refetch */
        sweepAndLoadDismissed().then((freshIds) => {
          setDismissed(freshIds);
          qc.invalidateQueries({ queryKey: ["rider-requests"] });
          qc.invalidateQueries({ queryKey: ["rider-active"] });
        });
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [qc]);

  useEffect(() => {
    if (!effectiveOnline || !tabVisible) return;
    if (!("wakeLock" in navigator)) {
      setWakeLockWarning(true);
      return;
    }

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        if (cancelled || document.hidden) return;
        sentinel = await (
          navigator as Navigator & {
            wakeLock: { request(type: string): Promise<WakeLockSentinel> };
          }
        ).wakeLock.request("screen");
        setWakeLockWarning(false);
      } catch (err) { console.warn('[artifacts/rider-app/src/pages/Home.tsx]', err); } // eslint-disable-line no-console
    };

    acquire();

    return () => {
      cancelled = true;
      sentinel?.release().catch((err) => { console.warn('[artifacts/rider-app/src/pages/Home.tsx]', err); }); // eslint-disable-line no-console
    };
  }, [effectiveOnline, tabVisible]);

  useEffect(() => {
    const handleLogout = () => {
      setDismissed(new Set());
      clearAllDismissed();
    };
    window.addEventListener("ajkmart:logout", handleLogout);
    return () => window.removeEventListener("ajkmart:logout", handleLogout);
  }, []);

  const [gpsWarning, setGpsWarning] = useState<string | null>(null);
  const gpsWarningRef = useRef<string | null>(null);

  const setGpsWarningWithRef = useCallback((val: string | null) => {
    gpsWarningRef.current = val;
    setGpsWarning(val);
  }, []);

  const batteryRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (typeof navigator !== "undefined" && "getBattery" in navigator) {
      (navigator as unknown as { getBattery: () => Promise<{ level: number; addEventListener: (e: string, cb: () => void) => void }> })
        .getBattery()
        .then((batt) => {
          batteryRef.current = Math.round(batt.level * 100);
          batt.addEventListener("levelchange", () => {
            batteryRef.current = Math.round(batt.level * 100);
          });
        })
        .catch((err) => { console.warn('[artifacts/rider-app/src/pages/Home.tsx]', err); }); // eslint-disable-line no-console
    }
  }, []);

  /* Socket event listeners — invalidate queries on new or changed requests */
  useEffect(() => {
    if (!sharedSocket) return;
    const handleNewRequest = () => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
    };
    /* Also listen for admin/customer-driven state changes */
    const handleStateChange = () => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      qc.invalidateQueries({ queryKey: ["rider-active"] });
    };
    /* Invalidate earnings immediately when a delivery or ride completes so the
       Home screen progress bar updates within seconds instead of waiting for the
       60-second polling cycle. The mutations in Active.tsx also call this on the
       happy-path; this socket handler covers cases where the update arrives via
       server push (e.g. admin marks delivered, or another tab completes the task). */
    const handleCompletionEvent = () => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      qc.invalidateQueries({ queryKey: ["rider-active"] });
      qc.invalidateQueries({ queryKey: ["rider-earnings"] });
    };
    sharedSocket.on("rider:new_request", handleNewRequest);
    sharedSocket.on("new:request", handleNewRequest);
    sharedSocket.on("rider:request-cancelled", handleStateChange);
    sharedSocket.on("rider:ride-updated", handleCompletionEvent);
    sharedSocket.on("rider:order-updated", handleCompletionEvent);
    return () => {
      sharedSocket.off("rider:new_request", handleNewRequest);
      sharedSocket.off("new:request", handleNewRequest);
      sharedSocket.off("rider:request-cancelled", handleStateChange);
      sharedSocket.off("rider:ride-updated", handleCompletionEvent);
      sharedSocket.off("rider:order-updated", handleCompletionEvent);
    };
  }, [sharedSocket, qc]);

  /* GPS watch — idle Home screen, no active task.
     The socket heartbeat (socket.tsx) is the sole liveness signal.
     REST pings here only update the stored coordinate when position changes
     meaningfully; they are not keepalive traffic. Memoized haversineMeters
     from helpers.ts is used so no redundant trig runs per position event. */
  useEffect(() => {
    if (!user?.isOnline || hasActiveTask || !user?.id) return;
    if (!navigator?.geolocation) return;

    let lastSentTime = 0;
    let lastLat: number | null = null;
    let lastLng: number | null = null;
    /* Only send REST location updates on meaningful movement. No time-based
       periodic fallback — the socket heartbeat is the sole liveness signal. */
    const MIN_DISTANCE_METERS = 25;
    /* Minimum interval to debounce burst callbacks from the OS */
    const DEBOUNCE_MS = 1000;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        const { latitude, longitude, accuracy, speed, heading } = pos.coords;

        const isMockGps = accuracy !== null && accuracy === 0;
        if (isMockGps) {
          setGpsWarningWithRef(
            "Suspicious GPS accuracy detected. Please disable mock location apps.",
          );
          return;
        }

        if (now - lastSentTime < DEBOUNCE_MS) return;

        /* Always update the shared socket position cache so the heartbeat
           has a fresh position without running its own GPS listener */
        setRiderPosition(latitude, longitude);

        /* memoized haversine — skip REST ping if position hasn't changed meaningfully */
        if (lastLat !== null && lastLng !== null) {
          const dist = haversineMeters(lastLat, lastLng, latitude, longitude);
          if (dist < MIN_DISTANCE_METERS) return;
        }
        /* No previous position — record it but don't send a keepalive ping;
           the socket heartbeat already signals liveness to the server. */
        if (lastLat === null) {
          lastLat = latitude;
          lastLng = longitude;
          lastSentTime = now;
          return;
        }

        lastSentTime = now;
        lastLat = latitude;
        lastLng = longitude;
        const locationData = {
          latitude,
          longitude,
          accuracy: accuracy ?? undefined,
          speed: speed ?? undefined,
          heading: heading ?? undefined,
          batteryLevel: batteryRef.current,
        };
        const queuedPing = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          timestamp: new Date().toISOString(),
          ...locationData,
        };

        if (!navigator.onLine) {
          enqueue(queuedPing).catch((err) => { console.warn('[artifacts/rider-app/src/pages/Home.tsx]', err); }); // eslint-disable-line no-console
          return;
        }

        api
          .updateLocation(locationData)
          .then(() => {
            if (gpsWarningRef.current) setGpsWarningWithRef(null);
          })
          .catch((err: Error) => {
            const msg = err.message || "";
            const isSpoofError =
              msg.toLowerCase().includes("spoof") || msg.toLowerCase().includes("mock");
            if (isSpoofError) {
              setGpsWarningWithRef(`GPS Spoof Detected: ${msg}`);
            } else {
              enqueue(queuedPing).catch((err) => { console.warn('[artifacts/rider-app/src/pages/Home.tsx]', err); }); // eslint-disable-line no-console
              setGpsWarningWithRef(T("gpsLocationError"));
            }
          });
      },
      () => {
        setGpsWarningWithRef(T("gpsNotAvailable"));
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [user?.isOnline, hasActiveTask, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* PF5: Memoize the filtered request lists so unrelated re-renders (e.g.
     typing into a controlled input on Home, GPS-driven `setGpsWarning`
     updates) don't re-allocate these arrays and force every request card to
     re-render. The dismissed set is a stable identity within React state, so
     including it as a dep is correct. T2: typed callbacks instead of `any`. */
  const orders = useMemo(
    () => allOrders.filter((o: Order) => !dismissed.has(o.id)),
    [allOrders, dismissed],
  );
  const rides = useMemo(
    () => allRides.filter((r: Ride) => !dismissed.has(r.id)),
    [allRides, dismissed],
  );
  const totalRequests = orders.length + rides.length;
  totalRequestsRef.current = totalRequests;

  const dismiss = useCallback(
    (id: string) => {
      addDismissed(id);
      setDismissed((prev) => {
        const next = new Set([...prev, id]);
        const serverIds = new Set<string>([
          ...allOrders.map((o) => o.id),
          ...allRides.map((r) => r.id),
        ]);
        const remainingVisible = [...serverIds].filter((sid) => !next.has(sid));
        if (remainingVisible.length === 0) {
          hasUnseenRequestsRef.current = false;
          if (soundIntervalRef.current) {
            clearInterval(soundIntervalRef.current);
            soundIntervalRef.current = null;
          }
        }
        return next;
      });
    },
    [allOrders, allRides],
  );

  const stopRequestSoundIfEmpty = () => {
    const remainingCount = allOrders.length + allRides.length;
    if (remainingCount <= 1) {
      hasUnseenRequestsRef.current = false;
      if (soundIntervalRef.current) {
        clearInterval(soundIntervalRef.current);
        soundIntervalRef.current = null;
      }
    }
  };

  /* O2: Order/Ride accept mutations.
     - We invalidate `rider-requests` in `onSettled` so both the win path
       (server returns the order) and the loss path (409 race / "already
       taken") trigger a refetch from a single place. The previous code
       invalidated in `onError` and `onSuccess` separately, which meant the
       409 race could briefly show a "ghost" accepted card before the refetch
       completed.
     - We never navigate to /active from here; the rider's BottomNav handles
       routing. This avoids the original bug where the loser of a race
       navigated to /active and saw a 404. */
  const acceptOrderMut = useMutation({
    mutationFn: (id: string) => api.acceptOrder(id),
    onSuccess: () => {
      stopRequestSoundIfEmpty();
      qc.invalidateQueries({ queryKey: ["rider-active"] });
      showToast("Order accepted! Check Active tab.", "success");
    },
    onError: (e: Error & { status?: number }, id) => {
      if (e?.status === 409 || /already taken|already accepted/i.test(e?.message || "")) {
        dismiss(id);
        qc.setQueryData(["rider-requests"], (old: { orders?: { id: string }[]; rides?: { id: string }[] } | undefined) => {
          if (!old) return old;
          return { ...old, orders: (old.orders || []).filter((o) => o.id !== id) };
        });
        showToast("This order was already accepted by another rider.", "error");
      } else {
        /* Persist to IndexedDB queue so the accept survives connectivity loss */
        const looksLikeNetErr = /network|fetch|timeout|offline/i.test(e?.message || "");
        if (looksLikeNetErr) enqueueAction("accept_order", id, {}).catch((err) => { console.warn('[artifacts/rider-app/src/pages/Home.tsx]', err); }); // eslint-disable-line no-console
        showToast(e.message || "Could not accept order. Please try again.", "error");
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
    },
  });

  const rejectOrderMut = useMutation({
    mutationFn: (id: string) => api.rejectOrder(id),
    onSuccess: (_: unknown, id: string) => {
      dismiss(id);
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      showToast("Order rejected.", "success");
    },
    onError: (e: Error) => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      showToast(e.message || "Could not reject order", "error");
    },
  });

  const acceptRideMut = useMutation({
    mutationFn: (id: string) => api.acceptRide(id),
    onSuccess: (_: unknown, id: string) => {
      stopRequestSoundIfEmpty();
      qc.invalidateQueries({ queryKey: ["rider-active"] });
      logRideEvent(id, "accepted", (msg, isErr) =>
        showToast(msg, isErr ? "error" : "success"),
      );
      showToast("Ride accepted! Check Active tab.", "success");
    },
    onError: (e: Error & { status?: number }, id) => {
      if (e?.status === 409 || /already taken|already accepted/i.test(e?.message || "")) {
        dismiss(id);
        qc.setQueryData(["rider-requests"], (old: { orders?: { id: string }[]; rides?: { id: string }[] } | undefined) => {
          if (!old) return old;
          return { ...old, rides: (old.rides || []).filter((r) => r.id !== id) };
        });
        showToast("This ride was already accepted by another rider.", "error");
      } else {
        /* Persist to IndexedDB queue so the accept survives connectivity loss */
        const looksLikeNetErr = /network|fetch|timeout|offline/i.test(e?.message || "");
        if (looksLikeNetErr) enqueueAction("accept_ride", id, {}).catch((err) => { console.warn('[artifacts/rider-app/src/pages/Home.tsx]', err); }); // eslint-disable-line no-console
        showToast(e.message || "Could not accept ride. Please try again.", "error");
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
    },
  });

  const counterRideMut = useMutation({
    mutationFn: ({ id, counterFare }: { id: string; counterFare: number }) =>
      api.counterRide(id, { counterFare }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      showToast("Counter offer submitted!", "success");
    },
    onError: (e: Error) => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      showToast(e.message || "Counter offer failed", "error");
    },
  });

  const rejectOfferMut = useMutation({
    mutationFn: (id: string) => api.rejectOffer(id),
    onSuccess: (_: unknown, id: string) => {
      dismiss(id);
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      showToast("Ride skipped.", "success");
    },
    onError: (e: Error) => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      showToast(e.message, "error");
    },
  });

  interface IgnorePenaltyData {
    ignorePenalty?: { penaltyApplied?: number; restricted?: boolean; dailyIgnores?: number };
    penaltyApplied?: number;
    restricted?: boolean;
    dailyIgnores?: number;
  }

  const ignoreRideMut = useMutation({
    mutationFn: (id: string) => api.ignoreRide(id),
    onSuccess: (data: IgnorePenaltyData, id: string) => {
      dismiss(id);
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      const p = data?.ignorePenalty ?? data;
      if ((p?.penaltyApplied ?? 0) > 0) {
        showToast(
          `Ignored — ${currency} ${p.penaltyApplied} penalty deducted!${p.restricted ? " Account restricted." : ""}`,
          "error",
        );
      } else {
        showToast(`Ride ignored (${p?.dailyIgnores || "?"} today).`, "success");
      }
    },
    onError: (e: Error) => {
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      showToast(e.message || "Ignore failed", "error");
    },
  });

  const toggleSilence = () => {
    const next = !getSilenceMode();
    setSilenceMode(next);
    setSilenceOn(next);
    showToast(
      next ? "Silence mode ON — no alert sounds" : "Silence mode OFF — sounds enabled",
      "success",
    );
  };

  if (authLoading) return <SkeletonHome />;

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return T("goodMorning");
    if (h < 17) return T("goodAfternoon");
    return T("goodEvening");
  })();

  /* Count how many top-fixed banners are currently active (28 px each).
     This must mirror the logic in FixedBanners so the header always sits
     below the last visible banner regardless of how many are showing. */
  const BANNER_H_PX = 28;
  const topBannerCount =
    (!socketConnected && effectiveOnline ? 1 : 0) +
    (!!zoneWarning && effectiveOnline ? 1 : 0) +
    (audioLocked && effectiveOnline ? 1 : 0);
  const topBannerOffsetPx = topBannerCount * BANNER_H_PX;

  return (
    <div className="flex flex-col min-h-screen bg-[#F5F6F8] animate-[fadeIn_0.3s_ease-out]">
      <FixedBanners
        socketConnected={socketConnected}
        effectiveOnline={effectiveOnline}
        zoneWarning={zoneWarning}
        onDismissZone={() => setZoneWarning(null)}
        wakeLockWarning={wakeLockWarning}
        onDismissWakeLock={() => setWakeLockWarning(false)}
        audioLocked={audioLocked}
        onUnlockAudio={() => {
          unlockAudio();
          setAudioLocked(false);
        }}
        T={T}
      />

      <header
        className="bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800 text-white px-4 sm:px-6 pb-6 sm:pb-8 rounded-b-[2rem] relative overflow-hidden"
        style={{
          paddingTop: `calc(env(safe-area-inset-top, 0px) + 3.5rem + ${topBannerOffsetPx}px)`,
        }}
      >
        <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-green-500/[0.04]" />
        <div className="absolute bottom-10 -left-16 w-56 h-56 rounded-full bg-white/[0.02]" />
        <div className="absolute top-1/2 right-1/4 w-32 h-32 rounded-full bg-white/[0.015]" />

        <div className="relative max-w-2xl mx-auto">
          <div className="flex items-start justify-between mb-5">
            <div>
              <p className="text-white/40 text-[11px] font-semibold tracking-widest uppercase flex items-center gap-1.5 mb-1">
                <Clock size={11} /> <LiveClock /> · AJKMart Rider
              </p>
              <h1 className={`text-[20px] sm:text-[22px] font-extrabold tracking-tight leading-tight transition-colors ${newFlash ? "text-green-300" : "text-white"}`}>
                {greeting}, {user?.name?.split(" ")[0] || "Rider"} 👋
              </h1>
              {newFlash && (
                <p className="text-green-400 text-[11px] font-bold mt-0.5 animate-pulse flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-green-400 rounded-full" />
                  New request available!
                </p>
              )}
            </div>
            <Link href="/wallet" className="flex flex-col items-end flex-shrink-0" aria-label="View wallet balance">
              <div className="bg-white/[0.06] backdrop-blur-sm border border-white/[0.06] rounded-2xl px-3 sm:px-3.5 py-2 text-right">
                <p className="text-white/40 text-[9px] font-bold uppercase tracking-wider">
                  {T("wallet")}
                </p>
                <p className="font-extrabold text-base sm:text-lg leading-tight">
                  {formatCurrency(user?.walletBalance ?? "0", currency)}
                </p>
              </div>
            </Link>
          </div>

          <OnlineToggleCard
            effectiveOnline={effectiveOnline}
            toggling={toggling}
            silenceOn={silenceOn}
            onToggleOnline={toggleOnline}
            onToggleSilence={toggleSilence}
            T={T}
          />

          <SilenceControls
            silenced={silenced}
            silenceRemaining={silenceRemaining}
            showSilenceMenu={showSilenceMenu}
            onSetShowSilenceMenu={setShowSilenceMenu}
            onSetSilenced={setSilenced}
            onSetSilenceRemaining={setSilenceRemaining}
            showToast={showToast}
          />

          <StatsGrid
            deliveriesToday={user?.stats?.deliveriesToday || 0}
            earningsToday={user?.stats?.earningsToday || 0}
            weekEarnings={earningsData?.week?.earnings || 0}
            totalDeliveries={user?.stats?.totalDeliveries || 0}
            currency={currency}
            maxDeliveries={config.rider?.maxDeliveries ?? 3}
          />
        </div>
      </header>

      <main className="px-3 sm:px-4 pt-4 space-y-3 relative z-10 w-full max-w-2xl mx-auto pb-6">
        <InlineWarnings
          gpsWarning={gpsWarning}
          onDismissGps={() => setGpsWarning(null)}
          isRestricted={!!user?.isRestricted}
          riderNotice={config.content.riderNotice}
          riderNoticeDismissed={dismissed.has("rider-notice")}
          onDismissRiderNotice={() => {
            addDismissed("rider-notice");
            setDismissed((prev) => {
              const next = new Set(prev);
              next.add("rider-notice");
              return next;
            });
          }}
          cancelStatsData={cancelStatsData}
          ignoreStatsData={ignoreStatsData}
          currency={currency}
          minBalance={config.rider?.minBalance ?? 0}
          walletBalance={Number(user?.walletBalance) || 0}
        />

        <GoalSection
          adminGoal={config.rider?.dailyGoal ?? 5000}
          personalGoal={earningsData?.dailyGoal ?? user?.dailyGoal ?? null}
          todayEarnings={earningsData?.today?.earnings ?? user?.stats?.earningsToday ?? 0}
          currency={currency}
          T={T}
          showToast={showToast}
          refreshUser={refreshUser}
        />

        {config.content.trackerBannerEnabled &&
          hasActiveTask &&
          config.content.trackerBannerPosition === "top" && (
            <ActiveTaskBanner activeData={activeData} variant="green" />
          )}

        {user?.isOnline ? (
          <>
            {hasActiveTask && !config.content.trackerBannerEnabled && (
              <ActiveTaskBanner activeData={activeData} variant="amber" />
            )}

            <div
              className={`rounded-3xl shadow-sm overflow-hidden transition-all duration-300 ${newFlash ? "ring-4 ring-green-400 ring-offset-2 ring-offset-[#F5F6F8]" : ""}`}
            >
              <RequestListHeader totalRequests={totalRequests} T={T} />
              <HomeRequestList
                requestsLoading={requestsLoading}
                requestsError={requestsError}
                totalRequests={totalRequests}
                dismissed={dismissed}
                onClearDismissed={() => { setDismissed(new Set()); clearAllDismissed(); }}
                orders={orders}
                rides={rides}
                currency={currency}
                config={config}
                onAcceptOrder={(id) => acceptOrderMut.mutate(id)}
                onRejectOrder={(id) => rejectOrderMut.mutate(id)}
                onAcceptRide={(id) => acceptRideMut.mutate(id)}
                onCounterRide={(id, fare) => counterRideMut.mutate({ id, counterFare: fare })}
                onRejectOffer={(id) => rejectOfferMut.mutate(id)}
                onIgnoreRide={(id) => ignoreRideMut.mutate(id)}
                onDismiss={dismiss}
                acceptOrderPending={acceptOrderMut.isPending}
                rejectOrderPending={rejectOrderMut.isPending}
                acceptRidePending={acceptRideMut.isPending}
                counterRidePending={counterRideMut.isPending}
                rejectOfferPending={rejectOfferMut.isPending}
                ignoreRidePending={ignoreRideMut.isPending}
                requestsServerTime={requestsServerTime}
                userId={user?.id || ""}
                isRestricted={!!user?.isRestricted}
                onRetry={() => qc.invalidateQueries({ queryKey: ["rider-requests"] })}
                T={T}
              />
            </div>
          </>
        ) : (
          <div className="bg-white rounded-3xl shadow-sm p-8 sm:p-10 text-center border border-gray-100 animate-[slideUp_0.3s_ease-out]">
            <div className="w-16 h-16 sm:w-20 sm:h-20 bg-gray-50 rounded-3xl flex items-center justify-center mx-auto mb-4">
              <Wifi size={32} className="text-gray-300" />
            </div>
            <p className="text-gray-700 font-extrabold text-base sm:text-lg tracking-tight">You are Offline</p>
            <p className="text-gray-400 text-sm mt-1.5">
              Toggle the switch above to start accepting orders
            </p>
            <button
              onClick={toggleOnline}
              disabled={toggling}
              className="mt-5 bg-gray-900 text-white font-bold text-sm px-6 py-3 rounded-xl shadow-sm hover:bg-gray-800 transition-all active:scale-[0.98] disabled:opacity-60 inline-flex items-center gap-2"
              aria-label="Go online to start accepting orders"
            >
              <Zap size={16} /> Go Online
            </button>
          </div>
        )}

        {config.content.trackerBannerEnabled &&
          hasActiveTask &&
          config.content.trackerBannerPosition === "bottom" && (
            <div className="mt-3">
              <ActiveTaskBanner activeData={activeData} variant="green" />
            </div>
          )}
      </main>

      {toastMsg && (
        <div className="fixed top-6 left-4 right-4 z-[1100] pointer-events-none animate-[slideDown_0.3s_ease-out]">
          <div
            className={`${toastType === "success" ? "bg-green-600" : "bg-red-600"} text-white text-sm font-semibold px-5 py-3.5 rounded-2xl shadow-2xl flex items-center justify-center gap-2 max-w-md mx-auto`}
          >
            {toastType === "success" ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
            {toastMsg}
          </div>
        </div>
      )}

      {hasActiveTask && !config.content.trackerBannerEnabled && (
        <Link
          href="/active"
          className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+72px)] left-4 right-4 z-30 block bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl px-4 py-3 shadow-lg shadow-green-300/40 active:scale-[0.98] transition-transform animate-[slideUp_0.3s_ease-out]"
          aria-label="Go to active task"
        >
          <div className="flex items-center gap-2.5 max-w-md mx-auto">
            <div className="w-2.5 h-2.5 bg-white rounded-full animate-pulse flex-shrink-0" />
            <p className="text-sm font-extrabold text-white flex-1 truncate">
              {T("youHaveActiveTask")}
            </p>
            <ChevronRight size={14} className="text-white/80 flex-shrink-0" />
          </div>
        </Link>
      )}

      {showOfflineConfirm && (
        <OfflineConfirmDialog
          totalRequests={totalRequests}
          onStayOnline={() => setShowOfflineConfirm(false)}
          onGoOffline={async () => {
            setShowOfflineConfirm(false);
            await doActualToggle();
          }}
        />
      )}

    </div>
  );
}
