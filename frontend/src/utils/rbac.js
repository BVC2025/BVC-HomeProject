// =====================================================================
// rbac.js — shared frontend permission helpers.
// ---------------------------------------------------------------------
// Generalizes the permission-gating pattern that already existed only
// in EmployeeSidebar.jsx (getPermissionSet/hasAccess) so the admin
// side can use the exact same logic instead of showing every nav item
// and route to every logged-in admin-tier user regardless of their
// actual role's permission grants.
//
// This mirrors — and must stay in sync with — the permission codes
// enforced server-side via `require(...)` in the FastAPI routes (see
// backend/app/auth/auth_bearer.py and backend/scripts/seed_permissions.py).
// Hiding a nav item / blocking a route here is a UX convenience only;
// the backend independently enforces the same codes, so a mismatch
// here is a usability bug, not a security hole.
// =====================================================================

/**
 * Reads the permission codes baked into the JWT at login (stored by
 * Login.jsx as JSON in localStorage.permissions). Returns a Set of
 * lower-cased codes for O(1) lookups. A ROOT session has no
 * `permissions` claim at all (unconditional access) — callers should
 * check `isRoot()` separately rather than relying on an empty set.
 */
export function getPermissionSet() {
  try {
    const raw = localStorage.getItem("permissions") || "[]";
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.map((p) => String(p).toLowerCase()));
  } catch {
    return new Set();
  }
}

/**
 * True when the current session is a Root User token — Root bypasses
 * the permission system entirely on the backend (see
 * auth_bearer.require()'s principal_type == "ROOT" short-circuit), so
 * the frontend must do the same rather than hiding everything because
 * a Root session carries no `permissions` claim.
 */
export function isRoot() {
  return localStorage.getItem("principal_type") === "ROOT";
}

/**
 * True for the legacy ADMIN/SUPER_ADMIN role names, which also bypass
 * the permission catalogue server-side (auth_bearer.require()'s
 * hardcoded role-name bypass). Kept as its own check because these
 * sessions likewise may not carry every fine-grained code explicitly.
 */
export function isFullAdmin() {
  const role = (localStorage.getItem("backend_role") || "").toUpperCase();
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

/**
 * Decide whether a permission-gated thing (nav item, route, button)
 * should be visible/enabled for the current user.
 *
 *  - `required` is falsy/undefined           → baseline, always allowed
 *  - `required` is a single code string      → allowed if that code is granted
 *  - `required` is an array of codes         → allowed if ANY code matches (OR-logic),
 *                                               matching require()'s OR semantics server-side
 *
 * Root and full-admin sessions always pass, mirroring the backend.
 */
export function hasPermission(required, permSet = getPermissionSet()) {
  if (!required) return true;
  if (isRoot() || isFullAdmin()) return true;

  const needed = Array.isArray(required) ? required : [required];
  return needed.some((code) => permSet.has(String(code).toLowerCase()));
}

/**
 * Same decision, but for a nav-item-shaped object (`{ permission }`) —
 * kept for drop-in compatibility with the existing EmployeeSidebar.jsx
 * call sites (`hasAccess(item, permSet)`).
 */
export function hasAccess(item, permSet = getPermissionSet()) {
  return hasPermission(item?.permission, permSet);
}

// ---------------------------------------------------------------------
// Admin route → required permission code map.
// ---------------------------------------------------------------------
// One entry per path registered in Dashboard.jsx's <Routes>. A path
// with no entry (or an entry of `null`) is BASELINE — visible to any
// authenticated admin-tier session, matching pages whose backend
// routes are gated by the coarser get_current_admin role-allowlist
// rather than a specific permission code. Entries here should track
// the exact codes those pages' backend endpoints now require.
// ---------------------------------------------------------------------
export const ROUTE_PERMISSIONS = {
  "/roles": "role.manage",
  "/rbac": "role.manage",
  "/geofence": "geofence.settings.update",
  "/organization": "org.view",
  "/employees": "employee.view",
  "/employees/:id/profile": "employee.view",
  "/attendance": "attendance.view.all",
  "/memos": "memo.view.all",
  "/leave-management": "leave.view.all",
  "/attendance-penalties": "leave.view.all",
  "/leave-chat-history":  "leave.view.all",
  "/payroll": "payroll.view",
  "/payslip-generator": "payroll.manage",
  "/payroll-records": "payroll.view",
  "/help-desk": "helpdesk.view.all",
  "/employee-onboarding": "onboarding.sessions.view",
  "/customers": "customer.view",
  "/quotations": "quotation.manage",
  "/sales-orders": "sales_order.view",
  "/projects": "project.view",
  "/inventory": "inventory.view",
  "/machines": "machine.view",
  "/work-centers": "work_center.view",
  "/production": "production.view",
  "/quality": "quality.view",
  "/recruitment": "recruitment.view",
  "/onboarding": "onboarding.sessions.view",
  "/monthly-reports": "report.export",
  "/reports": "report.export",
  "/settings": "setting.modify",
  "/departments": "org.view",
  "/org-roles": "org.manage",
  "/project-categories": ["project.view", "project.categories.view"],
  "/task-templates": ["project.view", "project.task_templates.view"],
  "/project-quotations": ["project.view", "project.quotations.view"],
  "/project-pricing": ["project.view", "project.pricing.view"],
  "/whatsapp-config": "setting.modify",
  "/whatsapp-module-settings": "setting.modify",
  "/ai-platform/modules": "rag.module.manage",
  "/ai-platform/knowledge-base": "rag.query",
  "/ai-platform/training-jobs": "rag.query",
  "/ai-platform/chat-history": "rag.query",
  "/ai-platform/playground": "rag.query",
  "/ai-platform/settings": "rag.settings.manage",
  "/company-profile": "setting.modify",
  "/email-config": "setting.modify",
  "/email-templates": "setting.modify",
  "/inventory-categories": ["inventory.view", "inventory.categories.view"],
  "/product-master": ["inventory.view", "inventory.products.view"],
  "/supplier-management": ["supplier.manage", "supplier.view"],
  "/inventory-items": ["inventory.view", "inventory.items.view"],
  "/lead-management/configuration": "lead.config.view",
  "/lead-management/live-leads": "lead.live.view",
  "/lead-management/leads": "lead.records.view",
  "/lead-management/polling-activity": "lead.polling_log.view",
  // Everything else registered in Dashboard.jsx (Approval Center, the
  // various dashboards, HR automation, star performance, allowances,
  // shifts, holidays, biometric import, announcements, workforce
  // analytics, org-chart) is backed by get_current_admin's
  // role-allowlist rather than a specific permission code today — left
  // as baseline (no entry) rather than guessing a code that doesn't
  // exist server-side.
};

/**
 * Look up the permission requirement for a route path. Returns
 * undefined (baseline) if the path isn't in the map.
 */
export function permissionForRoute(path) {
  return ROUTE_PERMISSIONS[path];
}
