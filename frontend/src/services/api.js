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
function resolveApiBase() {

  const envUrl = (import.meta?.env?.VITE_API_URL || "").trim();

  if (envUrl) return envUrl.replace(/\/+$/, "");

  if (typeof window !== "undefined" && window.location?.hostname) {

    const host = window.location.hostname;

    const proto = window.location.protocol || "http:";

    return `${proto}//${host}:8001`;
  }

  return "http://127.0.0.1:8001";
}

export const API_BASE_URL = resolveApiBase();

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
