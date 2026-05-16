import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/context/ToastContext";
import { usePlatformConfig } from "@/context/PlatformConfigContext";

type ApiCallState<T, Args extends unknown[] = unknown[]> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  retrying: boolean;
  retryCount: number;
  circuitOpen: boolean;
  execute: (...args: Args) => Promise<T | null>;
  retry: () => Promise<T | null>;
  reset: () => void;
};

const DEFAULT_BACKOFF_BASE_MS = 1000;
const DEFAULT_MAX_RETRIES = 3;

const CB_FAILURE_THRESHOLD = 3;
const CB_RESET_TIMEOUT_MS = 30_000;

type CbState = "closed" | "open" | "half-open";

interface CircuitBreaker {
  state: CbState;
  failures: number;
  lastOpenedAt: number;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function extractError(e: unknown): string {
  if (e instanceof Error) return e.message || "Something went wrong. Please try again.";
  if (typeof e === "object" && e !== null) {
    const obj = e as Record<string, unknown>;
    const response = obj["response"];
    if (typeof response === "object" && response !== null) {
      const data = (response as Record<string, unknown>)["data"];
      if (typeof data === "object" && data !== null) {
        const err = (data as Record<string, unknown>)["error"];
        if (typeof err === "string" && err) return err;
      }
    }
    const data = obj["data"];
    if (typeof data === "object" && data !== null) {
      const err = (data as Record<string, unknown>)["error"];
      if (typeof err === "string" && err) return err;
    }
    const msg = obj["message"];
    if (typeof msg === "string" && msg) return msg;
  }
  return "Something went wrong. Please try again.";
}

function isServerError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /\b5\d{2}\b|server error|internal server|gateway|service unavailable/i.test(msg);
}

export function useApiCall<T, Args extends unknown[] = unknown[]>(
  apiFn: (...args: Args) => Promise<T>,
  options?: {
    showErrorToast?: boolean;
    maxRetries?: number;
    onSuccess?: (data: T) => void;
    onError?: (error: string) => void;
    retryMessage?: string;
    withSignal?: boolean;
    circuitBreaker?: boolean;
  },
): ApiCallState<T, Args> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [circuitOpen, setCircuitOpen] = useState(false);
  const lastArgsRef = useRef<Args | []>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const cbRef = useRef<CircuitBreaker>({ state: "closed", failures: 0, lastOpenedAt: 0 });
  const { showToast } = useToast();
  const { config } = usePlatformConfig();

  const configMaxRetries: number = config.network?.maxRetryAttempts ?? DEFAULT_MAX_RETRIES;
  const configBackoffBase: number = config.network?.retryBackoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;

  const showErr = options?.showErrorToast !== false;
  const maxRetries = options?.maxRetries ?? configMaxRetries;
  const backoffBaseMs = configBackoffBase;
  const useCb = options?.circuitBreaker !== false;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  const getCircuitState = useCallback((): CbState => {
    const cb = cbRef.current;
    if (cb.state === "open") {
      if (Date.now() - cb.lastOpenedAt >= CB_RESET_TIMEOUT_MS) {
        cb.state = "half-open";
        return "half-open";
      }
    }
    return cb.state;
  }, []);

  const onCircuitSuccess = useCallback(() => {
    const cb = cbRef.current;
    if (cb.state !== "closed") {
      cb.state = "closed";
      cb.failures = 0;
      setCircuitOpen(false);
    }
  }, []);

  const onCircuitFailure = useCallback((e: unknown) => {
    if (!isServerError(e)) return;
    const cb = cbRef.current;
    cb.failures += 1;
    if (cb.failures >= CB_FAILURE_THRESHOLD && cb.state !== "open") {
      cb.state = "open";
      cb.lastOpenedAt = Date.now();
      setCircuitOpen(true);
    } else if (cb.state === "half-open") {
      cb.state = "open";
      cb.lastOpenedAt = Date.now();
      setCircuitOpen(true);
    }
  }, []);

  const callWithRetry = useCallback(
    async (args: Args | [], isRetry = false): Promise<T | null> => {
      if (useCb) {
        const cbState = getCircuitState();
        if (cbState === "open") {
          const msg = "Service is temporarily unavailable. Please try again shortly.";
          setError(msg);
          if (showErr) showToast(msg, "error");
          options?.onError?.(msg);
          return null;
        }
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      if (!isRetry) {
        setLoading(true);
        setError(null);
        setRetryCount(0);
      }

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (controller.signal.aborted || !mountedRef.current) return null;

        if (attempt > 0) {
          setRetrying(true);
          setRetryCount(attempt);
          if (showErr) {
            showToast(
              options?.retryMessage || `Retrying... (${attempt}/${maxRetries})`,
              "warning",
            );
          }
          await delay(backoffBaseMs * Math.pow(2, attempt - 1));
        }

        try {
          const callArgs = options?.withSignal
            ? ([...args, controller.signal] as unknown as Args)
            : (args as unknown as Args);
          const result = await apiFn(...callArgs);
          if (controller.signal.aborted || !mountedRef.current) return null;
          if (useCb) onCircuitSuccess();
          setData(result);
          setLoading(false);
          setRetrying(false);
          setError(null);
          setRetryCount(0);
          options?.onSuccess?.(result);
          return result;
        } catch (e: unknown) {
          if (controller.signal.aborted || !mountedRef.current) return null;
          if (useCb) onCircuitFailure(e);
          const msg = extractError(e);
          if (attempt === maxRetries) {
            setError(msg);
            setLoading(false);
            setRetrying(false);
            if (showErr) {
              showToast(msg, "error");
            }
            options?.onError?.(msg);
            return null;
          }
        }
      }
      return null;
    },
    [apiFn, maxRetries, backoffBaseMs, showErr, showToast, useCb, getCircuitState, onCircuitSuccess, onCircuitFailure, options?.retryMessage],
  );

  const execute = useCallback(
    async (...args: Args) => {
      lastArgsRef.current = args;
      return callWithRetry(args, false);
    },
    [callWithRetry],
  );

  const retry = useCallback(async () => {
    return callWithRetry(lastArgsRef.current, true);
  }, [callWithRetry]);

  const reset = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    cbRef.current = { state: "closed", failures: 0, lastOpenedAt: 0 };
    setData(null);
    setLoading(false);
    setError(null);
    setRetrying(false);
    setRetryCount(0);
    setCircuitOpen(false);
  }, []);

  return { data, loading, error, retrying, retryCount, circuitOpen, execute, retry, reset };
}
