// =====================================================================
// RequirePermission — route/section guard.
// ---------------------------------------------------------------------
// The admin sidebar (Dashboard.jsx's SidebarNav) already hides nav
// items the current session isn't permitted to see, using the same
// rbac.js helpers this component uses. But hiding a link doesn't stop
// someone from typing the URL directly — the sidebar is UX, not
// enforcement. This component is what actually blocks the page itself
// from rendering, matching the plan's explicit requirement: "do not
// rely on frontend hiding alone."
//
// The backend independently re-checks the same permission code on
// every API call the page makes (see Depends(require(...)) on the
// corresponding route) — so even if this guard were bypassed, no
// data would actually be readable/writable. This component exists so
// the UI fails gracefully instead of rendering a page that then
// errors on every request.
// =====================================================================

import { useAuth } from "../context/AuthContext";

function AccessDenied({ code }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "4rem 1.5rem",
        textAlign: "center",
        gap: "0.75rem",
      }}
    >
      <div style={{ fontSize: "2.5rem" }} aria-hidden="true">🔒</div>
      <h2 style={{ margin: 0 }}>You don't have access to this page</h2>
      <p style={{ margin: 0, color: "var(--muted-color, #666)", maxWidth: 420 }}>
        Your account doesn't have the{" "}
        <code>{Array.isArray(code) ? code.join(" / ") : code}</code>{" "}
        permission needed here. Ask your administrator to grant it if you
        believe this is a mistake.
      </p>
    </div>
  );
}

/**
 * Wrap a page element: `<RequirePermission code="employee.view"><Employees /></RequirePermission>`
 * `code` may be a single permission string, an array (OR-logic, same
 * as the backend's require()), or omitted entirely for a baseline
 * page (any authenticated admin-tier session — the guard becomes a
 * no-op pass-through in that case).
 */
export default function RequirePermission({ code, children }) {
  const { hasPermission } = useAuth();

  if (!code || hasPermission(code)) {
    return children;
  }

  return <AccessDenied code={code} />;
}
