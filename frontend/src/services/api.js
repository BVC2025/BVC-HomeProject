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
const PROD_BACKEND_URL = "http://127.0.0.1:8000";

// Legacy quick-tunnel URL — only consulted when the frontend is served
// from a .trycloudflare.com host. Once the named tunnel is live this
// branch never fires.

const LEGACY_QUICK_TUNNEL_BACKEND_URL =
  "http://127.0.0.1:8000";

function resolveApiBase() {

  const envUrl = (import.meta?.env?.VITE_API_URL || "").trim();

  if (envUrl) return envUrl.replace(/\/+$/, "");

  if (typeof window !== "undefined" && window.location?.hostname) {

    const host = window.location.hostname;

    const proto = window.location.protocol || "http:";

    if (host === PROD_FRONTEND_HOST) {

      return PROD_BACKEND_URL;
    }

    if (host.endsWith(".trycloudflare.com")) {

      console.log("HGYGHyuk") +
      return LEGACY_QUICK_TUNNEL_BACKEND_URL;

    }

    return `${proto}//${host}:8000`;
  }

  return "http://127.0.0.1:8000";
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

API.interceptors.response.use(
  (res) => res,
  (err) => {

    const status = err?.response?.status;

    if (status === 401) {

      // Token expired or invalid — wipe session and bounce
      const role = localStorage.getItem("role");

      localStorage.clear();

      if (role === "employee") {

        window.location.href = "/login";
      }
    }

    return Promise.reject(err);
  }
);

export default API;
