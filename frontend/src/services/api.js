import axios from "axios";

// Single source of truth for the backend origin — used both by the
// axios instance for API calls and for building absolute URLs to
// /static/* assets (BOM line images, etc.) where axios isn't in
// play. Exported so components can `import { API_BASE_URL }`.
//
// Resolution order:
//   1. VITE_API_URL env var (set in .env / .env.local / .env.production)
//   2. Production hostname mapping — when served from erp.bvc24.com
//      (Cloudflare named tunnel), route API to api.bvc24.com. The two
//      hostnames are different ingress rules on the same tunnel
//      process, so this is stable across reboots.
//   3. Same-host autodiscovery — uses whatever hostname the frontend
//      was served from. Makes LAN mobile testing work: a phone hitting
//      http://192.168.1.56:5173 targets :8001 for the API automatically.
//   4. Legacy: if the page is on an old .trycloudflare.com host, fall
//      back to the hardcoded ephemeral backend URL. Kept ONLY for
//      local dev while the named tunnel isn't yet provisioned.
//   5. Hardcoded localhost fallback for non-browser contexts.

// Permanent production hostnames — see deploy/cloudflared-config.example.yml
const PROD_FRONTEND_HOST = "erp.bvc24.com";
const PROD_BACKEND_URL = "http://192.168.1.10:8001";

// Legacy quick-tunnel URL — only consulted when the frontend is served
// from a .trycloudflare.com host. Once the named tunnel is live this
// branch never fires.

const LEGACY_QUICK_TUNNEL_BACKEND_URL =
  "http://192.168.1.10:8001";

// Capacitor injects `window.Capacitor` at runtime when the app is
// running inside a native shell (APK / iOS). Same-host autodiscovery
// is wrong there — the WebView loads content from https://localhost
// (Capacitor's internal scheme), so window.location.hostname is
// 'localhost' and window.location.protocol is 'https:'. If we let the
// fallback below run in that context, every API call hits
// https://localhost:8001 (the phone itself), not the LAN server.
function isCapacitorNative() {

  if (typeof window === "undefined") return false;

  const cap = window.Capacitor;

  if (!cap) return false;

  if (typeof cap.isNativePlatform === "function") {

    return cap.isNativePlatform();
  }

  const platform = typeof cap.getPlatform === "function"
    ? cap.getPlatform()
    : "";

  return platform === "android" || platform === "ios";
}

function resolveApiBase() {

  const envUrl = (import.meta?.env?.VITE_API_URL || "").trim();

  if (envUrl) return envUrl.replace(/\/+$/, "");

  // Capacitor native (APK / iOS) — bypass same-host discovery and go
  // straight to the LAN server. The phone must be on the same WiFi
  // as the ERP server (192.168.1.10) for this to reach.
  if (isCapacitorNative()) {

    return PROD_BACKEND_URL;
  }

  if (typeof window !== "undefined" && window.location?.hostname) {

    const host = window.location.hostname;

    const proto = window.location.protocol || "http:";

    if (host === PROD_FRONTEND_HOST) {

      return PROD_BACKEND_URL;
    }

    if (host.endsWith(".trycloudflare.com")) {

      return LEGACY_QUICK_TUNNEL_BACKEND_URL;
    }

    return `${proto}//${host}:8001`;
  }

  return "http://192.168.1.10:8001";
}

export const API_BASE_URL = resolveApiBase();

if (typeof window !== "undefined") {
  console.log("[api.js] API_BASE_URL =", API_BASE_URL, "(VITE_API_URL was:", import.meta?.env?.VITE_API_URL, ")");
}

const API = axios.create({
  baseURL: API_BASE_URL
});

API.interceptors.request.use((config) => {

  const token = localStorage.getItem("token");

  if (token) {

    config.headers = config.headers || {};

    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

// Silent-refresh support. Only one /auth/refresh call may be in
// flight at a time — the backend rotates the refresh token on every
// use (old one is marked ROTATED, a new one issued), so two
// concurrent calls with the same stored token would make the second
// one look like reuse of an already-rotated token and trigger the
// backend's theft-response (revoke every refresh token for this
// session). All concurrent 401s therefore await the SAME in-flight
// refresh promise instead of each calling /auth/refresh independently.
let refreshPromise = null;

async function performTokenRefresh() {

  const refreshToken = localStorage.getItem("refresh_token");

  if (!refreshToken) {

    throw new Error("No refresh token available");
  }

  // Deliberately bypasses the `API` instance (and therefore this same
  // response interceptor) — a raw axios call so a 401 on the refresh
  // endpoint itself can't recursively trigger another refresh attempt.
  const res = await axios.post(
    `${API_BASE_URL}/auth/refresh`,
    { refresh_token: refreshToken }
  );

  const { access_token, refresh_token } = res.data || {};

  if (access_token) localStorage.setItem("token", access_token);

  if (refresh_token) localStorage.setItem("refresh_token", refresh_token);

  return access_token;
}

function clearSessionAndRedirect() {

  // Preserve the theme preference — it isn't auth state.
  const theme = localStorage.getItem("theme");

  localStorage.clear();

  if (theme) localStorage.setItem("theme", theme);

  window.location.href = "/login";
}

API.interceptors.response.use(
  (res) => res,
  async (err) => {

    const status = err?.response?.status;
    const originalRequest = err?.config;

    // Try exactly one silent refresh-and-retry per request. Requests
    // to /login, /admin-login, /root-login, /iam-login, /auth/refresh
    // never carry a valid session token to refresh in the first place,
    // so a 401 from those is a real auth failure, not an expired
    // access token — performTokenRefresh() will simply fail fast (no
    // refresh_token stored yet) and fall through to the redirect below.
    if (status === 401 && originalRequest && !originalRequest._retriedAfterRefresh) {

      originalRequest._retriedAfterRefresh = true;

      try {

        if (!refreshPromise) {

          refreshPromise = performTokenRefresh().finally(() => {
            refreshPromise = null;
          });
        }

        const newAccessToken = await refreshPromise;

        originalRequest.headers = originalRequest.headers || {};

        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;

        return API(originalRequest);

      } catch {

        // Refresh itself failed (expired/invalid/reused refresh
        // token, or none stored) — this is a real session end.
        clearSessionAndRedirect();

        return Promise.reject(err);
      }
    }

    if (status === 401) {

      // Either not a retryable request, or the retry itself 401'd —
      // both admin and employee sessions now bounce to /login (this
      // used to only fire for role === "employee", silently leaving
      // an expired admin session stuck on a broken page).
      clearSessionAndRedirect();
    }

    return Promise.reject(err);
  }
);

export default API;
