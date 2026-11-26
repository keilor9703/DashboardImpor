import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider";

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Params = Record<string, string | number | boolean | undefined | null>;

export function buildUrl(path: string, params?: Params) {
  const qs = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  });
  const q = qs.toString();
  return `${BASE}${path}${q ? `?${q}` : ""}`;
}

/** Hook de consulta: incluye el token de Microsoft y cancela peticiones obsoletas. */
export function useApi<T>(path: string, params?: Params) {
  const { getToken, onUnauthorized } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const key = buildUrl(path, params);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setLoading(true);
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(key, {
          signal: c.signal,
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.status === 401 && onUnauthorized) onUnauthorized();
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new ApiError(res.status, body.detail ?? `Error ${res.status}`);
        }
        setData(await res.json());
        setError(null);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError((e as Error).message || "No fue posible conectar con el servidor");
      } finally {
        if (!c.signal.aborted) setLoading(false);
      }
    })();
    return () => c.abort();
  }, [key, tick, getToken, onUnauthorized]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

export async function apiPost<T>(path: string, getToken: () => Promise<string | null>): Promise<T> {
  const token = await getToken();
  const res = await fetch(buildUrl(path), {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, `Error ${res.status}`);
  return res.json();
}
