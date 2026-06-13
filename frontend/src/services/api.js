import axios from "axios";

// Single source of truth for the backend origin — used both by the
// axios instance for API calls and for building absolute URLs to
// /static/* assets (BOM line images, etc.) where axios isn't in
// play. Exported so components can `import { API_BASE_URL }`.
//
// Resolution order:
//   1. VITE_API_URL env var (set in .env / .env.local)
//   2. Same-host autodiscovery — uses whatever hostname the frontend
//      was served from. This is what makes mobile testing work: a
//      phone hitting http://192.168.1.56:5174 automatically targets
//      http://192.168.1.56:8001 for the API. No code change needed
//      when switching machines.
//   3. Hardcoded localhost fallback for non-browser contexts.
// When running through a Cloudflare quick tunnel, the frontend lives
// at one .trycloudflare.com URL and the backend at another. The
// frontend can't autodetect the backend URL because :8001 doesn't
// exist on the tunnel domain. So we map: if the page is on any
// .trycloudflare.com host, route API calls to the hardcoded backend
// tunnel below. Update this string each time `cloudflared` is
// restarted (quick tunnels assign a new URL on every restart).
const CLOUDFLARE_BACKEND_URL =
  "https://witness-entity-coordinate-command.trycloudflare.com";

function resolveApiBase() {

  const envUrl = (import.meta?.env?.VITE_API_URL || "").trim();

  if (envUrl) return envUrl.replace(/\/+$/, "");

  if (typeof window !== "undefined" && window.location?.hostname) {

    const host = window.location.hostname;

    const proto = window.location.protocol || "http:";

    if (host.endsWith(".trycloudflare.com")) {

      return CLOUDFLARE_BACKEND_URL;
    }

    return `${proto}//${host}:8001`;
  }

  return "http://127.0.0.1:8001";
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
