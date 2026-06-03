import axios from "axios";

// Single source of truth for the backend origin — used both by the
// axios instance for API calls and for building absolute URLs to
// /static/* assets (BOM line images, etc.) where axios isn't in
// play. Exported so components can `import { API_BASE_URL }`.
export const API_BASE_URL = "http://127.0.0.1:8001";

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
