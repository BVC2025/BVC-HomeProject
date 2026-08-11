// =====================================================================
// AuthContext — thin wrapper around the existing localStorage-based
// auth state, not a replacement for it.
// ---------------------------------------------------------------------
// This app has never had a central auth store — every component reads
// ~15 separate localStorage keys directly (see Login.jsx for the full
// write list). Rewriting all of those call sites in one pass would be
// a huge, risky change for no immediate benefit. Instead, this context
// reads the SAME keys and exposes them through `useAuth()` for new
// code (the admin sidebar filter, <RequirePermission>) while every
// existing direct-localStorage-read component keeps working exactly
// as before, untouched.
//
// The one genuinely new behavior this introduces is a real, complete
// `logout()` — Dashboard.jsx's previous performLogout only removed 3
// of the ~15 auth keys ("auth", "username", "loginTime"), leaving
// "token", "role", "permissions" etc. behind after logout. This
// centralizes the fix.
// =====================================================================

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import API from "../services/api";
import { getPermissionSet, hasPermission, isRoot, isFullAdmin } from "../utils/rbac";

const AuthContext = createContext(null);

function readAuthSnapshot() {
  return {
    isAuthenticated: localStorage.getItem("auth") === "true",
    role: localStorage.getItem("role") || null,             // "admin" | "employee"
    backendRole: localStorage.getItem("backend_role") || null,
    principalType: localStorage.getItem("principal_type") || null, // "ROOT" | "IAM" | null (legacy Employee token)
    employeeId: localStorage.getItem("employee_id") || null,
    employeeCode: localStorage.getItem("employee_code") || null,
    permissions: getPermissionSet(),
  };
}

export function AuthProvider({ children }) {

  // Re-read on demand rather than subscribing to storage events —
  // this app never mutates auth state from another tab, and every
  // login/logout already triggers a full navigation, which remounts
  // consumers anyway.
  const [snapshot, setSnapshot] = useState(readAuthSnapshot);

  const refresh = useCallback(() => {
    setSnapshot(readAuthSnapshot());
  }, []);

  const logout = useCallback(async () => {

    // Best-effort server-side revocation of the refresh token so a
    // captured token can't keep minting new access tokens after this
    // logout. Never blocks navigation on the network call — a failed
    // revoke still logs the user out locally.
    const refreshToken = localStorage.getItem("refresh_token");

    if (refreshToken) {
      try {
        await API.post("/auth/logout", { refresh_token: refreshToken });
      } catch {
        // Ignore — logging out locally still must succeed.
      }
    }

    // Clear every auth key, but preserve the user's theme preference
    // (light/dark) — it isn't auth state and there's no reason to
    // reset it on every logout.
    const theme = localStorage.getItem("theme");
    localStorage.clear();
    if (theme) localStorage.setItem("theme", theme);

    refresh();
  }, [refresh]);

  const value = useMemo(() => ({
    ...snapshot,
    isRoot: isRoot(),
    isFullAdmin: isFullAdmin(),
    hasPermission: (code) => hasPermission(code, snapshot.permissions),
    refresh,
    logout,
  }), [snapshot, refresh, logout]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth() must be used inside <AuthProvider>");
  }
  return ctx;
}
